/**
 * MembershipPlan catalog CRUD helpers (Feature 08 Phase 1).
 */
import type {
  MembershipIntervalUnit,
  MembershipPlanBilling,
  Prisma,
} from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  assertLocationInMembershipScope,
  locationScopeFilter,
  rejectClientOrgFields,
  requireActorVenueInScope,
  LOCATION_OUT_OF_SCOPE,
  PLAN_NOT_FOUND,
  type MembershipsActor,
} from "@/lib/memberships/common";
import {
  MEMBERSHIP_BILLING_MODES,
  MEMBERSHIP_INTERVAL_UNITS,
  type MembershipPlanDto,
  type MembershipPlanEntitlements,
} from "@/lib/memberships/types";
import { resolveMembershipCategoryId } from "@/lib/memberships/categories";
import {
  merchandisingDefaults,
  parseMerchandisingFromBody,
  parseVariationsLoose,
  primaryFromVariations,
  type MerchandisingFields,
} from "@/lib/memberships/merchandising";
import { resolveAndValidateAttachedForms } from "@/lib/memberships/attachableForms";

/** Prefix for sibling membership plans offered as checkout add-ons. */
export const MEMBERSHIP_ADDON_ID_PREFIX = "membership:";

/**
 * Ensure add-on refs are same-org Online Booking products or sibling plans.
 * Rejects self-refs, archived rows, foreign ids, and (when park-locked)
 * products/plans outside the actor's assigned parks.
 */
