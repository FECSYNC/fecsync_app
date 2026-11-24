/**
 * Company SaaS plan-limit enforcement.
 *
 * Policy: registered companies must have an **entitled** subscription
 * (`active` | `trialing` | `past_due` with a future `subscriptionEndsAt`)
 * before plan-capped creates. Harewa approve alone (`subscriptionStatus: none`)
 * does **not** unlock venues / catalog / members / seats — Checkout or an ops
 * plan stamp required. Aligns with Fresh overdue rules: past period end and
 * `past_due` + null endsAt are not create-entitled.
 * With an entitled status but null/empty subscriptionPlan → **starter** floors.
 * Enterprise null caps = unlimited. Harewa storefront / isDefault org is never
 * plan-capped for catalog/seats — except `venues`, which is registered-company-only
 * and denied on storefront (fail-closed).
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { getStorefrontOrgId } from "@/lib/org";
import {
  getPlanLimits,
  isSubscriptionPlanId,
  type PlanLimits,
  type SubscriptionPlanId,
} from "@/lib/subscriptionPlans";
import {
  countActiveVenueLocations,
  VENUE_STOREFRONT_MESSAGE,
} from "@/lib/venueLocationMeter";

export type PlanResource =
  | "venues"
  | "members"
  | "roleTemplates"
  | "products"
  | "fabrics"
  | "categories"
  | "tailorSeats"
  | "campaigns"
  | "tailorClients"
  | "ticketsPerMonth"
  | "bookingPackages"
  | "posTerminals";

export const PLAN_LIMIT_REACHED_PREFIX = "Plan limit reached for";

/** Stable ForbiddenError when org is active but has not subscribed / ops-stamped. */
export const BILLING_REQUIRED_MESSAGE =
  "Subscribe to a plan before using this feature. Open Billing to choose a package.";
// Client soft-gates must use the same string via src/utils/planLimitSoftGate.ts
// (cannot import this prisma-backed module from the browser).

/** Route catch helpers — map Forbidden plan/billing gates to 400/403 consistently. */
export function isPlanLimitOrBillingGateMessage(message: string): boolean {
  return (
    message.includes(PLAN_LIMIT_REACHED_PREFIX) ||
    message.includes("Subscribe to a plan before using this feature")
  );
}

/**
 * Stable API / soft-gate contract — use PlanResource ids (members, products, …),
 * not prose labels. Client soft-gates build the same pattern without importing
 * this prisma-backed module.
 */
export function planLimitReachedMessage(
  resource: PlanResource,
  plan: string
): string {
  return `${PLAN_LIMIT_REACHED_PREFIX} ${resource} on the ${plan} plan`;
}

/** Stripe- or ops-backed statuses that *may* unlock plan-capped writes. */
export function isCompanySubscriptionEntitled(
  subscriptionStatus: string | null | undefined
): boolean {
  return (
    subscriptionStatus === "active" ||
    subscriptionStatus === "trialing" ||
    subscriptionStatus === "past_due"
  );
}

/**
 * Create entitlement aligned with Fresh overdue / soft-deny rules.
 * Status alone is not enough — overdue endsAt and past_due without endsAt
 * must not unlock plan-capped creates (closes Fresh→create TOCTOU).
 */
export function isCompanyBillingCreateEntitled(opts: {
  subscriptionStatus: string | null | undefined;
  subscriptionEndsAt?: Date | string | null;
  /** When provided, non-active orgs (pending/suspended) are never entitled. */
  orgStatus?: string | null;
}): boolean {
  if (opts.orgStatus != null && opts.orgStatus !== "active") {
    return false;
  }
  if (!isCompanySubscriptionEntitled(opts.subscriptionStatus)) {
    return false;
  }
  const raw = opts.subscriptionEndsAt;
  const endsAt =
    raw == null
      ? null
      : raw instanceof Date
        ? raw
        : new Date(raw);
  const endsAtValid =
    endsAt != null && !Number.isNaN(endsAt.getTime()) ? endsAt : null;

  // Mirror assertOrganizationActive: past_due without endsAt is soft-denied.
  if (opts.subscriptionStatus === "past_due" && endsAtValid == null) {
    return false;
  }
  // Overdue live period — not create-entitled (lazy expire may still be racing).
  if (endsAtValid != null && endsAtValid.getTime() < Date.now()) {
    return false;
  }
  return true;
}

