/**
 * FECSYNC storefront platform approval for registered company workspaces.
 * Approve → active (admin unlock). Optional plan stamp → ops grant entitle.
 * set_plan → emergency stamp Demo|Starter|Growth|Enterprise on any company
 * (subscription fields only — never alters venues/catalog/orders/memberships).
 * Suspend → ops_hold soft lock (records kept; self-serve renew blocked).
 * Public storefront catalog is never locked.
 */

import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { asIdString, requireId } from "@/lib/ids";
import {
  getStorefrontOrgId,
  ORG_SUBSCRIPTION_PLANS,
  type OrgSubscriptionPlan,
} from "@/lib/org";
import { logPlatformActionOnCompany } from "@/lib/platformCompanyAudit";
import {
  organizationOpsHoldData,
  clearOrganizationBillingEventWatermark,
} from "@/lib/companyBilling";
import { clearCachedStaffGatesForOrg } from "@/lib/ticketing/staffGateCache";
import {
  isDemoTrialOverdueRow,
  isSoftBillingHoldRow,
  projectedActiveOrgWhere,
  projectedSuspendedOrgWhere,
  softBillingHoldWhere,
} from "@/lib/billingSoftHold";
import {
  DEFAULT_BILLING_DURATION_MONTHS,
  demoSubscriptionEndsAt,
  isBillingDurationMonths,
  isDemoPlanId,
  normalizeBillingDurationMonths,
  subscriptionEndsAtAfterMonths,
  subscriptionIntervalFromDurationMonths,
} from "@/lib/subscriptionPlans";
import { orgHasEnterpriseHq } from "@/lib/enterpriseHq";
import type { NormalizedAccessToken } from "@/lib/auth/claims";
import type { NextRequest } from "next/server";

export const ORG_NOT_FOUND_MESSAGE = "Organization not found";
export const ORG_NOT_REGISTERED_COMPANY_MESSAGE =
  "Only registered (non-storefront) companies can be approved here";
export const ORG_INVALID_PLAN_MESSAGE = "Invalid subscription plan";
export const ORG_APPROVE_STATUS_MESSAGE =
  "Only pending, suspended, or soft-held (overdue billing) companies can be approved";
export const ORG_APPROVE_SYNC_FAILED_MESSAGE =
  "Could not sync retained Stripe subscription; company left suspended. Retry approve when Stripe is reachable.";
export const ORG_APPROVE_PLAN_APPLY_FAILED_MESSAGE =
  "Stripe subscription is bound but plan could not be applied; company left suspended. Check Price→plan mapping and retry approve.";

/** Re-export pure soft-hold helpers (SSOT: `@/lib/billingSoftHold`). */
export {
  isDemoTrialOverdueRow,
  isSoftBillingHoldRow,
  projectedActiveOrgWhere,
  projectedSuspendedOrgWhere,
  softBillingHoldWhere,
};

/** Default page size for Company workspaces list (hot path). */
export const REGISTERED_COMPANIES_LIST_LIMIT = 40;
/** Hard cap so ops / smoke can ask for a larger page without loading unbounded rows. */
export const REGISTERED_COMPANIES_LIST_MAX = 200;

/** Ops grant window when approving with a plan stamp but no Stripe checkout yet. */
function opsGrantEndsAt(durationMonths?: unknown): Date {
  if (isBillingDurationMonths(durationMonths)) {
    return subscriptionEndsAtAfterMonths(durationMonths);
  }
  const raw = Number(process.env.COMPANY_OPS_GRANT_DAYS || "");
  if (Number.isFinite(raw) && raw > 0) {
    return new Date(Date.now() + raw * 24 * 60 * 60 * 1000);
  }
  return subscriptionEndsAtAfterMonths(DEFAULT_BILLING_DURATION_MONTHS);
}

function opsGrantInterval(durationMonths?: unknown): string {
  if (isBillingDurationMonths(durationMonths)) {
    return subscriptionIntervalFromDurationMonths(durationMonths);
  }
  return subscriptionIntervalFromDurationMonths(DEFAULT_BILLING_DURATION_MONTHS);
}

export async function assertStorefrontPlatformAdmin(
  actor: NormalizedAccessToken
): Promise<string> {
  const storefrontOrgId = await getStorefrontOrgId();
  const actorOrg = asIdString(actor.orgId);
  if (!actorOrg || actorOrg !== storefrontOrgId) {
    throw new ForbiddenError(
      "Only FECSYNC storefront admins can manage company approvals"
    );
  }
  if (actor.preset !== "platform_admin" && actor.membershipRole !== "platform_admin") {
    throw new ForbiddenError(
      "Only platform admins can manage company approvals"
    );
  }
  return storefrontOrgId;
}

const LAZY_EXPIRE_ROW_SELECT = {
  id: true,
  status: true,
  isDefault: true,
  subscriptionEndsAt: true,
  subscriptionStatus: true,
  subscriptionPlan: true,
} as const;

/**
 * Collect soft-skip org ids so list/metrics match Fresh.
 * Pass `applyLazyExpire: false` on hot list reads — only scans ids (2 queries)
 * without multi-round durable expire (cron / Fresh still apply expiry).
 * Prefer SQL filters (`projectedActiveOrgWhere` / `projectedSuspendedOrgWhere`)
 * on list/metrics hot paths instead of awaiting this collector.
 */