export async function resolveAndValidateAddOnProductIds(
  orgId: string,
  ids: string[] | undefined | null,
  opts?: {
    excludePlanId?: string | null;
    /** When set, ticket products must live in one of these parks. */
    allowedLocationIds?: string[] | null;
    /** When park-locked, sibling plans must be org-default or in-scope. */
    parkLocked?: boolean;
  }
): Promise<string[]> {
  if (!ids?.length) return [];
  const unique = Array.from(
    new Set(
      ids
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).slice(0, 100);

  const ticketIds: string[] = [];
  const planIds: string[] = [];
  for (const id of unique) {
    if (id.startsWith(MEMBERSHIP_ADDON_ID_PREFIX)) {
      const planId = id.slice(MEMBERSHIP_ADDON_ID_PREFIX.length);
      if (!isValidId(planId)) {
        throw new Error(`Invalid membership add-on id: ${id}`);
      }
      if (opts?.excludePlanId && planId === opts.excludePlanId) {
        throw new Error("A plan cannot offer itself as an add-on");
      }
      planIds.push(planId);
    } else {
      if (!isValidId(id)) {
        throw new Error(`Invalid add-on product id: ${id}`);
      }
      ticketIds.push(id);
    }
  }

  const allowed = opts?.allowedLocationIds?.filter(Boolean) ?? null;

  if (ticketIds.length) {
    const found = await prisma.admissionProduct.findMany({
      where: { orgId, id: { in: ticketIds }, archivedAt: null },
      select: { id: true, locationId: true },
    });
    const byId = new Map(found.map((r) => [r.id, r]));
    const missing = ticketIds.filter((id) => !byId.has(id));
    if (missing.length) {
      throw new Error(
        `Add-on product(s) not found or archived: ${missing.slice(0, 5).join(", ")}`
      );
    }
    if (allowed && allowed.length > 0) {
      const outOfScope = ticketIds.filter((id) => {
        const loc = byId.get(id)?.locationId;
        return !loc || !allowed.includes(loc);
      });
      if (outOfScope.length) {
        throw new Error(
          `Add-on product(s) outside your park scope: ${outOfScope
            .slice(0, 5)
            .join(", ")}`
        );
      }
    }
  }
  if (planIds.length) {
    const found = await prisma.membershipPlan.findMany({
      where: { orgId, id: { in: planIds }, archivedAt: null },
      select: { id: true, locationId: true },
    });
    const byId = new Map(found.map((r) => [r.id, r]));
    const missing = planIds.filter((id) => !byId.has(id));
    if (missing.length) {
      throw new Error(
        `Add-on membership plan(s) not found or archived: ${missing
          .slice(0, 5)
          .join(", ")}`
      );
    }
    if (opts?.parkLocked && allowed && allowed.length > 0) {
      const outOfScope = planIds.filter((id) => {
        const loc = byId.get(id)?.locationId;
        // Org-default (null) plans are visible to park seats; park-specific
        // must be in assigned parks.
        return loc != null && !allowed.includes(loc);
      });
      if (outOfScope.length) {
        throw new Error(
          `Add-on membership plan(s) outside your park scope: ${outOfScope
            .slice(0, 5)
            .join(", ")}`
        );
      }
    }
  }
  return unique;
}

/** Park-locked seats may read org-default plans but must not mutate them. */
export async function assertCanMutateMembershipPlan(
  actor: MembershipsActor,
  plan: { locationId: string | null }
): Promise<void> {
  const scope = await locationScopeFilter(actor);
  if (scope.parkLocked) {
    if (!plan.locationId) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    await assertLocationInMembershipScope(actor, plan.locationId);
    return;
  }
  if (plan.locationId) {
    await assertLocationInMembershipScope(actor, plan.locationId);
  }
}

/** Read path — tolerate legacy/partial JSON; strip unknown pollution on write. */
function parseEntitlements(raw: unknown): MembershipPlanEntitlements {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: MembershipPlanEntitlements = {};
  if ("entriesPerPeriod" in o) {
    if (o.entriesPerPeriod == null) out.entriesPerPeriod = null;
    else {
      const n = Number(o.entriesPerPeriod);
      if (Number.isInteger(n) && n >= 0 && n <= 100_000) {
        out.entriesPerPeriod = n;
      }
    }
  }
  if ("discountPercent" in o) {
    if (o.discountPercent == null) out.discountPercent = null;
    else {
      const n = Number(o.discountPercent);
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        out.discountPercent = Math.round(n * 100) / 100;
      }
    }
  }
  if ("guestCount" in o) {
    if (o.guestCount == null) out.guestCount = null;
    else {
      const n = Number(o.guestCount);
      if (Number.isInteger(n) && n >= 1 && n <= 100) out.guestCount = n;
    }
  }
  if (Array.isArray(o.perkFlags)) {
    out.perkFlags = o.perkFlags
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  if (Array.isArray(o.freeProductRefs)) {
    out.freeProductRefs = o.freeProductRefs
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  if (Array.isArray(o.addOnProductIds)) {
    out.addOnProductIds = o.addOnProductIds
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
  }
  if (Array.isArray(o.formIds)) {
    out.formIds = o.formIds
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  if (Array.isArray(o.attachedForms)) {
    out.attachedForms = o.attachedForms
      .filter(
        (row): row is { id: string; name: string } =>
          !!row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          typeof (row as { id?: unknown }).id === "string" &&
          typeof (row as { name?: unknown }).name === "string"
      )
      .map((row) => ({
        id: row.id.trim().slice(0, 80),
        name: row.name.trim().slice(0, 120),
      }))
      .filter((row) => row.id && row.name)
      .slice(0, 50);
  }
  if ("overrideTaxRate" in o) {
    if (o.overrideTaxRate == null || o.overrideTaxRate === "") {
      out.overrideTaxRate = null;
    } else {
      const n = Number(o.overrideTaxRate);
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        out.overrideTaxRate = Math.round(n * 100) / 100;
      }
    }
  }
  if ("ticketHolderCaptured" in o) {
    out.ticketHolderCaptured = o.ticketHolderCaptured === true;
  }
  if ("customTicketIdCaptured" in o) {
    out.customTicketIdCaptured = o.customTicketIdCaptured === true;
  }
  if ("waiverRequired" in o) {
    out.waiverRequired = o.waiverRequired === true;
  }
  return out;
}

/** Write path — reject invalid values instead of silently dropping. */
function sanitizeEntitlementsForWrite(
  raw: unknown
): MembershipPlanEntitlements {
  if (raw == null) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("entitlements must be an object");
  }
  const o = raw as Record<string, unknown>;
  const out: MembershipPlanEntitlements = {};

  if ("entriesPerPeriod" in o) {
    if (o.entriesPerPeriod == null) {
      out.entriesPerPeriod = null;
    } else {
      const n = Number(o.entriesPerPeriod);
      if (!Number.isInteger(n) || n < 0 || n > 100_000) {
        throw new Error(
          "entitlements.entriesPerPeriod must be an integer from 0 to 100000 (or null)"
        );
      }
      out.entriesPerPeriod = n;
    }
  }
  if ("discountPercent" in o) {
    if (o.discountPercent == null) {
      out.discountPercent = null;
    } else {
      const n = Number(o.discountPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(
          "entitlements.discountPercent must be from 0 to 100 (or null)"
        );
      }
      out.discountPercent = Math.round(n * 100) / 100;
    }
  }
  if ("guestCount" in o) {
    if (o.guestCount == null) {
      out.guestCount = null;
    } else {
      const n = Number(o.guestCount);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        throw new Error(
          "entitlements.guestCount must be an integer from 1 to 100 (or null)"
        );
      }
      out.guestCount = n;
    }
  }
  if ("perkFlags" in o) {
    if (o.perkFlags == null) {
      out.perkFlags = [];
    } else if (!Array.isArray(o.perkFlags)) {
      throw new Error("entitlements.perkFlags must be an array of strings");
    } else {
      out.perkFlags = o.perkFlags
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
    }
  }
  if ("freeProductRefs" in o) {
    if (o.freeProductRefs == null) {
      out.freeProductRefs = [];
    } else if (!Array.isArray(o.freeProductRefs)) {
      throw new Error(
        "entitlements.freeProductRefs must be an array of strings"
      );
    } else {
      out.freeProductRefs = o.freeProductRefs
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
    }
  }
  if ("addOnProductIds" in o) {
    if (o.addOnProductIds == null) {
      out.addOnProductIds = [];
    } else if (!Array.isArray(o.addOnProductIds)) {
      throw new Error(
        "entitlements.addOnProductIds must be an array of strings"
      );
    } else {
      out.addOnProductIds = o.addOnProductIds
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100);
    }
  }
  if ("formIds" in o) {
    if (o.formIds == null) {
      out.formIds = [];
    } else if (!Array.isArray(o.formIds)) {
      throw new Error("entitlements.formIds must be an array of strings");
    } else {
      out.formIds = o.formIds
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
    }
  }
  if ("attachedForms" in o) {
    if (o.attachedForms == null) {
      out.attachedForms = [];
    } else if (!Array.isArray(o.attachedForms)) {
      throw new Error(
        "entitlements.attachedForms must be an array of { id, name }"
      );
    } else {
      out.attachedForms = o.attachedForms
        .filter(
          (row): row is { id: string; name: string } =>
            !!row &&
            typeof row === "object" &&
            !Array.isArray(row) &&
            typeof (row as { id?: unknown }).id === "string" &&
            typeof (row as { name?: unknown }).name === "string"
        )
        .map((row) => ({
          id: row.id.trim().slice(0, 80),
          name: row.name.trim().slice(0, 120),
        }))
        .filter((row) => row.id && row.name)
        .slice(0, 50);
    }
  }
  if ("overrideTaxRate" in o) {
    if (o.overrideTaxRate == null || o.overrideTaxRate === "") {
      out.overrideTaxRate = null;
    } else {
      const n = Number(o.overrideTaxRate);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(
          "entitlements.overrideTaxRate must be from 0 to 100 (or null)"
        );
      }
      out.overrideTaxRate = Math.round(n * 100) / 100;
    }
  }
  if ("ticketHolderCaptured" in o) {
    out.ticketHolderCaptured = Boolean(o.ticketHolderCaptured);
  }
  if ("customTicketIdCaptured" in o) {
    out.customTicketIdCaptured = Boolean(o.customTicketIdCaptured);
  }
  if ("waiverRequired" in o) {
    out.waiverRequired = Boolean(o.waiverRequired);
  }
  return out;
}

function toDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  description: string | null;
  billing: MembershipPlanBilling;
  intervalCount: number | null;
  intervalUnit: MembershipIntervalUnit | null;
  price: Prisma.Decimal | { toString(): string };
  currency: string;
  entitlements: unknown;
  familyAllowed: boolean;
  upgradeGroupKey: string | null;
  agreementRequired: boolean;
  pauseAllowed: boolean;
  membershipType?: "single" | "group";
  detailedDescription?: string | null;
  physicalPassMessage?: string | null;
  imageUrl?: string | null;
  tags?: string[];
  daysValidFromPurchase?: number | null;
  daysValidFromRedemption?: number | null;
  redemptionStartsAt?: Date | null;
  redemptionEndsAt?: Date | null;
  customRedemptionDescription?: string | null;
  salesStartsAt?: Date | null;
  salesEndsAt?: Date | null;
  hideFromOnlineSales?: boolean;
  addOnsEnabled?: boolean;
  alternateAddress?: string | null;
  cancellationTerms?: string | null;
  formsEnabled?: boolean;
  instructions?: string | null;
  reportingCategory?: string | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  overrideTax?: boolean;
  termsAndConditions?: string | null;
  variations?: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MembershipPlanDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    description: row.description,
    billing: row.billing,
    intervalCount: row.intervalCount,
    intervalUnit: row.intervalUnit,
    price: row.price.toString(),
    currency: row.currency,
    entitlements: parseEntitlements(row.entitlements),
    familyAllowed: row.familyAllowed,
    upgradeGroupKey: row.upgradeGroupKey,
    agreementRequired: row.agreementRequired,
    pauseAllowed: row.pauseAllowed,
    membershipType: row.membershipType ?? (row.familyAllowed ? "group" : "single"),
    detailedDescription: row.detailedDescription ?? null,
    physicalPassMessage: row.physicalPassMessage ?? null,
    imageUrl: row.imageUrl ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    daysValidFromPurchase: row.daysValidFromPurchase ?? null,
    daysValidFromRedemption: row.daysValidFromRedemption ?? null,
    redemptionStartsAt: row.redemptionStartsAt?.toISOString() ?? null,
    redemptionEndsAt: row.redemptionEndsAt?.toISOString() ?? null,
    customRedemptionDescription: row.customRedemptionDescription ?? null,
    salesStartsAt: row.salesStartsAt?.toISOString() ?? null,
    salesEndsAt: row.salesEndsAt?.toISOString() ?? null,
    hideFromOnlineSales: Boolean(row.hideFromOnlineSales),
    addOnsEnabled: Boolean(row.addOnsEnabled),
    alternateAddress: row.alternateAddress ?? null,
    cancellationTerms: row.cancellationTerms ?? null,
    formsEnabled: Boolean(row.formsEnabled),
    instructions: row.instructions ?? null,
    reportingCategory: row.reportingCategory ?? null,
    categoryId: row.categoryId ?? row.category?.id ?? null,
    categoryName: row.category?.name ?? null,
    overrideTax: Boolean(row.overrideTax),
    termsAndConditions: row.termsAndConditions ?? null,
    variations: parseVariationsLoose(row.variations),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PLAN_CATEGORY_INCLUDE = {
  category: { select: { id: true, name: true } },
} as const;

