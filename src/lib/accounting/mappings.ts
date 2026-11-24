/**
 * Source → ledger account mappings. Resolution order per candidate list:
 * specific mapping (location, then company-wide) → location_default for the
 * fallback key → the fallback system account → suspense (with warning).
 */
import type {
  AccountingMappingKind,
  AccountingSystemKey,
  LedgerAccount,
  LedgerAccountSubtype,
} from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { getSystemAccount, type AccountCache } from "@/lib/accounting/accounts";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export const MAPPING_KINDS = [
  "admission_product_type",
  "admission_product",
  "pos_product_kind",
  "pos_product",
  "pos_line_kind",
  "booking_tender",
  "pos_tender",
  "membership_plan",
  "shop_category",
  "expense_category",
  "stripe_account",
  "location_default",
] as const;

export type MappingCandidate = { kind: AccountingMappingKind; matchKey: string };

export type MappingIndex = Map<string, string>;

function mkey(kind: string, matchKey: string, locationId: string | null): string {
  return `${kind}|${matchKey}|${locationId ?? ""}`;
}

export async function loadMappingIndex(db: Db, orgId: string): Promise<MappingIndex> {
  const rows = await db.accountingMapping.findMany({
    where: { orgId },
    select: { kind: true, matchKey: true, locationId: true, ledgerAccountId: true },
  });
  return new Map(rows.map((r) => [mkey(r.kind, r.matchKey, r.locationId), r.ledgerAccountId]));
}

export async function resolveAccount(
  db: Db,
  orgId: string,
  opts: {
    candidates: MappingCandidate[];
    locationId: string | null;
    fallback: AccountingSystemKey;
    index: MappingIndex;
    cache: AccountCache;
  }
): Promise<{ accountId: string; viaSuspense: boolean }> {
  for (const c of opts.candidates) {
    if (!c.matchKey) continue;
    if (opts.locationId) {
      const hit = opts.index.get(mkey(c.kind, c.matchKey, opts.locationId));
      if (hit) return { accountId: hit, viaSuspense: false };
    }
    const hit = opts.index.get(mkey(c.kind, c.matchKey, null));
    if (hit) return { accountId: hit, viaSuspense: false };
  }
  if (opts.locationId) {
    const hit = opts.index.get(mkey("location_default", opts.fallback, opts.locationId));
    if (hit) return { accountId: hit, viaSuspense: false };
  }
  const companyDefault = opts.index.get(mkey("location_default", opts.fallback, null));
  if (companyDefault) return { accountId: companyDefault, viaSuspense: false };
  try {
    const acct = await getSystemAccount(db, orgId, opts.fallback, opts.cache);
    if (acct.isActive && !acct.archivedAt) return { accountId: acct.id, viaSuspense: false };
  } catch {
    /* fall through to suspense */
  }
  const suspense = await getSystemAccount(db, orgId, "suspense", opts.cache);
  return { accountId: suspense.id, viaSuspense: true };
}

const REVENUE_KINDS: ReadonlySet<string> = new Set([
  "admission_product_type",
  "admission_product",
  "pos_product_kind",
  "pos_product",
  "pos_line_kind",
  "membership_plan",
  "shop_category",
]);
const TENDER_SUBTYPES: ReadonlySet<LedgerAccountSubtype> = new Set([
  "cash",
  "bank",
  "payment_clearing",
  "receivable",
  "stored_value_liability",
]);

function assertMappingType(kind: AccountingMappingKind, acct: LedgerAccount): void {
  if (acct.isHeader || acct.archivedAt) throw acctError(ACCT.MAPPING_TYPE_INVALID);
  if (REVENUE_KINDS.has(kind)) {
    // Gratuity / gift card / stored value lines legitimately map to liabilities.
    if (acct.type !== "revenue" && acct.type !== "liability") throw acctError(ACCT.MAPPING_TYPE_INVALID);
    return;
  }
  if (kind === "booking_tender" || kind === "pos_tender") {
    if (!TENDER_SUBTYPES.has(acct.subtype)) throw acctError(ACCT.MAPPING_TYPE_INVALID);
    return;
  }
  if (kind === "expense_category") {
    if (acct.type !== "expense" && acct.type !== "asset") throw acctError(ACCT.MAPPING_TYPE_INVALID);
    return;
  }
  if (kind === "stripe_account") {
    if (acct.subtype !== "payment_clearing") throw acctError(ACCT.MAPPING_TYPE_INVALID);
  }
}

export const mappingsPutSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            kind: z.enum(MAPPING_KINDS),
            matchKey: z.string().trim().min(1).max(120),
            locationId: z.string().nullable().optional(),
            ledgerAccountId: z.string().nullable(),
          })
          .strict()
      )
      .max(500),
  })
  .strict();