export async function collectSoftSuspendedRegisteredCompanyIds(input: {
  storefrontOrgId: string;
  now?: Date;
  reason: string;
  softHoldTake?: number;
  demoTake?: number;
  maxRounds?: number;
  /** Default true. List UI should set false for fast response. */
  applyLazyExpire?: boolean;
  /**
   * When false, skip the unbounded remaining-id scans (bg expire only).
   * Default true for callers that still need a full soft-skip id set.
   */
  collectRemainingIds?: boolean;
}): Promise<Set<string>> {
  const storefrontOrgId = input.storefrontOrgId;
  const now = input.now ?? new Date();
  const softHoldTake = input.softHoldTake ?? 40;
  const demoTake = input.demoTake ?? 20;
  const maxRounds = input.maxRounds ?? 8;
  const applyLazyExpire = input.applyLazyExpire !== false;
  const collectRemainingIds = input.collectRemainingIds !== false;
  const softSuspendedIds = new Set<string>();

  if (applyLazyExpire) {
    const { applyLazySubscriptionExpiryIfNeeded } = await import("@/lib/org");

    for (let round = 0; round < maxRounds; round++) {
      const skipIds =
        softSuspendedIds.size > 0
          ? [...softSuspendedIds, storefrontOrgId]
          : [storefrontOrgId];
      const overdue = await prisma.organization.findMany({
        where: {
          isDefault: false,
          id: { notIn: skipIds },
          ...softBillingHoldWhere(now),
        },
        select: LAZY_EXPIRE_ROW_SELECT,
        take: softHoldTake,
        orderBy: { subscriptionEndsAt: "asc" },
      });
      const demoOverdue = await prisma.organization.findMany({
        where: {
          isDefault: false,
          id: { notIn: skipIds },
          status: "active",
          subscriptionPlan: "demo",
          subscriptionEndsAt: { not: null, lt: now },
        },
        select: LAZY_EXPIRE_ROW_SELECT,
        take: demoTake,
        orderBy: { subscriptionEndsAt: "asc" },
      });
      const overdueRows = [
        ...overdue,
        ...demoOverdue.filter((d) => !overdue.some((o) => o.id === d.id)),
      ];
      if (overdueRows.length === 0) break;

      for (const row of overdueRows) {
        try {
          const after = await applyLazySubscriptionExpiryIfNeeded(
            row,
            input.reason
          );
          if (after.status === "suspended" && !after.didExpire) {
            softSuspendedIds.add(row.id);
          }
        } catch {
          softSuspendedIds.add(row.id);
        }
      }
    }
  }

  if (!collectRemainingIds) {
    return softSuspendedIds;
  }

  const [remainingSoftHolds, remainingDemoOverdue] = await Promise.all([
    prisma.organization.findMany({
      where: {
        isDefault: false,
        id: { not: storefrontOrgId },
        ...softBillingHoldWhere(now),
      },
      select: { id: true },
    }),
    prisma.organization.findMany({
      where: {
        isDefault: false,
        id: { not: storefrontOrgId },
        status: "active",
        subscriptionPlan: "demo",
        subscriptionEndsAt: { not: null, lt: now },
      },
      select: { id: true },
    }),
  ]);
  for (const row of remainingSoftHolds) {
    softSuspendedIds.add(row.id);
  }
  for (const row of remainingDemoOverdue) {
    softSuspendedIds.add(row.id);
  }

  return softSuspendedIds;
}

export type RegisteredCompanyListStatus =
  | "pending"
  | "active"
  | "suspended"
  | "all"
  | "offboard";

export type RegisteredCompanyListItem = {
  id: string;
  name: string;
  slug: string;
  /** Company Profile logo (Cloudinary URL) — null when unset. */
  logoUrl: string | null;
  status: string;
  billingSoftHold: boolean;
  subscriptionPlan: string | null;
  requestedPlan: string | null;
  requestedDurationMonths: number | null;
  subscriptionInterval: string | null;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  hasStripeCustomer: boolean;
  approvedAt: string | null;
  offboardRequestedAt: string | null;
  offboardedAt: string | null;
  memberCount: number;
  venuesActive: number;
  enterpriseHqEligible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RegisteredCompanyListResult = {
  companies: RegisteredCompanyListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

function clampRegisteredCompaniesLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) {
    return REGISTERED_COMPANIES_LIST_LIMIT;
  }
  const n = Math.floor(limit);
  if (n < 1) return REGISTERED_COMPANIES_LIST_LIMIT;
  return Math.min(n, REGISTERED_COMPANIES_LIST_MAX);
}

function mapRegisteredCompanyListRow(
  row: {
    id: string;
    name: string;
    slug: string;
    status: string;
    subscriptionPlan: string | null;
    requestedPlan: string | null;
    requestedDurationMonths: number | null;
    subscriptionStatus: string | null;
    subscriptionEndsAt: Date | null;
    subscriptionInterval: string | null;
    stripeCustomerId: string | null;
    approvedAt: Date | null;
    offboardRequestedAt: Date | null;
    offboardedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    companyProfile?: { logoUrl: string | null } | null;
    _count: { memberships: number; venueLocations: number };
  },
  now: Date
) {
  const softHold = isSoftBillingHoldRow({
    status: row.status,
    subscriptionStatus: row.subscriptionStatus,
    subscriptionEndsAt: row.subscriptionEndsAt,
    subscriptionPlan: row.subscriptionPlan,
    now,
  });
  const demoOverdue = isDemoTrialOverdueRow({
    status: row.status,
    subscriptionPlan: row.subscriptionPlan,
    subscriptionEndsAt: row.subscriptionEndsAt,
    now,
  });
  const softSuspended = softHold || demoOverdue;
  // Soft-deny / Stripe-outage: DB still active (paid soft-hold or Demo past
  // endsAt). Keep plan + endsAt so ops UI matches Fresh and Approve context.
  // Only blank those fields for durable DB-suspended rows in the soft set.
  const softDenyActive =
    softSuspended && row.status === "active" && !softHold;
  const keepBillingFields = softHold || softDenyActive;
  const subscriptionPlan = keepBillingFields
    ? row.subscriptionPlan
    : softSuspended
      ? null
      : row.subscriptionPlan;
  const subscriptionEndsAt = keepBillingFields
    ? row.subscriptionEndsAt
    : softSuspended
      ? null
      : row.subscriptionEndsAt;
  const enterpriseHqEligible =
    !softHold &&
    !softSuspended &&
    orgHasEnterpriseHq({
      isDefault: false,
      status: row.status,
      subscriptionPlan: row.subscriptionPlan,
      subscriptionStatus: row.subscriptionStatus,
      subscriptionEndsAt: row.subscriptionEndsAt,
    });
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.companyProfile?.logoUrl?.trim() || null,
    status: softSuspended ? "suspended" : row.status,
    /** True when DB is still active but Fresh soft-denies — Suspend API still works. */
    billingSoftHold: softHold,
    subscriptionPlan,
    /** Landing interest — never entitles; shown until Checkout / ops stamp. */
    requestedPlan: row.requestedPlan,
    requestedDurationMonths: row.requestedDurationMonths ?? null,
    subscriptionInterval: row.subscriptionInterval ?? null,
    // Soft-hold keeps live Stripe status for ops clarity — never fake "expired"
    // (that label is reserved for billing Demo/paid expiry and unlocks renew).
    subscriptionStatus: softHold ? "soft_hold" : row.subscriptionStatus,
    subscriptionEndsAt: subscriptionEndsAt?.toISOString() ?? null,
    hasStripeCustomer: Boolean(row.stripeCustomerId),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    offboardRequestedAt: row.offboardRequestedAt?.toISOString() ?? null,
    offboardedAt: row.offboardedAt?.toISOString() ?? null,
    memberCount: row._count.memberships,
    venuesActive: row._count.venueLocations,
    /** Read-only ops flag: entitled Enterprise plan (not Demo/storefront/soft-hold). */
    enterpriseHqEligible,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } satisfies RegisteredCompanyListItem;
}