function merchandisingCreateData(
  m: MerchandisingFields
): Omit<MerchandisingFields, "membershipType"> & {
  membershipType: MerchandisingFields["membershipType"];
  familyAllowed: boolean;
} {
  return {
    ...m,
    familyAllowed: m.membershipType === "group",
  };
}

function parseBilling(value: unknown): MembershipPlanBilling {
  if (
    typeof value === "string" &&
    (MEMBERSHIP_BILLING_MODES as readonly string[]).includes(value)
  ) {
    return value as MembershipPlanBilling;
  }
  throw new Error("billing must be recurring or fixed");
}

function parseIntervalUnit(value: unknown): MembershipIntervalUnit | null {
  if (value == null || value === "") return null;
  if (
    typeof value === "string" &&
    (MEMBERSHIP_INTERVAL_UNITS as readonly string[]).includes(value)
  ) {
    return value as MembershipIntervalUnit;
  }
  throw new Error("intervalUnit must be day, week, month, or year");
}

function parsePrice(value: unknown): Prisma.Decimal {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    if (value > 999_999_999.99) {
      throw new Error("price is too large");
    }
    return new PrismaNS.Decimal(value.toFixed(2));
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("price must be a non-negative number");
    }
    if (n > 999_999_999.99) {
      throw new Error("price is too large");
    }
    return new PrismaNS.Decimal(n.toFixed(2));
  }
  throw new Error("price is required");
}

function parseCurrency(value: unknown): string {
  if (value == null || value === "") return "USD";
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("currency must be a 3-letter code");
  }
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a 3-letter code");
  }
  return currency;
}

function parseCreateBody(body: unknown): {
  name: string;
  description: string | null;
  billing: MembershipPlanBilling;
  intervalCount: number | null;
  intervalUnit: MembershipIntervalUnit | null;
  price: Prisma.Decimal;
  currency: string;
  entitlements: MembershipPlanEntitlements;
  familyAllowed: boolean;
  upgradeGroupKey: string | null;
  agreementRequired: boolean;
  pauseAllowed: boolean;
  locationId: string | null;
  categoryId: unknown;
  merchandising: MerchandisingFields;
} {
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("name is required");
  if (name.length > 200) throw new Error("name is too long");

  const merchPartial = parseMerchandisingFromBody(b);
  const merchandising: MerchandisingFields = {
    ...merchandisingDefaults(),
    ...merchPartial,
  };

  // Variations (when present) drive primary price/billing; otherwise classic fields.
  const fromVar = primaryFromVariations(merchandising.variations);
  let billing: MembershipPlanBilling;
  let price: Prisma.Decimal;
  let intervalCount: number | null = null;
  let intervalUnit: MembershipIntervalUnit | null = null;

  if (fromVar) {
    billing = fromVar.billing;
    price = fromVar.price;
    intervalCount = fromVar.intervalCount;
    intervalUnit = fromVar.intervalUnit;
  } else {
    billing = parseBilling(b.billing);
    price = parsePrice(b.price);
    if (b.intervalCount != null && b.intervalCount !== "") {
      const n = Number(b.intervalCount);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        throw new Error("intervalCount must be an integer from 1 to 120");
      }
      intervalCount = n;
    }
    intervalUnit = parseIntervalUnit(b.intervalUnit);
  }
  if (billing === "recurring" && (intervalCount == null || !intervalUnit)) {
    throw new Error("recurring plans require intervalCount and intervalUnit");
  }

  const currency = parseCurrency(b.currency);

  let locationId: string | null = null;
  if (b.locationId != null && b.locationId !== "") {
    if (typeof b.locationId !== "string" || !isValidId(b.locationId)) {
      throw new Error("locationId is invalid");
    }
    locationId = b.locationId;
  }

  const entitlements = sanitizeEntitlementsForWrite(b.entitlements ?? {});
  const upgradeGroupKey =
    typeof b.upgradeGroupKey === "string" && b.upgradeGroupKey.trim()
      ? b.upgradeGroupKey.trim().slice(0, 80)
      : null;

  // membershipType wins over legacy familyAllowed when both sent.
  const familyAllowed =
    merchandising.membershipType === "group"
      ? true
      : "familyAllowed" in b
        ? Boolean(b.familyAllowed)
        : false;
  if (familyAllowed) merchandising.membershipType = "group";

  return {
    name,
    description:
      typeof b.description === "string" && b.description.trim()
        ? b.description.trim().slice(0, 2000)
        : null,
    billing,
    intervalCount,
    intervalUnit,
    price,
    currency,
    entitlements,
    familyAllowed,
    upgradeGroupKey,
    agreementRequired: Boolean(b.agreementRequired),
    pauseAllowed: b.pauseAllowed === undefined ? true : Boolean(b.pauseAllowed),
    locationId,
    categoryId: "categoryId" in b ? b.categoryId : undefined,
    merchandising,
  };
}

