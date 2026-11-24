/**
 * Opening balances at go-live: one JournalEntry (kind opening_balance) dated
 * the instant before goLiveDate. Re-saving reverses the previous version.
 * Inventory rows set on-hand + average cost through opening movements.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString, type Dec } from "@/lib/accounting/money";
import { postJournal, reverseSystemEntry, type JournalLineInput } from "@/lib/accounting/journalEngine";
import { getSystemAccount, accountNeedsParty } from "@/lib/accounting/accounts";
import { parsePartyKey } from "@/lib/accounting/partyKeys";
import { assertLocationWritable } from "@/lib/accounting/scope";
import { recordInventoryMovement, type ProductRef } from "@/lib/accounting/inventory/movements";
import { productRefSchema } from "@/lib/accounting/inventory/valuation";
import { clearAccountingSettingsCache } from "@/lib/accounting/settings";
import type { AccountingCtx } from "@/lib/accounting/types";

const money = z.union([z.string(), z.number()]).transform((v) => D(String(v)));

export const openingBalancesSchema = z
  .object({
    accounts: z
      .array(z.object({ accountId: z.string().min(1), debit: money.optional(), credit: money.optional(), locationId: z.string().nullable().optional() }).strict())
      .max(500)
      .default([]),
    customers: z
      .array(z.object({ partyKey: z.string().min(3), amount: money, locationId: z.string().nullable().optional() }).strict())
      .max(5000)
      .default([]),
    suppliers: z
      .array(z.object({ supplierId: z.string().min(1), amount: money, locationId: z.string().nullable().optional() }).strict())
      .max(5000)
      .default([]),
    inventory: z
      .array(z.object({ productRef: productRefSchema, locationId: z.string().nullable().optional(), qty: money, unitCost: money }).strict())
      .max(5000)
      .default([]),
  })
  .strict();

export async function getOpeningBalances(ctx: AccountingCtx) {
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const entries = await prisma.journalEntry.findMany({
    where: { orgId: ctx.orgId, kind: "opening_balance" },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const current = entries.find((e) => e.status === "posted") ?? null;
  const trackedPos = await prisma.posProduct.findMany({
    where: { orgId: ctx.orgId, trackInventory: true, archivedAt: null, ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }) },
    select: { id: true, name: true, locationId: true, onHand: true, avgCost: true },
    orderBy: { name: "asc" },
  });
  const shop = await prisma.product.findMany({
    where: { orgId: ctx.orgId, remainingInStock: { gt: 0 } },
    select: { id: true, name: true, venueLocationId: true, remainingInStock: true, avgCost: true },
    orderBy: { name: "asc" },
    take: 2000,
  });
  return {
    version: settings.openingBalanceVersion,
    goLiveDate: settings.goLiveDate.toISOString(),
    current: current
      ? {
          id: current.id,
          number: current.number,
          entryDate: current.entryDate.toISOString(),
          lines: current.lines.map((l) => ({
            accountId: l.ledgerAccountId,
            accountCode: l.account.code,
            accountName: l.account.name,
            locationId: l.locationId,
            debit: toApiString(l.debit),
            credit: toApiString(l.credit),
            guestProfileId: l.guestProfileId,
            bookingAccountId: l.bookingAccountId,
            customerUserId: l.customerUserId,
            supplierId: l.supplierId,
            posProductId: l.posProductId,
            shopProductId: l.shopProductId,
            description: l.description,
          })),
        }
      : null,
    history: entries.map((e) => ({ id: e.id, number: e.number, status: e.status, createdAt: e.createdAt.toISOString(), sourceEvent: e.sourceEvent })),
    inventoryCandidates: [
      ...trackedPos.map((p) => ({ productRef: { posProductId: p.id }, name: p.name, locationId: p.locationId, onHand: String(p.onHand ?? 0), avgCost: D(p.avgCost).toFixed(4) })),
      ...shop.map((p) => ({ productRef: { shopProductId: p.id }, name: p.name, locationId: p.venueLocationId, onHand: String(p.remainingInStock), avgCost: D(p.avgCost).toFixed(4) })),
    ],
  };
}

export async function saveOpeningBalances(ctx: AccountingCtx, raw: unknown) {
  const input = openingBalancesSchema.parse(raw);
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const ar = await getSystemAccount(prisma, ctx.orgId, "accounts_receivable");
  const ap = await getSystemAccount(prisma, ctx.orgId, "accounts_payable");
  const obe = await getSystemAccount(prisma, ctx.orgId, "opening_balance_equity");
  const inventoryDefault = await getSystemAccount(prisma, ctx.orgId, "inventory_default");
  const lines: JournalLineInput[] = [];
  let net = ZERO;
  const accountIds = input.accounts.map((a) => a.accountId);
  const accounts = await prisma.ledgerAccount.findMany({ where: { orgId: ctx.orgId, id: { in: accountIds } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const [i, a] of input.accounts.entries()) {
    const acct = byId.get(a.accountId);
    if (!acct || acct.isHeader) throw acctError(ACCT.NOT_FOUND, { fields: { [`accounts.${i}.accountId`]: "Unknown or header account" } });
    if (accountNeedsParty(acct) || acct.subtype === "inventory") {
      throw acctError(ACCT.CONTROL_ACCOUNT, { fields: { [`accounts.${i}.accountId`]: "Use the customer, supplier, or inventory grids for this account" } });
    }
    const debit = round2(a.debit ?? ZERO);
    const credit = round2(a.credit ?? ZERO);
    if (debit.lessThan(0) || credit.lessThan(0) || (debit.greaterThan(0) && credit.greaterThan(0))) {
      throw acctError(ACCT.LINE_INVALID, { fields: { [`accounts.${i}`]: "Enter either a debit or a credit" } });
    }
    if (debit.isZero() && credit.isZero()) continue;
    const loc = await assertLocationWritable(ctx, a.locationId ?? null);
    lines.push({ accountId: acct.id, debit, credit, locationId: loc, description: "Opening balance" });
    net = net.add(debit).sub(credit);
  }
  for (const [i, c] of input.customers.entries()) {
    const party = await parsePartyKey(ctx.orgId, c.partyKey);
    if (party.type === "supplier" || party.type === "employee") throw acctError(ACCT.PARTY_REQUIRED, { fields: { [`customers.${i}.partyKey`]: "Choose a customer" } });
    const amt = round2(c.amount);
    if (amt.isZero()) continue;
    const loc = await assertLocationWritable(ctx, c.locationId ?? null);
    lines.push({ accountId: ar.id, amount: amt, locationId: loc, party, description: "Opening receivable" });
    net = net.add(amt);
  }
  for (const [i, s] of input.suppliers.entries()) {
    const party = await parsePartyKey(ctx.orgId, `supplier:${s.supplierId}`).catch(() => {
      throw acctError(ACCT.NOT_FOUND, { fields: { [`suppliers.${i}.supplierId`]: "Unknown supplier" } });
    });
    const amt = round2(s.amount);
    if (amt.isZero()) continue;
    const loc = await assertLocationWritable(ctx, s.locationId ?? null);
    lines.push({ accountId: ap.id, amount: amt.neg(), locationId: loc, party, description: "Opening payable" });
    net = net.sub(amt);
  }
  const invRows: Array<{ ref: ProductRef; qty: Dec; unitCost: Dec }> = [];
  for (const [i, row] of input.inventory.entries()) {
    if (row.qty.lessThan(0) || row.unitCost.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`inventory.${i}`]: "Quantity and cost must be ≥ 0" } });
    const ref = row.productRef as ProductRef;
    let loc: string | null = null;
    let inventoryAccountId = inventoryDefault.id;
    if (ref.posProductId) {
      const p = await prisma.posProduct.findFirst({ where: { id: ref.posProductId, orgId: ctx.orgId } });
      if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { [`inventory.${i}`]: "Unknown product" } });
      if (!p.trackInventory) throw acctError(ACCT.INVENTORY_PRODUCT_UNTRACKED, { fields: { [`inventory.${i}`]: p.name } });
      loc = await assertLocationWritable(ctx, p.locationId);
      if (p.inventoryAccountId) inventoryAccountId = p.inventoryAccountId;
    } else {
      const p = await prisma.product.findFirst({ where: { id: ref.shopProductId!, orgId: ctx.orgId } });
      if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { [`inventory.${i}`]: "Unknown product" } });
      loc = p.venueLocationId;
    }
    const value = round2(row.qty.mul(row.unitCost));
    invRows.push({ ref, qty: row.qty, unitCost: row.unitCost });
    if (value.isZero()) continue;
    lines.push({
      accountId: inventoryAccountId,
      amount: value,
      locationId: loc,
      description: "Opening inventory",
      posProductId: ref.posProductId ?? null,
      shopProductId: ref.shopProductId ?? null,
    });
    net = net.add(value);
  }
  if (!round2(net).isZero()) {
    lines.push({ accountId: obe.id, amount: round2(net).neg(), locationId: null, description: "Opening balance equity" });
  }
  const version = settings.openingBalanceVersion + 1;
  const entryDate = new Date(settings.goLiveDate.getTime() - 1);
  const entry = await prisma.$transaction(
    async (tx) => {
      if (settings.openingBalanceVersion > 0) {
        await reverseSystemEntry(tx, ctx.orgId, `opening_balance:v${settings.openingBalanceVersion}`, {
          reason: `Replaced by opening balances v${version}`,
          date: entryDate,
          actorId: ctx.actorId,
        });
      }
      const posted =
        lines.length >= 2
          ? await postJournal(tx, {
              orgId: ctx.orgId,
              kind: "opening_balance",
              sourceType: "opening_balance",
              sourceId: ctx.orgId,
              sourceEvent: `v${version}`,
              idempotencyKey: `opening_balance:v${version}`,
              entryDate,
              memo: `Opening balances v${version}`,
              actorId: ctx.actorId,
              lines,
            })
          : null;
      for (const r of invRows) {
        await recordInventoryMovement(tx, {
          orgId: ctx.orgId,
          productRef: r.ref,
          kind: "opening",
          qty: 0,
          absoluteQty: r.qty,
          unitCost: r.unitCost,
          sourceType: "opening_balance",
          sourceId: `v${version}`,
          reason: `Opening balances v${version}`,
          actorId: ctx.actorId,
        });
      }
      await tx.accountingSettings.update({ where: { orgId: ctx.orgId }, data: { openingBalanceVersion: version } });
      return posted;
    },
    { timeout: 120_000 }
  );
  clearAccountingSettingsCache(ctx.orgId);
  recordAccountingAudit(ctx, {
    action: "opening_balances.save",
    entityType: "JournalEntry",
    entityId: entry?.id ?? null,
    description: `Opening balances v${version} saved`,
  });
  return { version, journalEntryId: entry?.id ?? null, openingBalanceEquity: toApiString(round2(net).neg()) };
}