export async function listRegisteredCompanies(input?: {
  status?: RegisteredCompanyListStatus;
  /** Page size (default 40, max 200). */
  limit?: number;
  /** Opaque cursor = last row `id` from previous page (createdAt desc). */
  cursor?: string | null;
}): Promise<RegisteredCompanyListResult> {
  const storefrontOrgId = await getStorefrontOrgId();
  const status = input?.status ?? "all";
  const now = new Date();
  const limit = clampRegisteredCompaniesLimit(input?.limit);
  const cursor =
    typeof input?.cursor === "string" && input.cursor.trim()
      ? input.cursor.trim()
      : null;

  // Do NOT race expire scans against the list query — they steal pool slots and
  // cause client "Request timed out" on hard refresh (remote Supabase + Turbopack).
  // Projected filters already match Fresh; cron / Fresh still expire.
  const statusWhere =
    status === "offboard"
      ? { offboardRequestedAt: { not: null } }
      : status === "pending"
        ? { status: "pending" as const }
        : status === "active"
          ? projectedActiveOrgWhere(now)
          : status === "suspended"
            ? projectedSuspendedOrgWhere(now)
            : {};

  const rows = await prisma.organization.findMany({
    where: {
      isDefault: false,
      id: { not: storefrontOrgId },
      ...statusWhere,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    take: limit + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      subscriptionPlan: true,
      requestedPlan: true,
      requestedDurationMonths: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionInterval: true,
      stripeCustomerId: true,
      approvedAt: true,
      offboardRequestedAt: true,
      offboardedAt: true,
      createdAt: true,
      updatedAt: true,
      companyProfile: {
        select: { logoUrl: true },
      },
      _count: {
        select: {
          // Align with planLimits members meter (active + invited only).
          memberships: {
            where: { status: { in: ["active", "invited"] } },
          },
          // Active venues only — matches venues plan meter / archive frees quota.
          venueLocations: {
            where: { status: "active" },
          },
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const companies = pageRows.map((row) => mapRegisteredCompanyListRow(row, now));
  const nextCursor = hasMore
    ? pageRows[pageRows.length - 1]?.id ?? null
    : null;

  // Defer durable expire until after the response is on the wire.
  if (status !== "pending" && status !== "offboard") {
    const expireStorefrontOrgId = storefrontOrgId;
    const expireNow = now;
    setTimeout(() => {
      void collectSoftSuspendedRegisteredCompanyIds({
        storefrontOrgId: expireStorefrontOrgId,
        now: expireNow,
        reason: "registered-companies:list:bg-expire",
        softHoldTake: 20,
        demoTake: 10,
        maxRounds: 2,
        applyLazyExpire: true,
        collectRemainingIds: false,
      }).catch(() => undefined);
    }, 2_500);
  }

  return { companies, nextCursor, hasMore };
}

export type RegisteredCompanyMemberSummary = {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string;
  rolePreset: string;
  status: string;
  createdAt: string;
};

export type RegisteredCompanyDetail = RegisteredCompanyListItem & {
  members: RegisteredCompanyMemberSummary[];
};

/**
 * FECSYNC ops — one registered company workspace + staff roster + logo.
 */
export async function getRegisteredCompanyById(
  orgId: string
): Promise<RegisteredCompanyDetail> {
  const id = requireId(orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();
  const now = new Date();

  const row = await prisma.organization.findFirst({
    where: {
      id,
      isDefault: false,
      NOT: { id: storefrontOrgId },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      subscriptionPlan: true,
      requestedPlan: true,
      requestedDurationMonths: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionInterval: true,
      stripeCustomerId: true,
      approvedAt: true,
      offboardRequestedAt: true,
      offboardedAt: true,
      createdAt: true,
      updatedAt: true,
      companyProfile: {
        select: { logoUrl: true },
      },
      _count: {
        select: {
          memberships: {
            where: { status: { in: ["active", "invited"] } },
          },
          venueLocations: {
            where: { status: "active" },
          },
        },
      },
      memberships: {
        where: { status: { in: ["active", "invited", "suspended"] } },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          userId: true,
          rolePreset: true,
          status: true,
          createdAt: true,
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  if (!row) {
    throw new ForbiddenError(ORG_NOT_REGISTERED_COMPANY_MESSAGE);
  }

  const base = mapRegisteredCompanyListRow(row, now);
  const members: RegisteredCompanyMemberSummary[] = row.memberships.map((m) => {
    const first = m.user?.firstName?.trim() || "";
    const last = m.user?.lastName?.trim() || "";
    const fullName = `${first} ${last}`.trim() || m.user?.email || "Member";
    return {
      membershipId: m.id,
      userId: m.userId,
      email: m.user?.email ?? null,
      fullName,
      rolePreset: m.rolePreset,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    };
  });

  return { ...base, members };
}

export async function approveRegisteredCompany(input: {
  orgId: string;
  actor: NormalizedAccessToken;
  request?: NextRequest;
  subscriptionPlan?: string | null;
  /** Optional ops grant term (months). Defaults to COMPANY_OPS_GRANT_DAYS. */
  durationMonths?: number | null;
}): Promise<{ id: string; status: string; subscriptionPlan: string | null }> {
  await assertStorefrontPlatformAdmin(input.actor);
  const orgId = requireId(input.orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();

  let plan: string | null =
    typeof input.subscriptionPlan === "string"
      ? input.subscriptionPlan.trim().toLowerCase()
      : null;
  if (plan === "") plan = null;
  if (plan && !ORG_SUBSCRIPTION_PLANS.includes(plan as OrgSubscriptionPlan)) {
    throw new ForbiddenError(ORG_INVALID_PLAN_MESSAGE);
  }
  const grantDuration =
    plan && !isDemoPlanId(plan) && isBillingDurationMonths(input.durationMonths)
      ? normalizeBillingDurationMonths(input.durationMonths)
      : null;

  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      isDefault: true,
      status: true,
      name: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });
  if (!existing || existing.id === storefrontOrgId || existing.isDefault) {
    throw new ForbiddenError(ORG_NOT_REGISTERED_COMPANY_MESSAGE);
  }
  const softHold = isSoftBillingHoldRow(existing);
  if (
    existing.status !== "pending" &&
    existing.status !== "suspended" &&
    !softHold
  ) {
    throw new ForbiddenError(ORG_APPROVE_STATUS_MESSAGE);
  }

  /** Soft offboard markers cleared only after sync succeeds (see below). */
  const stampDemo = plan != null && isDemoPlanId(plan);
  const approveData = {
    status: "active" as const,
    approvedAt: new Date(),
    approvedById: input.actor.sub,
    ...(plan
      ? {
          subscriptionPlan: plan,
          // Demo reactivation = trialing month window; paid ops grant = active.
          subscriptionStatus: stampDemo
            ? ("trialing" as const)
            : ("active" as const),
          subscriptionEndsAt: stampDemo
            ? demoSubscriptionEndsAt()
            : opsGrantEndsAt(grantDuration),
          subscriptionInterval: stampDemo
            ? "month"
            : opsGrantInterval(grantDuration),
          subscriptionCancelAtPeriodEnd: false,
          // Keep stripeSubscriptionId if cancel failed on suspend (blocks second Checkout).
          ...(grantDuration != null
            ? { requestedDurationMonths: grantDuration }
            : {}),
        }
      : {
          // Reset plan fields; keep Stripe ids so a still-live sub cannot be double-charged.
          subscriptionPlan: null,
          subscriptionStatus: "none" as const,
          subscriptionEndsAt: null,
          subscriptionInterval: null,
          subscriptionCancelAtPeriodEnd: false,
        }),
  };

  const now = new Date();
  const written = await prisma.organization.updateMany({
    where: {
      id: orgId,
      isDefault: false,
      OR: [
        { status: { in: ["pending", "suspended"] } },
        softBillingHoldWhere(now),
      ],
    },
    data: approveData,
  });
  if (written.count === 0) {
    throw new ForbiddenError(ORG_APPROVE_STATUS_MESSAGE);
  }

  const updated = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      id: true,
      status: true,
      subscriptionPlan: true,
      name: true,
      approvedAt: true,
    },
  });

  // Sync retained Stripe binding with Checkout/portal state (best-effort).
  // Audit "Company Approved" only after sync decision so fail-closed does not
  // leave a false Approved activity.
  let syncResult: Awaited<
    ReturnType<
      typeof import("@/lib/companyBilling").syncBoundStripeSubscriptionAfterOpsUnlock
    >
  > = null;
  try {
    const { syncBoundStripeSubscriptionAfterOpsUnlock } = await import(
      "@/lib/companyBilling"
    );
    syncResult = await syncBoundStripeSubscriptionAfterOpsUnlock(
      updated.id,
      `approve:${updated.id}:${updated.approvedAt?.getTime() ?? Date.now()}`
    );
  } catch (err) {
    console.warn(
      "[company-approval] post-approve Stripe sync failed (non-fatal):",
      err
    );
  }

  let afterSync = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      id: true,
      status: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      name: true,
    },
  });

  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const unresolvedStripeTrail = Boolean(
    afterSync.stripeSubscriptionId?.trim() || afterSync.stripeCustomerId?.trim()
  );
  // Ops grant (Approve + plan) must survive sync null / live+past refuse —
  // otherwise soft-hold Reactivate is impossible while Stripe stays live+past.
  // Demo reactivation stamps trialing (not active) — treat both as intact.
  const preservedOpsGrant =
    Boolean(plan) &&
    Boolean(afterSync.subscriptionPlan?.trim()) &&
    (afterSync.subscriptionStatus === "active" ||
      afterSync.subscriptionStatus === "trialing") &&
    afterSync.subscriptionEndsAt != null &&
    afterSync.subscriptionEndsAt.getTime() > Date.now();

  /** True when a concurrent Set plan / Stripe apply left an entitled active row. */
  const isConcurrentUnlock = (row: {
    status: string;
    subscriptionPlan: string | null;
    subscriptionStatus: string | null;
    subscriptionEndsAt: Date | null;
  }) => {
    if (row.status !== "active") return false;
    const endsOk =
      row.subscriptionEndsAt != null &&
      row.subscriptionEndsAt.getTime() > Date.now();
    const live =
      row.subscriptionStatus === "active" ||
      row.subscriptionStatus === "trialing";
    return Boolean(row.subscriptionPlan?.trim()) && live && endsOk;
  };

  // Stripe configured + sync could not confirm a Stripe trail → leave suspended
  // unless an explicit ops grant is still on the row.
  // Use ops_hold (not expired) so self-serve renew cannot unlock a failed Approve.
  if (
    stripeConfigured &&
    syncResult === null &&
    unresolvedStripeTrail &&
    !preservedOpsGrant
  ) {
    // Do not touch offboard markers — they were never cleared on the unlock write.
    // Concurrent clear_offboard during sync must stay cleared.
    // Only re-hold if the row is still this Approve's unentitled unlock:
    // same approvedAt + same plan stamp (or still null) + no future endsAt.
    // Prevents clobbering concurrent Set plan / Stripe entitlement apply.
    const nowMs = Date.now();
    const reHeld = await prisma.organization.updateMany({
      where: {
        id: orgId,
        status: "active",
        ...(updated.approvedAt
          ? { approvedAt: updated.approvedAt }
          : {}),
        ...(plan
          ? { subscriptionPlan: plan }
          : { subscriptionPlan: null }),
        OR: [
          { subscriptionEndsAt: null },
          { subscriptionEndsAt: { lte: new Date(nowMs) } },
        ],
      },
      data: {
        ...organizationOpsHoldData(),
        stripeSubscriptionId: afterSync.stripeSubscriptionId,
        ...(plan
          ? {
              subscriptionPlan: null,
              subscriptionInterval: null,
              subscriptionCancelAtPeriodEnd: false,
            }
          : {}),
      },
    });
    if (reHeld.count > 0) {
      await clearOrganizationBillingEventWatermark(orgId);
      logPlatformActionOnCompany(input.actor, {
        action: "Company Approve Sync Failed",
        targetOrgId: orgId,
        description: `Approve sync failed for "${afterSync.name}" — left suspended (ops_hold)`,
        request: input.request,
        metadata: {
          opsKind: "company-approval",
          reason: "stripe-sync-null",
          subscriptionStatus: "ops_hold",
        },
      });
      throw new ForbiddenError(ORG_APPROVE_SYNC_FAILED_MESSAGE);
    }
    // Re-hold matched 0 — concurrent unlock or already held. Do not claim
    // "left suspended" when the row is still active/entitled.
    const current = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true,
        status: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        name: true,
      },
    });
    if (current.status === "suspended") {
      throw new ForbiddenError(ORG_APPROVE_SYNC_FAILED_MESSAGE);
    }
    if (!isConcurrentUnlock(current) && current.status === "active") {
      // Active but still unentitled + Stripe trail — keep fail-closed messaging
      // without overwriting a concurrent unlock we failed to match.
      logPlatformActionOnCompany(input.actor, {
        action: "Company Approve Sync Failed",
        targetOrgId: orgId,
        description: `Approve sync failed for "${current.name}" — concurrent state prevented ops_hold re-stamp; row left active`,
        request: input.request,
        metadata: {
          opsKind: "company-approval",
          reason: "stripe-sync-null-no-rehold",
          subscriptionStatus: current.subscriptionStatus,
        },
      });
      throw new ForbiddenError(ORG_APPROVE_SYNC_FAILED_MESSAGE);
    }
    // Concurrent entitled unlock won — continue success path with live row.
    afterSync = current;
  }

  if (
    stripeConfigured &&
    syncResult === null &&
    unresolvedStripeTrail &&
    preservedOpsGrant
  ) {
    console.warn(
      "[company-approval] post-approve Stripe sync unresolved — keeping ops grant",
      orgId
    );
  }

  // Sync returned but left a bound sub with no plan (unmapped price / refused
  // apply) while Stripe is configured — do not leave active starter-floor unlock
  // while Stripe still bills. Ops grant with a plan skips this branch.
  if (
    stripeConfigured &&
    afterSync.status === "active" &&
    !afterSync.subscriptionPlan?.trim() &&
    afterSync.stripeSubscriptionId?.trim()
  ) {
    // Only re-hold while plan is still null (this Approve-without-plan state).
    // Concurrent Set plan / Stripe apply that stamps a plan must not be wiped.
    const reHeld = await prisma.organization.updateMany({
      where: {
        id: orgId,
        status: "active",
        subscriptionPlan: null,
        ...(updated.approvedAt
          ? { approvedAt: updated.approvedAt }
          : {}),
      },
      data: {
        ...organizationOpsHoldData(),
        stripeSubscriptionId: afterSync.stripeSubscriptionId,
      },
    });
    if (reHeld.count > 0) {
      await clearOrganizationBillingEventWatermark(orgId);
      logPlatformActionOnCompany(input.actor, {
        action: "Company Approve Sync Failed",
        targetOrgId: orgId,
        description: `Approve plan apply failed for "${afterSync.name}" — left suspended (ops_hold)`,
        request: input.request,
        metadata: {
          opsKind: "company-approval",
          reason: "plan-apply-failed",
          subscriptionStatus: "ops_hold",
        },
      });
      throw new ForbiddenError(ORG_APPROVE_PLAN_APPLY_FAILED_MESSAGE);
    }
    const current = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true,
        status: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        name: true,
      },
    });
    if (current.status === "suspended") {
      throw new ForbiddenError(ORG_APPROVE_PLAN_APPLY_FAILED_MESSAGE);
    }
    if (!isConcurrentUnlock(current)) {
      logPlatformActionOnCompany(input.actor, {
        action: "Company Approve Sync Failed",
        targetOrgId: orgId,
        description: `Approve plan apply failed for "${current.name}" — concurrent state prevented ops_hold re-stamp; row left active`,
        request: input.request,
        metadata: {
          opsKind: "company-approval",
          reason: "plan-apply-failed-no-rehold",
          subscriptionStatus: current.subscriptionStatus,
        },
      });
      throw new ForbiddenError(ORG_APPROVE_PLAN_APPLY_FAILED_MESSAGE);
    }
    afterSync = current;
  }

  // Successful unlock — clear soft offboard queue (ops fresh workspace).
  // Deferred until here so sync-fail cannot undo a concurrent clear_offboard,
  // and fail-closed re-suspend never needs to restore stamps.
  await prisma.organization.updateMany({
    where: {
      id: orgId,
      isDefault: false,
      OR: [
        { offboardRequestedAt: { not: null } },
        { offboardedAt: { not: null } },
      ],
    },
    data: {
      offboardRequestedAt: null,
      offboardedAt: null,
    },
  });

  // Stamp actor.orgId (storefront) so Harewa Recent Activity keeps working.
  logPlatformActionOnCompany(input.actor, {
    action: "Company Approved",
    targetOrgId: afterSync.id,
    description: `Approved registered company "${afterSync.name}"`,
    request: input.request,
    metadata: {
      subscriptionPlan: afterSync.subscriptionPlan,
      domain: "platform-ops",
      opsKind: "company-approval",
      stripeSync:
        syncResult != null
          ? "ok"
          : preservedOpsGrant
            ? "deferred-ops-grant"
            : "skipped",
    },
  });

  // Always clear Step 3 notice watermarks on successful Approve so a later
  // past_due / expire / remind episode can claim again (including approve-none).
  try {
    const { clearCompanySubscriptionNoticeWatermarks } = await import(
      "@/lib/companySubscriptionNotices"
    );
    await clearCompanySubscriptionNoticeWatermarks(afterSync.id);
  } catch (err) {
    console.warn("[company-approval] clear notice watermarks failed:", err);
  }
  try {
    const { notifyCompanyApproved } = await import(
      "@/lib/companySubscriptionNotices"
    );
    // Do not block Approve on SMTP — notices are best-effort.
    void notifyCompanyApproved(afterSync.id).catch((err) =>
      console.warn("[company-approval] approved notice failed:", err)
    );
  } catch (err) {
    console.warn("[company-approval] approved notice failed:", err);
  }

  clearCachedStaffGatesForOrg(afterSync.id);

  return {
    id: afterSync.id,
    status: afterSync.status,
    subscriptionPlan: afterSync.subscriptionPlan,
  };
}