export async function listMembershipPlans(
  actor: MembershipsActor,
  opts?: { includeArchived?: boolean; locationId?: string | null }
): Promise<MembershipPlanDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const scope = await locationScopeFilter(actor);

  const where: Prisma.MembershipPlanWhereInput = { orgId };
  if (!opts?.includeArchived) {
    where.archivedAt = null;
    // Defensive: never treat park plans stamped to a soft-archived venue as
    // sellable/active catalog (venue archive should have set archivedAt).
    where.AND = [
      {
        OR: [
          { locationId: null },
          { location: { is: { status: { not: "archived" } } } },
        ],
      },
    ];
  }
  // Org-default (null) plans always visible; park-specific filtered by scope.
  if (opts?.locationId) {
    await requireActorVenueInScope(actor, opts.locationId, {
      allowArchived: true,
    });
    where.OR = [{ locationId: null }, { locationId: opts.locationId }];
  } else if (scope.parkLocked) {
    if (scope.locationIds?.length) {
      where.OR = [
        { locationId: null },
        { locationId: { in: scope.locationIds } },
      ];
    } else if (scope.locationId) {
      where.OR = [{ locationId: null }, { locationId: scope.locationId }];
    } else {
      where.id = "__none__";
    }
  } else if (scope.locationId) {
    where.OR = [{ locationId: null }, { locationId: scope.locationId }];
  }

  const rows = await prisma.membershipPlan.findMany({
    where,
    include: PLAN_CATEGORY_INCLUDE,
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  return rows.map(toDto);
}

export async function getMembershipPlan(
  actor: MembershipsActor,
  planId: string
): Promise<MembershipPlanDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(planId, "planId");
  const row = await prisma.membershipPlan.findFirst({
    where: { id, orgId },
    include: PLAN_CATEGORY_INCLUDE,
  });
  if (!row) throw new ForbiddenError(PLAN_NOT_FOUND);
  if (row.locationId) {
    await assertLocationInMembershipScope(actor, row.locationId);
  }
  return toDto(row);
}