export async function upsertMappings(ctx: AccountingCtx, raw: unknown) {
  const { rows } = mappingsPutSchema.parse(raw);
  const accountIds = [...new Set(rows.map((r) => r.ledgerAccountId).filter((x): x is string => Boolean(x)))];
  const accounts = await prisma.ledgerAccount.findMany({ where: { orgId: ctx.orgId, id: { in: accountIds } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const locIds = [...new Set(rows.map((r) => r.locationId).filter((x): x is string => Boolean(x)))];
  if (locIds.length) {
    const venues = await prisma.venueLocation.count({ where: { orgId: ctx.orgId, id: { in: locIds } } });
    if (venues !== locIds.length) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  }
  for (const r of rows) {
    if (r.ledgerAccountId) {
      const acct = byId.get(r.ledgerAccountId);
      if (!acct) throw acctError(ACCT.NOT_FOUND, { fields: { ledgerAccountId: "Unknown account" } });
      assertMappingType(r.kind, acct);
    }
  }
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const locationId = r.locationId && isValidId(r.locationId) ? r.locationId : null;
      const existing = await tx.accountingMapping.findFirst({
        where: { orgId: ctx.orgId, kind: r.kind, matchKey: r.matchKey, locationId },
      });
      if (!r.ledgerAccountId) {
        if (existing) await tx.accountingMapping.delete({ where: { id: existing.id } });
        continue;
      }
      if (existing) {
        await tx.accountingMapping.update({
          where: { id: existing.id },
          data: { ledgerAccountId: r.ledgerAccountId },
        });
      } else {
        await tx.accountingMapping.create({
          data: {
            orgId: ctx.orgId,
            kind: r.kind,
            matchKey: r.matchKey,
            locationId,
            ledgerAccountId: r.ledgerAccountId,
            createdById: ctx.actorId,
          },
        });
      }
    }
  });
  recordAccountingAudit(ctx, {
    action: "mapping.update",
    entityType: "AccountingMapping",
    entityId: null,
    description: `${rows.length} account mappings saved`,
    metadata: { rows },
  });
  return listMappings(ctx);
}

/** Mappings plus the real catalog items the UI maps. */
export async function listMappings(ctx: AccountingCtx) {
  const [mappings, admission, pos, plans, categories, expenseCats, orgConnect, parkConnect, venues] =
    await Promise.all([
      prisma.accountingMapping.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ kind: "asc" }, { matchKey: "asc" }] }),
      prisma.admissionProduct.findMany({
        where: { orgId: ctx.orgId },
        select: { id: true, name: true, type: true, locationId: true },
        orderBy: { name: "asc" },
        take: 1000,
      }),
      prisma.posProduct.findMany({
        where: { orgId: ctx.orgId, archivedAt: null },
        select: { id: true, name: true, kind: true, locationId: true },
        orderBy: { name: "asc" },
        take: 2000,
      }),
      prisma.membershipPlan.findMany({
        where: { orgId: ctx.orgId },
        select: { id: true, name: true, locationId: true },
        orderBy: { name: "asc" },
      }),
      prisma.productCategory.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.expenseCategory.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.organizationMarketplaceAccount.findUnique({
        where: { orgId: ctx.orgId },
        select: { stripeConnectedAccountId: true },
      }),
      prisma.venueLocationMarketplaceAccount.findMany({
        where: { orgId: ctx.orgId, stripeConnectedAccountId: { not: null } },
        select: { stripeConnectedAccountId: true, locationId: true },
      }),
      prisma.venueLocation.findMany({
        where: { orgId: ctx.orgId },
        select: { id: true, name: true, status: true },
        orderBy: { name: "asc" },
      }),
    ]);
  const stripeAccounts = [
    ...(orgConnect?.stripeConnectedAccountId
      ? [{ id: orgConnect.stripeConnectedAccountId, label: "Company Stripe account", locationId: null as string | null }]
      : []),
    ...parkConnect
      .filter((p) => p.stripeConnectedAccountId)
      .map((p) => ({
        id: p.stripeConnectedAccountId!,
        label: `Park Stripe account (${venues.find((v) => v.id === p.locationId)?.name ?? p.locationId})`,
        locationId: p.locationId,
      })),
  ];
  return {
    mappings: mappings.map((m) => ({
      id: m.id,
      kind: m.kind,
      matchKey: m.matchKey,
      locationId: m.locationId,
      ledgerAccountId: m.ledgerAccountId,
    })),
    catalog: {
      admissionProductTypes: ["timed_session", "day_pass", "group", "camp_event", "party_package", "add_on", "pass"],
      admissionProducts: admission,
      posProductKinds: [
        "admission_proxy", "food", "beverage", "merchandise", "open_price", "package",
        "party_package_proxy", "add_on", "gift_card", "membership_plan", "cashless_card",
        "park_wallet", "gratuity", "other",
      ],
      posProducts: pos,
      posLineKinds: ["sku", "open_price", "modifier", "package_component", "discount", "tip", "round", "other"],
      bookingTenders: ["card", "cash", "split_component", "gift_card", "stored_card", "invoice", "other"],
      posTenders: ["card", "cash", "split_component", "gift_card", "park_wallet", "cashless", "stored_card", "payment_link", "other"],
      membershipPlans: plans,
      shopCategories: categories,
      expenseCategories: expenseCats,
      stripeAccounts,
      locations: venues.filter((v) => v.status === "active"),
      locationDefaultKeys: [
        "till_cash", "cash_on_hand", "bank_default", "stripe_clearing", "inventory_default",
        "cogs_default", "revenue_food_beverage", "revenue_merchandise", "revenue_admission",
      ],
    },
  };
}