export type UsageMeter = {
  resource: PlanResource;
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
};

export type UsageSnapshot = {
  orgId: string;
  plan: SubscriptionPlanId | null;
  planResolved: SubscriptionPlanId;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  /** False when creates are blocked until Checkout / ops grant. */
  billingEntitled: boolean;
  limits: PlanLimits;
  meters: UsageMeter[];
  /** Resources where used > capped limit (keep data; block creates; upgrade or remove). */
  overLimitResources: PlanResource[];
  /** User ids that currently burn a tailorSeats slot (membership ∪ live studio). */
  tailorSeatOccupantUserIds: string[];
};

const RESOURCES: PlanResource[] = [
  "venues",
  "members",
  "roleTemplates",
  "products",
  "fabrics",
  "categories",
  "tailorSeats",
  "campaigns",
  "tailorClients",
  "ticketsPerMonth",
  "bookingPackages",
  "posTerminals",
];

const UNLIMITED_LIMITS: PlanLimits = {
  venues: null,
  members: null,
  roleTemplates: null,
  products: null,
  fabrics: null,
  categories: null,
  tailorSeats: null,
  campaigns: null,
  tailorClients: null,
  ticketsPerMonth: null,
  bookingPackages: null,
  posTerminals: null,
};

const ZERO_LIMITS: PlanLimits = {
  venues: 0,
  members: 0,
  roleTemplates: 0,
  products: 0,
  fabrics: 0,
  categories: 0,
  tailorSeats: 0,
  campaigns: 0,
  tailorClients: 0,
  ticketsPerMonth: 0,
  bookingPackages: 0,
  posTerminals: 0,
};

async function isStorefrontBillingOrg(orgId: string): Promise<boolean> {
  const id = requireId(orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();
  if (id === storefrontOrgId) return true;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { isDefault: true },
  });
  return Boolean(org?.isDefault);
}

/**
 * Resolve effective plan id for limits.
 * null/empty plan → starter floors **only when subscription is entitled**;
 * unpaid (`none` / canceled / expired) creates are blocked separately.
 */
export async function resolveOrgPlanId(
  orgId: string
): Promise<{
  plan: SubscriptionPlanId | null;
  planResolved: SubscriptionPlanId;
  subscriptionStatus: string | null;
  subscriptionEndsAt: Date | null;
  orgStatus: string | null;
}> {
  const id = requireId(orgId, "orgId");
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      status: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });
  const raw = org?.subscriptionPlan?.trim().toLowerCase() || null;
  const plan = raw && isSubscriptionPlanId(raw) ? raw : null;
  return {
    plan,
    planResolved: plan ?? "starter",
    subscriptionStatus: org?.subscriptionStatus ?? null,
    subscriptionEndsAt: org?.subscriptionEndsAt ?? null,
    orgStatus: org?.status ?? null,
  };
}

type ResolvedOrgPlan = Awaited<ReturnType<typeof resolveOrgPlanId>>;

/**
 * Tenant billing gate (README Module entitlement contract).
 * Storefront uncapped. Company tenants need active|trialing|past_due
 * (Checkout or Harewa ops grant). Approve-without-plan stays `none` → deny.
 * Prefer calling this (and/or assertWithinPlanLimit) on every entitled create.
 */
export async function assertCompanyBillingEntitled(orgId: string): Promise<void> {
  const id = requireId(orgId, "orgId");
  if (await isStorefrontBillingOrg(id)) return;
  await requireCompanyBillingEntitled(id);
}