export const ORG_OPS_SET_PLAN_MESSAGE =
  "Choose a plan (demo, starter, growth, or enterprise) to stamp";

/**
 * Emergency ops plan stamp for any registered company (pending / active /
 * suspended / soft-hold). Updates only Organization subscription entitlement
 * fields + status→active. Never deletes or rewrites venues, catalog, orders,
 * memberships, company profile, or history. Stripe ids are left untouched.
 */
export async function opsSetCompanySubscriptionPlan(input: {
  orgId: string;
  actor: NormalizedAccessToken;
  request?: NextRequest;
  subscriptionPlan: string;
  /** Optional ops grant term (months). Defaults to COMPANY_OPS_GRANT_DAYS. */
  durationMonths?: number | null;
  /**
   * When false, skip the generic approved email (ops create sends its own
   * welcome + login details mail instead). Default true.
   */
  notify?: boolean;
}): Promise<{ id: string; status: string; subscriptionPlan: string | null }> {
  await assertStorefrontPlatformAdmin(input.actor);
  const orgId = requireId(input.orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();

  const planRaw =
    typeof input.subscriptionPlan === "string"
      ? input.subscriptionPlan.trim().toLowerCase()
      : "";
  if (!planRaw || !ORG_SUBSCRIPTION_PLANS.includes(planRaw as OrgSubscriptionPlan)) {
    throw new ForbiddenError(ORG_OPS_SET_PLAN_MESSAGE);
  }
  const plan = planRaw as OrgSubscriptionPlan;
  const stampDemo = isDemoPlanId(plan);
  const grantDuration =
    !stampDemo && isBillingDurationMonths(input.durationMonths)
      ? normalizeBillingDurationMonths(input.durationMonths)
      : null;

  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      isDefault: true,
      name: true,
      status: true,
      subscriptionPlan: true,
      approvedAt: true,
      approvedById: true,
    },
  });
  if (!existing || existing.id === storefrontOrgId || existing.isDefault) {
    throw new ForbiddenError(ORG_NOT_REGISTERED_COMPANY_MESSAGE);
  }

  const priorPlan = existing.subscriptionPlan?.trim().toLowerCase() || null;
  const now = new Date();
  const written = await prisma.organization.updateMany({
    where: {
      id: orgId,
      isDefault: false,
    },
    data: {
      status: "active",
      // Always bump approvedAt so a concurrent Approve sync-fail re-hold
      // (keyed on the Approve stamp) cannot overwrite this unlock.
      approvedAt: now,
      approvedById: input.actor.sub,
      subscriptionPlan: plan,
      subscriptionStatus: stampDemo ? "trialing" : "active",
      subscriptionEndsAt: stampDemo
        ? demoSubscriptionEndsAt(now)
        : opsGrantEndsAt(grantDuration),
      subscriptionInterval: stampDemo
        ? "month"
        : opsGrantInterval(grantDuration),
      subscriptionCancelAtPeriodEnd: false,
      ...(stampDemo
        ? { requestedDurationMonths: 1 }
        : {
            requestedDurationMonths:
              grantDuration ?? DEFAULT_BILLING_DURATION_MONTHS,
          }),
      // Keep stripeCustomerId / stripeSubscriptionId — emergency stamp only.
    },
  });
  if (written.count === 0) {
    throw new ForbiddenError(ORG_NOT_REGISTERED_COMPANY_MESSAGE);
  }

  await clearOrganizationBillingEventWatermark(orgId);

  logPlatformActionOnCompany(input.actor, {
    action: "Company Plan Ops Stamp",
    targetOrgId: orgId,
    description: `Emergency plan stamp for "${existing.name}": ${priorPlan || "none"} → ${plan}. Company records untouched.`,
    request: input.request,
    metadata: {
      opsKind: "company-plan-ops-stamp",
      priorPlan,
      plan,
      durationMonths: grantDuration,
      priorStatus: existing.status,
      dataPreserved: true,
      emergency: true,
    },
  });

  clearCachedStaffGatesForOrg(orgId);

  try {
    const { clearCompanySubscriptionNoticeWatermarks } = await import(
      "@/lib/companySubscriptionNotices"
    );
    await clearCompanySubscriptionNoticeWatermarks(orgId);
  } catch (err) {
    console.warn(
      "[company-approval] clear notice watermarks after ops set_plan failed:",
      err
    );
  }

  try {
    if (input.notify !== false) {
      const { notifyCompanyApproved } = await import(
        "@/lib/companySubscriptionNotices"
      );
      // Do not block Set plan on SMTP — notices are best-effort.
      void notifyCompanyApproved(orgId).catch((err) =>
        console.warn(
          "[company-approval] set_plan approved notice failed:",
          err
        )
      );
    }
  } catch (err) {
    console.warn(
      "[company-approval] set_plan approved notice failed:",
      err
    );
  }

  const updated = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      id: true,
      status: true,
      subscriptionPlan: true,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    subscriptionPlan: updated.subscriptionPlan,
  };
}