export const DEFAULT_MAPPINGS: ReadonlyArray<{ kind: AccountingMappingKind; matchKey: string; systemKey: AccountingSystemKey }> = [
  { kind: "admission_product_type", matchKey: "timed_session", systemKey: "revenue_admission" },
  { kind: "admission_product_type", matchKey: "day_pass", systemKey: "revenue_admission" },
  { kind: "admission_product_type", matchKey: "group", systemKey: "revenue_admission" },
  { kind: "admission_product_type", matchKey: "camp_event", systemKey: "revenue_admission" },
  { kind: "admission_product_type", matchKey: "pass", systemKey: "revenue_admission" },
  { kind: "admission_product_type", matchKey: "party_package", systemKey: "revenue_party" },
  { kind: "admission_product_type", matchKey: "add_on", systemKey: "revenue_admission" },
  { kind: "pos_product_kind", matchKey: "food", systemKey: "revenue_food_beverage" },
  { kind: "pos_product_kind", matchKey: "beverage", systemKey: "revenue_food_beverage" },
  { kind: "pos_product_kind", matchKey: "merchandise", systemKey: "revenue_merchandise" },
  { kind: "pos_product_kind", matchKey: "admission_proxy", systemKey: "revenue_admission" },
  { kind: "pos_product_kind", matchKey: "package", systemKey: "revenue_admission" },
  { kind: "pos_product_kind", matchKey: "party_package_proxy", systemKey: "revenue_party" },
  { kind: "pos_product_kind", matchKey: "membership_plan", systemKey: "revenue_membership" },
  { kind: "pos_product_kind", matchKey: "gratuity", systemKey: "tips_payable" },
  { kind: "pos_product_kind", matchKey: "other", systemKey: "revenue_other" },
  { kind: "pos_product_kind", matchKey: "open_price", systemKey: "revenue_other" },
  { kind: "booking_tender", matchKey: "card", systemKey: "stripe_clearing" },
  { kind: "booking_tender", matchKey: "stored_card", systemKey: "stripe_clearing" },
  { kind: "booking_tender", matchKey: "cash", systemKey: "till_cash" },
  { kind: "booking_tender", matchKey: "split_component", systemKey: "till_cash" },
  { kind: "booking_tender", matchKey: "gift_card", systemKey: "gift_card_liability" },
  { kind: "booking_tender", matchKey: "invoice", systemKey: "accounts_receivable" },
  { kind: "booking_tender", matchKey: "other", systemKey: "undeposited_funds" },
  { kind: "pos_tender", matchKey: "card", systemKey: "stripe_clearing" },
  { kind: "pos_tender", matchKey: "stored_card", systemKey: "stripe_clearing" },
  { kind: "pos_tender", matchKey: "payment_link", systemKey: "stripe_clearing" },
  { kind: "pos_tender", matchKey: "cash", systemKey: "till_cash" },
  { kind: "pos_tender", matchKey: "split_component", systemKey: "till_cash" },
  { kind: "pos_tender", matchKey: "gift_card", systemKey: "gift_card_liability" },
  { kind: "pos_tender", matchKey: "park_wallet", systemKey: "stored_value_liability" },
  { kind: "pos_tender", matchKey: "cashless", systemKey: "stored_value_liability" },
  { kind: "pos_tender", matchKey: "other", systemKey: "undeposited_funds" },
];

export async function seedDefaultMappings(tx: Db, orgId: string): Promise<void> {
  const accounts = await tx.ledgerAccount.findMany({
    where: { orgId, systemKey: { not: null } },
    select: { id: true, systemKey: true },
  });
  const bySys = new Map(accounts.map((a) => [a.systemKey!, a.id]));
  for (const m of DEFAULT_MAPPINGS) {
    const accountId = bySys.get(m.systemKey);
    if (!accountId) continue;
    const exists = await tx.accountingMapping.findFirst({
      where: { orgId, kind: m.kind, matchKey: m.matchKey, locationId: null },
      select: { id: true },
    });
    if (exists) continue;
    await tx.accountingMapping.create({
      data: { orgId, kind: m.kind, matchKey: m.matchKey, locationId: null, ledgerAccountId: accountId },
    });
  }
}