/** Shared entitled resolve for assertWithinPlanLimit (single DB read). */
async function requireCompanyBillingEntitled(
  orgId: string
): Promise<ResolvedOrgPlan> {
  const resolved = await resolveOrgPlanId(orgId);
  if (
    !isCompanyBillingCreateEntitled({
      subscriptionStatus: resolved.subscriptionStatus,
      subscriptionEndsAt: resolved.subscriptionEndsAt,
      orgStatus: resolved.orgStatus,
    })
  ) {
    throw new ForbiddenError(BILLING_REQUIRED_MESSAGE);
  }
  return resolved;
}

/**
 * Distinct providers that burn a tailorSeats slot:
 * - non-suspended TailorProfile (live studio), or
 * - live tailor Membership with **no** TailorProfile yet (reserved invite).
 * Suspending a studio frees the seat even if Membership stays rolePreset=tailor.
 */
export async function listTailorSeatOccupantUserIds(
  orgId: string
): Promise<string[]> {
  const id = requireId(orgId, "orgId");
  const [members, liveProfiles, anyProfiles] = await Promise.all([
    prisma.membership.findMany({
      where: {
        orgId: id,
        rolePreset: "tailor",
        status: { in: ["active", "invited"] },
      },
      select: { userId: true },
    }),
    prisma.tailorProfile.findMany({
      where: {
        orgId: id,
        status: { not: "suspended" },
      },
      select: { userId: true },
    }),
    prisma.tailorProfile.findMany({
      where: { orgId: id },
      select: { userId: true },
    }),
  ]);
  const hasProfile = new Set(anyProfiles.map((row) => row.userId));
  const ids = new Set<string>();
  for (const row of liveProfiles) ids.add(row.userId);
  for (const row of members) {
    if (!hasProfile.has(row.userId)) ids.add(row.userId);
  }
  return [...ids];
}

/**
 * Confirmed ticket heads in the current calendar month of each booking's venue
 * timezone (falls back to UTC). Same head rule as confirmBooking
 * (`bookingTicketHeadCount`): add-on lines never count; a party booking counts
 * `kidCount + adultCount` once from PartyBookingDetail and its party_package
 * lines are skipped, so the TicketCredentials issued for those heads are not
 * counted a second time.
 */
export async function countConfirmedTicketHeadsThisMonth(
  orgId: string
): Promise<number> {
  const id = requireId(orgId, "orgId");
  const now = new Date();
  try {
    const parties = await prisma.partyBookingDetail.findMany({
      where: { orgId: id, booking: { status: "confirmed" } },
      select: {
        kidCount: true,
        adultCount: true,
        booking: {
          select: {
            visitStartsAt: true,
            createdAt: true,
            location: { select: { timezone: true } },
          },
        },
      },
      take: 50_000,
    });
    let partySum = 0;
    for (const party of parties) {
      const at = party.booking.visitStartsAt ?? party.booking.createdAt;
      const tz = party.booking.location?.timezone?.trim() || "UTC";
      if (isSameCalendarMonth(at, now, tz)) {
        partySum += Math.max(0, party.kidCount) + Math.max(0, party.adultCount);
      }
    }
    const lines = await prisma.bookingLine.findMany({
      where: {
        orgId: id,
        productType: { notIn: ["add_on", "party_package"] },
        booking: { status: "confirmed" },
      },
      select: {
        qty: true,
        booking: {
          select: {
            visitStartsAt: true,
            createdAt: true,
            location: { select: { timezone: true } },
          },
        },
      },
      take: 50_000,
    });
    let sum = partySum;
    for (const line of lines) {
      const at = line.booking.visitStartsAt ?? line.booking.createdAt;
      const tz = line.booking.location?.timezone?.trim() || "UTC";
      if (isSameCalendarMonth(at, now, tz)) {
        sum += line.qty;
      }
    }
    return sum;
  } catch {
    // Schema may not be migrated yet in some local boots — meter stays 0.
    return 0;
  }
}