export const ORG_CLEAR_OFFBOARD_MESSAGE =
  "No open offboard request for this company";

/**
 * Harewa ops dismiss of a soft offboard request (active healthy orgs included).
 * Does not change subscription/status — only clears markers.
 */
export async function clearRegisteredCompanyOffboard(input: {
  orgId: string;
  actor: NormalizedAccessToken;
  request?: NextRequest;
}): Promise<{ id: string; cleared: boolean }> {
  await assertStorefrontPlatformAdmin(input.actor);
  const orgId = requireId(input.orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();

  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      isDefault: true,
      name: true,
      offboardRequestedAt: true,
      offboardedAt: true,
    },
  });
  if (!existing || existing.id === storefrontOrgId || existing.isDefault) {
    throw new ForbiddenError(ORG_NOT_REGISTERED_COMPANY_MESSAGE);
  }
  if (!existing.offboardRequestedAt && !existing.offboardedAt) {
    throw new ForbiddenError(ORG_CLEAR_OFFBOARD_MESSAGE);
  }

  const written = await prisma.organization.updateMany({
    where: {
      id: orgId,
      isDefault: false,
      OR: [
        { offboardRequestedAt: { not: null } },
        { offboardedAt: { not: null } },
      ],
    },
    data: {
      offboardRequestedAt: null,
      offboardedAt: null,
    },
  });
  if (written.count === 0) {
    throw new ForbiddenError(ORG_CLEAR_OFFBOARD_MESSAGE);
  }

  logPlatformActionOnCompany(input.actor, {
    action: "Company Offboard Cleared",
    targetOrgId: orgId,
    description: `Cleared soft offboard request for "${existing.name}"`,
    request: input.request,
    metadata: {
      opsKind: "company-offboard",
      priorOffboardRequestedAt:
        existing.offboardRequestedAt?.toISOString() ?? null,
    },
  });

  return { id: orgId, cleared: true };
}