export async function createMembershipPlan(
  actor: MembershipsActor,
  body: unknown
): Promise<MembershipPlanDto> {
  const orgId = await assertMembershipsStaff(actor);
  const data = parseCreateBody(body);
  const scope = await locationScopeFilter(actor);
  // Park-locked seats cannot create org-default (null) plans — stamp assigned park.
  if (scope.parkLocked) {
    if (!data.locationId) {
      if (scope.locationId) {
        data.locationId = scope.locationId;
      } else {
        throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
      }
    }
    await requireActorVenueInScope(actor, data.locationId);
  } else if (data.locationId) {
    await requireActorVenueInScope(actor, data.locationId);
  }

  const categoryId =
    data.categoryId === undefined
      ? null
      : await resolveMembershipCategoryId(orgId, data.categoryId);

  data.entitlements.addOnProductIds = await resolveAndValidateAddOnProductIds(
    orgId,
    data.entitlements.addOnProductIds,
    {
      parkLocked: scope.parkLocked,
      allowedLocationIds: scope.parkLocked
        ? scope.locationIds?.length
          ? scope.locationIds
          : scope.locationId
            ? [scope.locationId]
            : []
        : null,
    }
  );
  {
    const resolved = await resolveAndValidateAttachedForms(
      actor,
      data.entitlements.formIds ??
        data.entitlements.attachedForms?.map((f) => f.id)
    );
    data.entitlements.formIds = resolved.formIds;
    data.entitlements.attachedForms = resolved.attachedForms;
  }
  const m = merchandisingCreateData(data.merchandising);
  // Fail-closed: enabled flag without any resolved add-ons → treat as off.
  if (m.addOnsEnabled && !(data.entitlements.addOnProductIds?.length)) {
    m.addOnsEnabled = false;
  }
  if (m.formsEnabled && !(data.entitlements.formIds?.length)) {
    m.formsEnabled = false;
  }
  const row = await prisma.membershipPlan.create({
    data: {
      orgId,
      locationId: data.locationId,
      categoryId,
      name: data.name,
      description: data.description,
      billing: data.billing,
      intervalCount: data.intervalCount,
      intervalUnit: data.intervalUnit,
      price: data.price,
      currency: data.currency,
      entitlements: data.entitlements as Prisma.InputJsonValue,
      familyAllowed: data.familyAllowed,
      upgradeGroupKey: data.upgradeGroupKey,
      agreementRequired: data.agreementRequired,
      pauseAllowed: data.pauseAllowed,
      membershipType: m.membershipType,
      detailedDescription: m.detailedDescription,
      physicalPassMessage: m.physicalPassMessage,
      imageUrl: m.imageUrl,
      tags: m.tags,
      daysValidFromPurchase: m.daysValidFromPurchase,
      daysValidFromRedemption: m.daysValidFromRedemption,
      redemptionStartsAt: m.redemptionStartsAt,
      redemptionEndsAt: m.redemptionEndsAt,
      customRedemptionDescription: m.customRedemptionDescription,
      salesStartsAt: m.salesStartsAt,
      salesEndsAt: m.salesEndsAt,
      hideFromOnlineSales: m.hideFromOnlineSales,
      addOnsEnabled: m.addOnsEnabled,
      alternateAddress: m.alternateAddress,
      cancellationTerms: m.cancellationTerms,
      formsEnabled: m.formsEnabled,
      instructions: m.instructions,
      reportingCategory: m.reportingCategory,
      overrideTax: m.overrideTax,
      termsAndConditions: m.termsAndConditions,
      variations: m.variations as Prisma.InputJsonValue,
    },
    include: PLAN_CATEGORY_INCLUDE,
  });

  logStaffActivityEntry(actor, {
    action: "membership_plan.create",
    entityType: "MembershipPlan",
    entityId: row.id,
    description: `Created membership plan “${row.name}”`,
    metadata: { billing: row.billing, locationId: row.locationId },
  });

  return toDto(row);
}