function isSameCalendarMonth(at: Date, now: Date, timeZone: string): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
    });
    const partsAt = Object.fromEntries(
      fmt.formatToParts(at).map((p) => [p.type, p.value])
    );
    const partsNow = Object.fromEntries(
      fmt.formatToParts(now).map((p) => [p.type, p.value])
    );
    return (
      partsAt.year === partsNow.year && partsAt.month === partsNow.month
    );
  } catch {
    return (
      at.getUTCFullYear() === now.getUTCFullYear() &&
      at.getUTCMonth() === now.getUTCMonth()
    );
  }
}

export async function countPlanResource(
  orgId: string,
  resource: PlanResource
): Promise<number> {
  const id = requireId(orgId, "orgId");
  switch (resource) {
    case "venues":
      // Only `active` burns quota — archived rows are retained but free the cap.
      return countActiveVenueLocations(id);
    case "members":
      return prisma.membership.count({
        where: {
          orgId: id,
          status: { in: ["active", "invited"] },
        },
      });
    case "roleTemplates":
      return prisma.roleTemplate.count({ where: { orgId: id } });
    case "products":
      return prisma.product.count({ where: { orgId: id } });
    case "fabrics":
      return prisma.fabric.count({ where: { orgId: id } });
    case "categories":
      return prisma.productCategory.count({ where: { orgId: id } });
    case "tailorSeats": {
      const occupants = await listTailorSeatOccupantUserIds(id);
      return occupants.length;
    }
    case "campaigns":
      // Archived campaigns are retained for history but must not burn quota —
      // create UI tells operators to archive to free slots.
      // Suspended studios also free quota (soft-revoke/suspend keeps rows for
      // history but must not block the live org from creating replacements).
      return prisma.measurementCampaign.count({
        where: {
          orgId: id,
          status: { not: "archived" },
          tailorProfile: { status: { not: "suspended" } },
        },
      });
    case "tailorClients":
      return prisma.tailorClient.count({
        where: {
          tailorProfile: {
            orgId: id,
            status: { not: "suspended" },
          },
        },
      });
    case "ticketsPerMonth": {
      return countConfirmedTicketHeadsThisMonth(id);
    }
    case "bookingPackages":
      return prisma.bookingPackage.count({ where: { orgId: id } });
    case "posTerminals":
      return prisma.posDevice.count({ where: { orgId: id, archivedAt: null } });
    default: {
      const _exhaustive: never = resource;
      return _exhaustive;
    }
  }
}

function limitValue(limits: PlanLimits, resource: PlanResource): number | null {
  return limits[resource];
}

export async function assertWithinPlanLimit(
  orgId: string,
  resource: PlanResource,
  adding: number = 1,
  actor?: { preset?: string | null; membershipRole?: string | null; orgId?: string | null; storefrontOrgId?: string | null } | null
): Promise<void> {
  const id = requireId(orgId, "orgId");
  // Catalog/seat caps do not apply to the public storefront org — except venues:
  // VenueLocation is registered-company-only. Fail closed here so a caller that
  // only hits planLimits cannot create storefront venues as "unlimited".
  // Platform software owner may create venues on the host without a company seat.
  if (await isStorefrontBillingOrg(id)) {
    if (
      resource === "venues" ||
      resource === "bookingPackages" ||
      resource === "posTerminals"
    ) {
      const { resolveIsPlatformSoftwareOwner } = await import(
        "@/lib/resolvePlatformSoftwareOwner"
      );
      if (resource === "venues" && actor && (await resolveIsPlatformSoftwareOwner(actor))) {
        return;
      }
      throw new ForbiddenError(
        resource === "venues"
          ? VENUE_STOREFRONT_MESSAGE
          : resource === "posTerminals"
            ? "Park POS devices are not available on the storefront"
            : "FECSYNC storefront cannot create marketplace booking packages"
      );
    }
    return;
  }

  // Reject fractional/zero client-style counts — floor alone would allow 0.5 → 0 bypass.
  const add =
    Number.isFinite(adding) && adding > 0
      ? Math.max(1, Math.floor(adding))
      : 1;
  // Same tenant gate as assertCompanyBillingEntitled (single resolve — no drift).
  const { planResolved } = await requireCompanyBillingEntitled(id);
  const limits = getPlanLimits(planResolved);
  const cap = limitValue(limits, resource);
  if (cap == null) return; // unlimited

  const used = await countPlanResource(id, resource);
  if (used + add > cap) {
    throw new ForbiddenError(planLimitReachedMessage(resource, planResolved));
  }
}