/**
 * Suspend a registered company (ops hold). Soft lock only — never deletes
 * venues, catalog, orders, memberships, or history. Uses subscriptionStatus
 * `ops_hold` so self-serve renew cannot unlock without Approve / Set plan.
 * Clears stripeSubscriptionId only when Stripe cancel succeeds. Keeps
 * stripeCustomerId for portal/re-checkout after reactivation.
 */
export async function suspendRegisteredCompany(input: {
  orgId: string;
  actor: NormalizedAccessToken;
  request?: NextRequest;
  reason?: string;
}): Promise<{ id: string; status: string }> {
  await assertStorefrontPlatformAdmin(input.actor);
  const orgId = requireId(input.orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();

  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      isDefault: true,
      name: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
    },
  });
  if (!existing || existing.id === storefrontOrgId || existing.isDefault) {
    throw new ForbiddenError(ORG_NOT_REGISTERED_COMPANY_MESSAGE);
  }

  const priorSubId = existing.stripeSubscriptionId?.trim() || null;

  // DB-first suspend so Fresh APIs fail-close even if Stripe cancel fails after.
  // active|pending: normal Suspend. suspended+expired: convert to ops_hold so
  // self-serve renew cannot unlock after ops intervention. Already ops_hold → no-op.
  const suspended = await prisma.organization.updateMany({
    where: {
      id: orgId,
      isDefault: false,
      OR: [
        { status: { in: ["active", "pending"] } },
        {
          status: "suspended",
          subscriptionStatus: "expired",
        },
      ],
    },
    data: {
      ...organizationOpsHoldData(),
      stripeSubscriptionId: priorSubId,
    },
  });
  if (suspended.count === 0) {
    const current = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { id: true, status: true },
    });
    return { id: current.id, status: current.status };
  }

  await clearOrganizationBillingEventWatermark(orgId);

  // Concurrent Approve / Set plan may unlock between DB suspend and Stripe cancel.
  // Never cancel Stripe or audit Suspend if the hold is already gone.
  const stillHeld = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      status: true,
      subscriptionStatus: true,
      name: true,
    },
  });
  if (
    !stillHeld ||
    stillHeld.status !== "suspended" ||
    (stillHeld.subscriptionStatus || "").trim().toLowerCase() !== "ops_hold"
  ) {
    return {
      id: orgId,
      status: stillHeld?.status ?? "active",
    };
  }

  const { bestEffortCancelLiveStripeSubscriptionsForOrg } = await import(
    "@/lib/companyBilling"
  );
  const canceled = await bestEffortCancelLiveStripeSubscriptionsForOrg({
    stripeSubscriptionId: priorSubId,
    stripeCustomerId: existing.stripeCustomerId,
  });
  if (canceled) {
    await prisma.organization.updateMany({
      where: {
        id: orgId,
        status: "suspended",
        subscriptionStatus: "ops_hold",
      },
      data: { stripeSubscriptionId: null },
    });
  }

  const updated = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { id: true, status: true, name: true, subscriptionStatus: true },
  });
  if (
    updated.status !== "suspended" ||
    (updated.subscriptionStatus || "").trim().toLowerCase() !== "ops_hold"
  ) {
    return { id: updated.id, status: updated.status };
  }

  logPlatformActionOnCompany(input.actor, {
    action: "Company Suspended",
    targetOrgId: updated.id,
    description: `Suspended registered company "${updated.name}" (records kept)`,
    request: input.request,
    metadata: {
      reason: input.reason ?? "ops",
      opsKind: "company-approval",
      subscriptionStatus: "ops_hold",
      stripeCancelOk: canceled,
    },
  });

  try {
    const { notifyCompanySuspended } = await import(
      "@/lib/companySubscriptionNotices"
    );
    await notifyCompanySuspended(updated.id, input.reason ?? "ops");
  } catch (err) {
    console.warn("[company-approval] suspended notice failed:", err);
  }

  clearCachedStaffGatesForOrg(updated.id);

  return { id: updated.id, status: updated.status };
}