export async function updateMembershipPlan(
  actor: MembershipsActor,
  planId: string,
  body: unknown
): Promise<MembershipPlanDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(planId, "planId");
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const existing = await prisma.membershipPlan.findFirst({
    where: { id, orgId },
  });
  if (!existing) throw new ForbiddenError(PLAN_NOT_FOUND);
  await assertCanMutateMembershipPlan(actor, existing);
  if (existing.archivedAt) {
    throw new Error("Archived plans cannot be edited — recreate or keep archived");
  }

  const b = body as Record<string, unknown>;
  const data: Prisma.MembershipPlanUpdateInput = {};

  if ("name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) throw new Error("name is required");
    data.name = name.slice(0, 200);
  }
  if ("description" in b) {
    data.description =
      typeof b.description === "string" && b.description.trim()
        ? b.description.trim().slice(0, 2000)
        : null;
  }
  if ("billing" in b) data.billing = parseBilling(b.billing);
  if ("price" in b) data.price = parsePrice(b.price);
  if ("currency" in b) {
    data.currency = parseCurrency(b.currency);
  }
  if ("intervalCount" in b) {
    if (b.intervalCount == null || b.intervalCount === "") {
      data.intervalCount = null;
    } else {
      const n = Number(b.intervalCount);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        throw new Error("intervalCount must be an integer from 1 to 120");
      }
      data.intervalCount = n;
    }
  }
  if ("intervalUnit" in b) data.intervalUnit = parseIntervalUnit(b.intervalUnit);
  let patchedAddOnIds: string[] | undefined;
  let patchedFormIds: string[] | undefined;
  if ("entitlements" in b) {
    const ent = sanitizeEntitlementsForWrite(b.entitlements);
    const rawEnt =
      b.entitlements &&
      typeof b.entitlements === "object" &&
      !Array.isArray(b.entitlements)
        ? (b.entitlements as Record<string, unknown>)
        : null;
    if (rawEnt && "addOnProductIds" in rawEnt) {
      const scope = await locationScopeFilter(actor);
      ent.addOnProductIds = await resolveAndValidateAddOnProductIds(
        orgId,
        ent.addOnProductIds,
        {
          excludePlanId: id,
          parkLocked: scope.parkLocked,
          allowedLocationIds: scope.parkLocked
            ? scope.locationIds?.length
              ? scope.locationIds
              : scope.locationId
                ? [scope.locationId]
                : []
            : null,
        }
      );
      patchedAddOnIds = ent.addOnProductIds;
    }
    if (rawEnt && ("formIds" in rawEnt || "attachedForms" in rawEnt)) {
      const resolved = await resolveAndValidateAttachedForms(
        actor,
        ent.formIds ?? ent.attachedForms?.map((f) => f.id)
      );
      ent.formIds = resolved.formIds;
      ent.attachedForms = resolved.attachedForms;
      patchedFormIds = resolved.formIds;
    }
    data.entitlements = ent as Prisma.InputJsonValue;
  }
  if ("familyAllowed" in b) data.familyAllowed = Boolean(b.familyAllowed);
  if ("agreementRequired" in b) {
    data.agreementRequired = Boolean(b.agreementRequired);
  }
  if ("pauseAllowed" in b) data.pauseAllowed = Boolean(b.pauseAllowed);
  if ("upgradeGroupKey" in b) {
    data.upgradeGroupKey =
      typeof b.upgradeGroupKey === "string" && b.upgradeGroupKey.trim()
        ? b.upgradeGroupKey.trim().slice(0, 80)
        : null;
  }

  const merchPatch = parseMerchandisingFromBody(b, { partial: true });
  if (merchPatch.membershipType !== undefined) {
    data.membershipType = merchPatch.membershipType;
    data.familyAllowed = merchPatch.membershipType === "group";
  }
  if (merchPatch.detailedDescription !== undefined) {
    data.detailedDescription = merchPatch.detailedDescription;
  }
  if (merchPatch.physicalPassMessage !== undefined) {
    data.physicalPassMessage = merchPatch.physicalPassMessage;
  }
  if (merchPatch.imageUrl !== undefined) data.imageUrl = merchPatch.imageUrl;
  if (merchPatch.tags !== undefined) data.tags = merchPatch.tags;
  if (merchPatch.daysValidFromPurchase !== undefined) {
    data.daysValidFromPurchase = merchPatch.daysValidFromPurchase;
  }
  if (merchPatch.daysValidFromRedemption !== undefined) {
    data.daysValidFromRedemption = merchPatch.daysValidFromRedemption;
  }
  if (merchPatch.redemptionStartsAt !== undefined) {
    data.redemptionStartsAt = merchPatch.redemptionStartsAt;
  }
  if (merchPatch.redemptionEndsAt !== undefined) {
    data.redemptionEndsAt = merchPatch.redemptionEndsAt;
  }
  if (merchPatch.customRedemptionDescription !== undefined) {
    data.customRedemptionDescription = merchPatch.customRedemptionDescription;
  }
  if (merchPatch.salesStartsAt !== undefined) {
    data.salesStartsAt = merchPatch.salesStartsAt;
  }
  if (merchPatch.salesEndsAt !== undefined) {
    data.salesEndsAt = merchPatch.salesEndsAt;
  }
  if (merchPatch.hideFromOnlineSales !== undefined) {
    data.hideFromOnlineSales = merchPatch.hideFromOnlineSales;
  }
  if (merchPatch.addOnsEnabled !== undefined) {
    data.addOnsEnabled = merchPatch.addOnsEnabled;
  }
  // Keep flag ↔ ids consistent when either side is patched.
  {
    const nextEnabled =
      merchPatch.addOnsEnabled !== undefined
        ? merchPatch.addOnsEnabled
        : existing.addOnsEnabled;
    const nextIds =
      patchedAddOnIds !== undefined
        ? patchedAddOnIds
        : parseEntitlements(existing.entitlements).addOnProductIds ?? [];
    if (nextEnabled && nextIds.length === 0) {
      data.addOnsEnabled = false;
    }
  }
  if (merchPatch.alternateAddress !== undefined) {
    data.alternateAddress = merchPatch.alternateAddress;
  }
  if (merchPatch.cancellationTerms !== undefined) {
    data.cancellationTerms = merchPatch.cancellationTerms;
  }
  if (merchPatch.formsEnabled !== undefined) {
    data.formsEnabled = merchPatch.formsEnabled;
  }
  {
    const nextEnabled =
      merchPatch.formsEnabled !== undefined
        ? merchPatch.formsEnabled
        : existing.formsEnabled;
    const nextIds =
      patchedFormIds !== undefined
        ? patchedFormIds
        : parseEntitlements(existing.entitlements).formIds ?? [];
    if (nextEnabled && nextIds.length === 0) {
      data.formsEnabled = false;
    }
  }
  if (merchPatch.instructions !== undefined) {
    data.instructions = merchPatch.instructions;
  }
  if (merchPatch.reportingCategory !== undefined) {
    data.reportingCategory = merchPatch.reportingCategory;
  }
  if ("categoryId" in b) {
    const resolved = await resolveMembershipCategoryId(orgId, b.categoryId);
    if (resolved == null) {
      data.category = { disconnect: true };
    } else {
      data.category = { connect: { id: resolved } };
    }
  }
  if (merchPatch.overrideTax !== undefined) {
    data.overrideTax = merchPatch.overrideTax;
  }
  if (merchPatch.termsAndConditions !== undefined) {
    data.termsAndConditions = merchPatch.termsAndConditions;
  }
  if (merchPatch.variations !== undefined) {
    data.variations = merchPatch.variations as Prisma.InputJsonValue;
    const fromVar = primaryFromVariations(merchPatch.variations);
    if (fromVar) {
      data.price = fromVar.price;
      data.billing = fromVar.billing;
      data.intervalCount = fromVar.intervalCount;
      data.intervalUnit = fromVar.intervalUnit;
    }
  }

  // Keep membershipType ↔ familyAllowed aligned when only familyAllowed patched.
  if ("familyAllowed" in b && merchPatch.membershipType === undefined) {
    data.membershipType = Boolean(b.familyAllowed) ? "group" : "single";
  }

  let locationIdChanged = false;
  if ("locationId" in b) {
    const prev = existing.locationId;
    if (b.locationId == null || b.locationId === "") {
      const scope = await locationScopeFilter(actor);
      if (scope.parkLocked) {
        throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
      }
      data.location = { disconnect: true };
      locationIdChanged = prev != null;
    } else if (typeof b.locationId === "string" && isValidId(b.locationId)) {
      await requireActorVenueInScope(actor, b.locationId);
      data.location = { connect: { id: b.locationId } };
      locationIdChanged = prev !== b.locationId;
    } else {
      throw new Error("locationId is invalid");
    }
  }

  const billing = (data.billing as MembershipPlanBilling | undefined) ?? existing.billing;
  const intervalCount =
    data.intervalCount !== undefined
      ? (data.intervalCount as number | null)
      : existing.intervalCount;
  const intervalUnit =
    data.intervalUnit !== undefined
      ? (data.intervalUnit as MembershipIntervalUnit | null)
      : existing.intervalUnit;
  if (billing === "recurring" && (intervalCount == null || !intervalUnit)) {
    throw new Error("recurring plans require intervalCount and intervalUnit");
  }

  // Stamp change invalidates the redeem matrix — clear so admin reconfigures.
  const row = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.membershipPlan.update({
        where: { id },
        data,
        include: PLAN_CATEGORY_INCLUDE,
      });
      if (locationIdChanged) {
        await tx.membershipVenueEligibility.deleteMany({
          where: { orgId, planId: id },
        });
      }
      return updated;
    },
    { maxWait: 10_000, timeout: 15_000 }
  );

  logStaffActivityEntry(actor, {
    action: "membership_plan.update",
    entityType: "MembershipPlan",
    entityId: row.id,
    description: `Updated membership plan “${row.name}”`,
    metadata: locationIdChanged ? { eligibilityCleared: true } : undefined,
  });

  return toDto(row);
}