/** True when this user already burns a tailorSeats slot in the org. */
export async function userOccupiesTailorSeat(
  orgId: string,
  userId: string
): Promise<boolean> {
  const oid = requireId(orgId, "orgId");
  const uid = requireId(userId, "userId");
  const occupants = await listTailorSeatOccupantUserIds(oid);
  return occupants.includes(uid);
}

/**
 * Assert tailorSeats only when this user is not already counted (avoids
 * double-charging staff who already have a live studio, or promoting a
 * studio owner into rolePreset=tailor).
 */
export async function assertNewTailorSeat(
  orgId: string,
  userId: string
): Promise<void> {
  if (await userOccupiesTailorSeat(orgId, userId)) return;
  await assertWithinPlanLimit(orgId, "tailorSeats");
}

/**
 * Before unsuspending / reactivating a studio, ensure its retained
 * campaigns + clients fit the target org's live meters (suspended profiles
 * are excluded from counts, so restore would otherwise overshoot).
 * Also re-checks tailorSeats for staff-owned studios that do not hold a
 * live rolePreset=tailor membership.
 */
export async function assertSuspendedStudioRosterFitsPlan(
  orgId: string,
  tailorProfileId: string
): Promise<void> {
  const oid = requireId(orgId, "orgId");
  const pid = requireId(tailorProfileId, "tailorProfileId");
  if (await isStorefrontBillingOrg(oid)) return;

  const profile = await prisma.tailorProfile.findFirst({
    where: { id: pid, orgId: oid },
    select: { userId: true },
  });
  if (!profile) return;

  await assertNewTailorSeat(oid, profile.userId);

  const [campaigns, clients] = await Promise.all([
    prisma.measurementCampaign.count({
      where: {
        tailorProfileId: pid,
        status: { not: "archived" },
      },
    }),
    prisma.tailorClient.count({
      where: { tailorProfileId: pid },
    }),
  ]);

  if (campaigns > 0) {
    await assertWithinPlanLimit(oid, "campaigns", campaigns);
  }
  if (clients > 0) {
    await assertWithinPlanLimit(oid, "tailorClients", clients);
  }
}