export const ORG_OPS_CREATE_EMAIL_REQUIRED =
  "Admin email is required to create a company workspace";
export const ORG_OPS_CREATE_PASSWORD_REQUIRED =
  "Password is required when creating a new admin user";
export const ORG_OPS_CREATE_PASSWORD_WEAK =
  "Password must be at least 8 characters";
export const ORG_OPS_CREATE_PLAN_REQUIRED =
  "Choose a plan (demo, starter, growth, or enterprise) when activating the company";
export const ORG_OPS_CREATE_DURATION_REQUIRED =
  "Choose a grant length (1, 2, 3, 6, 12, 24, or 60 months) when activating a paid plan";

/**
 * Ops-provision a registered company without public /register-company or Checkout.
 * Creates (or reuses) an admin user with no existing Membership, then Organization
 * + platform_admin seat. When activate=true, Approve + plan stamp in one step
 * (same entitlement fields as Approve / Set plan — no Stripe required).
 */
export async function opsCreateRegisteredCompany(input: {
  actor: NormalizedAccessToken;
  request?: NextRequest;
  companyName: string;
  slug?: string | null;
  adminEmail: string;
  adminPassword?: string | null;
  adminFullName?: string | null;
  subscriptionPlan: string;
  /** When true (default), activate + stamp plan (skip Checkout). */
  activate?: boolean;
  /** Optional ops grant term (months) when activating. */
  durationMonths?: number | null;
}): Promise<{
  id: string;
  status: string;
  subscriptionPlan: string | null;
  slug: string;
  name: string;
  adminEmail: string;
  adminUserId: string;
  createdAdminUser: boolean;
  activated: boolean;
}> {
  await assertStorefrontPlatformAdmin(input.actor);

  const email = String(input.adminEmail || "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    throw new ForbiddenError(ORG_OPS_CREATE_EMAIL_REQUIRED);
  }

  const planRaw = String(input.subscriptionPlan || "")
    .trim()
    .toLowerCase();
  if (!planRaw || !ORG_SUBSCRIPTION_PLANS.includes(planRaw as OrgSubscriptionPlan)) {
    throw new ForbiddenError(ORG_OPS_SET_PLAN_MESSAGE);
  }
  const plan = planRaw as OrgSubscriptionPlan;
  const activate = input.activate !== false;
  if (activate && !planRaw) {
    throw new ForbiddenError(ORG_OPS_CREATE_PLAN_REQUIRED);
  }
  // Paid activate must keep the selected grant length (never silent 30-day / 1-mo fallback).
  let grantDuration: ReturnType<typeof normalizeBillingDurationMonths> | null =
    null;
  if (!isDemoPlanId(plan)) {
    if (activate) {
      if (!isBillingDurationMonths(input.durationMonths)) {
        throw new ForbiddenError(ORG_OPS_CREATE_DURATION_REQUIRED);
      }
      grantDuration = normalizeBillingDurationMonths(input.durationMonths);
    } else if (isBillingDurationMonths(input.durationMonths)) {
      grantDuration = normalizeBillingDurationMonths(input.durationMonths);
    }
  } else {
    grantDuration = null;
  }

  const {
    createOrganizationWithPlatformAdmin,
    ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE,
    ORG_SLUG_TAKEN_MESSAGE,
    ORG_NAME_TAKEN_MESSAGE,
    ORG_NAME_REQUIRED_MESSAGE,
  } = await import("@/lib/orgRegistration");
  const { allocateUniqueOrgSlug } = await import("@/lib/org");
  const bcrypt = (await import("bcrypt")).default;
  const { generateUsername, splitFullName } = await import("@/lib/utils");

  const name = String(input.companyName || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) {
    throw new ForbiddenError(ORG_NAME_REQUIRED_MESSAGE);
  }

  // Fail closed before minting users/slugs when the display name is already taken.
  const nameTaken = await prisma.organization.findFirst({
    where: {
      isDefault: false,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true, slug: true },
  });
  if (nameTaken) {
    throw new ForbiddenError(ORG_NAME_TAKEN_MESSAGE);
  }

  // Prefer explicit slug; otherwise derive from company name. Always uniquify
  // against other orgs (and never claim the storefront default slug).
  const slugSeed =
    typeof input.slug === "string" && input.slug.trim()
      ? input.slug.trim()
      : name;
  const slug = await allocateUniqueOrgSlug(slugSeed);

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      accountDeleted: true,
      memberships: { select: { id: true }, take: 1 },
    },
  });

  let adminUserId: string;
  let createdAdminUser = false;

  if (existingUser && !existingUser.accountDeleted) {
    if (existingUser.memberships.length > 0) {
      throw new ForbiddenError(ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE);
    }
    adminUserId = existingUser.id;
  } else if (existingUser?.accountDeleted) {
    throw new ForbiddenError(
      "That email belongs to a deleted account — use a different email"
    );
  } else {
    const password = String(input.adminPassword || "");
    if (password.length < 8) {
      throw new ForbiddenError(
        password
          ? ORG_OPS_CREATE_PASSWORD_WEAK
          : ORG_OPS_CREATE_PASSWORD_REQUIRED
      );
    }
    const fullName =
      String(input.adminFullName || "").trim() || email.split("@")[0] || "Admin";
    const joinedAt = new Date();
    const hashedPassword = await bcrypt.hash(password, 10);
    const username = await generateUsername(joinedAt, fullName);
    const { firstName, lastName } = await splitFullName(fullName);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          email,
          password: hashedPassword,
          username,
          isVerified: true,
          joinedAt,
          role: "client",
        },
      });
      await tx.profile.create({
        data: {
          userId: user.id,
          firstName: firstName || "",
          lastName: lastName || "",
        },
      });
      await tx.wallet.create({
        data: { userId: user.id, balance: 0 },
      });
      return user;
    });
    adminUserId = created.id;
    createdAdminUser = true;
  }

  let organization;
  try {
    const created = await createOrganizationWithPlatformAdmin({
      name,
      slug,
      userId: adminUserId,
      invitedById: input.actor.sub,
      requestedPlan: plan,
      requestedDurationMonths: grantDuration,
      invalidateSessions: true,
    });
    organization = created.organization;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (
      msg === ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE ||
      msg === ORG_SLUG_TAKEN_MESSAGE ||
      msg === ORG_NAME_TAKEN_MESSAGE ||
      msg === ORG_NAME_REQUIRED_MESSAGE
    ) {
      throw new ForbiddenError(msg);
    }
    throw err;
  }

  const passwordForEmail =
    createdAdminUser && typeof input.adminPassword === "string"
      ? input.adminPassword
      : null;

  let status: string = organization.status;
  let subscriptionPlan: string | null = organization.subscriptionPlan ?? null;

  if (activate) {
    // Fresh ops create has no Stripe trail — stamp via Set plan (skips Stripe sync).
    // notify:false — one dedicated welcome email below (login + plan + congrats).
    const stamped = await opsSetCompanySubscriptionPlan({
      orgId: organization.id,
      actor: input.actor,
      request: input.request,
      subscriptionPlan: plan,
      durationMonths: grantDuration,
      notify: false,
    });
    status = stamped.status;
    subscriptionPlan = stamped.subscriptionPlan;

    try {
      const { notifyCompanyOpsProvisioned } = await import(
        "@/lib/companySubscriptionNotices"
      );
      void notifyCompanyOpsProvisioned({
        orgId: organization.id,
        adminEmail: email,
        adminUserId,
        adminFullName: input.adminFullName ?? null,
        temporaryPassword: passwordForEmail,
        createdAdminUser,
        planId: plan,
        durationMonths: grantDuration,
      }).catch((err) =>
        console.warn("[company-approval] ops provisioned notice failed:", err)
      );
    } catch (err) {
      console.warn("[company-approval] ops provisioned notice failed:", err);
    }
  }

  logPlatformActionOnCompany(input.actor, {
    action: activate
      ? "Company Ops Create Activated"
      : "Company Ops Create Pending",
    targetOrgId: organization.id,
    description: activate
      ? `Ops-created and activated "${organization.name}" on ${plan}`
      : `Ops-created pending workspace "${organization.name}" (interest ${plan})`,
    request: input.request,
    metadata: {
      opsKind: "company-create",
      plan,
      durationMonths: grantDuration,
      activate,
      createdAdminUser,
      adminUserId,
    },
  });

  return {
    id: organization.id,
    status,
    subscriptionPlan,
    slug: organization.slug,
    name: organization.name,
    adminEmail: email,
    adminUserId,
    createdAdminUser,
    activated: activate,
  };
}