export async function archiveMembershipPlan(
  actor: MembershipsActor,
  planId: string
): Promise<MembershipPlanDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(planId, "planId");
  const existing = await prisma.membershipPlan.findFirst({
    where: { id, orgId },
    include: PLAN_CATEGORY_INCLUDE,
  });
  if (!existing) throw new ForbiddenError(PLAN_NOT_FOUND);
  await assertCanMutateMembershipPlan(actor, existing);
  if (existing.archivedAt) return toDto(existing);

  // Soft-archive. Keep eligibility while live members still redeem (home works
  // without a row; visiting parks need the matrix). Drop eligibility only when
  // no non-terminal GuestMembership remains on this plan.
  const row = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.membershipPlan.update({
        where: { id },
        data: { archivedAt: new Date() },
        include: PLAN_CATEGORY_INCLUDE,
      });
      const liveMembers = await tx.guestMembership.count({
        where: {
          orgId,
          planId: id,
          status: { notIn: ["cancelled", "expired"] },
        },
      });
      if (liveMembers === 0) {
        await tx.membershipVenueEligibility.deleteMany({
          where: { orgId, planId: id },
        });
      }
      return updated;
    },
    { maxWait: 10_000, timeout: 15_000 }
  );

  logStaffActivityEntry(actor, {
    action: "membership_plan.archive",
    entityType: "MembershipPlan",
    entityId: row.id,
    description: `Archived membership plan “${row.name}”`,
  });

  return toDto(row);
}