export async function getPlanUsageSnapshot(
  orgId: string
): Promise<UsageSnapshot> {
  const id = requireId(orgId, "orgId");
  // Align with assertWithinPlanLimit / resolveOrgPlanResourceCap: storefront
  // catalog/seats are uncapped. Venue creates on the storefront host are for
  // platform software owner only (API assert); meters stay unlimited for UI.
  if (await isStorefrontBillingOrg(id)) {
    const { plan, planResolved, subscriptionStatus, subscriptionEndsAt } =
      await resolveOrgPlanId(id);
    const tailorSeatOccupantUserIds = await listTailorSeatOccupantUserIds(id);
    const counts = await Promise.all(
      RESOURCES.map((r) =>
        r === "tailorSeats"
          ? Promise.resolve(tailorSeatOccupantUserIds.length)
          : countPlanResource(id, r)
      )
    );
    const meters: UsageMeter[] = RESOURCES.map((resource, i) => {
      const used = counts[i]!;
      if (resource === "venues") {
        // Platform software owner may host venues on the storefront org;
        // registered-company API gates still deny non-owner storefront creates.
        return {
          resource,
          used,
          limit: null,
          remaining: null,
          unlimited: true,
        };
      }
      return {
        resource,
        used,
        limit: null,
        remaining: null,
        unlimited: true,
      };
    });
    return {
      orgId: id,
      plan,
      planResolved,
      subscriptionStatus,
      subscriptionEndsAt: subscriptionEndsAt
        ? subscriptionEndsAt.toISOString()
        : null,
      billingEntitled: true,
      // Storefront host (platform Super admin) may create venues without a
      // company plan meter — keep venues unlimited here to match meters.
      limits: { ...UNLIMITED_LIMITS },
      meters,
      overLimitResources: [] as PlanResource[],
      tailorSeatOccupantUserIds,
    };
  }

  const { plan, planResolved, subscriptionStatus, subscriptionEndsAt, orgStatus } =
    await resolveOrgPlanId(id);
  const billingEntitled = isCompanyBillingCreateEntitled({
    subscriptionStatus,
    subscriptionEndsAt,
    orgStatus,
  });
  const limits = getPlanLimits(planResolved);

  const tailorSeatOccupantUserIds = await listTailorSeatOccupantUserIds(id);
  const counts = await Promise.all(
    RESOURCES.map((r) =>
      r === "tailorSeats"
        ? Promise.resolve(tailorSeatOccupantUserIds.length)
        : countPlanResource(id, r)
    )
  );

  const meters: UsageMeter[] = RESOURCES.map((resource, i) => {
    const used = counts[i]!;
    // Unpaid: show used vs 0 so dashboards mirror hard create blocks.
    const limit = billingEntitled ? limitValue(limits, resource) : 0;
    const unlimited = billingEntitled && limit == null;
    return {
      resource,
      used,
      limit: unlimited ? null : limit,
      remaining: unlimited || limit == null ? null : Math.max(0, limit - used),
      unlimited,
    };
  });

  const overLimitResources = meters
    .filter(
      (m) =>
        !m.unlimited &&
        m.limit != null &&
        m.used > m.limit
    )
    .map((m) => m.resource);

  return {
    orgId: id,
    plan,
    planResolved,
    subscriptionStatus,
    subscriptionEndsAt: subscriptionEndsAt
      ? subscriptionEndsAt.toISOString()
      : null,
    billingEntitled,
    limits: billingEntitled ? limits : { ...ZERO_LIMITS },
    meters,
    overLimitResources,
    tailorSeatOccupantUserIds,
  };
}

/** Cap for list/UI mirrors. Unlimited (enterprise / storefront catalog) → MAX_SAFE_INTEGER. Unpaid → 0. Venues on storefront → 0. */
export async function resolveOrgPlanResourceCap(
  orgId: string,
  resource: PlanResource
): Promise<number> {
  const id = requireId(orgId, "orgId");
  if (await isStorefrontBillingOrg(id)) {
    // Match assertWithinPlanLimit: venues / bookingPackages / posTerminals never creatable on storefront.
    if (
      resource === "venues" ||
      resource === "bookingPackages" ||
      resource === "posTerminals"
    )
      return 0;
    return Number.MAX_SAFE_INTEGER;
  }
  const { planResolved, subscriptionStatus, subscriptionEndsAt, orgStatus } =
    await resolveOrgPlanId(id);
  if (
    !isCompanyBillingCreateEntitled({
      subscriptionStatus,
      subscriptionEndsAt,
      orgStatus,
    })
  ) {
    return 0;
  }
  const cap = getPlanLimits(planResolved)[resource];
  return cap == null ? Number.MAX_SAFE_INTEGER : cap;
}

// Enterprise HQ entitlement lives in `@/lib/enterpriseHq`
// (`assertEnterpriseHqEnabled`, `orgHasEnterpriseHq`) — not re-exported here
// to avoid a circular import with that module.
