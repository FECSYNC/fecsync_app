/**
 * Membership reporting aggregates (Feature 08 Phase 4 / Feature 17 slice).
 * Numbers from DB only — never placeholders.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import {
  assertMembershipsStaff,
  locationScopeFilter,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { assertEnterpriseHqEnabled } from "@/lib/enterpriseHq";

export type MembershipReportsDto = {
  orgId: string;
  range: { from: string; to: string };
  soldInRange: number;
  activeMembers: number;
  churnCancelledInRange: number;
  pastDueCount: number;
  failedPayments: { count: number; amountMajor: number };
  /** Active members grouped by MembershipCategory name (fallback: reportingCategory GL, then uncategorized). */
  activeByReportingCategory: Array<{ category: string; count: number }>;
  scope: "company" | "park" | "hq_rollup";
  locationId: string | null;
};

function parseRange(fromRaw?: string | null, toRaw?: string | null): {
  from: Date;
  to: Date;
} {
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(to.getTime() - 30 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid from/to date");
  }
  if (from.getTime() > to.getTime()) {
    throw new Error("from must be <= to");
  }
  // Cap range to 366 days
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new Error("Date range must be <= 366 days");
  }
  return { from, to };
}

export async function getMembershipReports(
  actor: MembershipsActor,
  opts?: {
    from?: string | null;
    to?: string | null;
    locationId?: string | null;
    /** Enterprise HQ rollup across parks — requires assertEnterpriseHqEnabled */
    hqRollup?: boolean;
  }
): Promise<MembershipReportsDto> {
  const orgId = await assertMembershipsStaff(actor);
  const { from, to } = parseRange(opts?.from, opts?.to);
  const scope = await locationScopeFilter(actor);

  let locationId: string | null = opts?.locationId?.trim() || null;
  let reportScope: MembershipReportsDto["scope"] = "company";

  if (opts?.hqRollup) {
    await assertEnterpriseHqEnabled(orgId);
    reportScope = "hq_rollup";
    locationId = null;
  } else if (locationId) {
    reportScope = "park";
  } else if (scope.parkLocked && scope.locationIds?.length) {
    // Park-locked seats: aggregate assigned parks only (not company-wide leak).
    reportScope = "park";
  } else if (scope.locationId) {
    locationId = scope.locationId;
    reportScope = "park";
  }

  const locationFilter =
    reportScope === "hq_rollup" || (!locationId && !scope.parkLocked)
      ? {}
      : scope.parkLocked && scope.locationIds?.length && !locationId
        ? { homeLocationId: { in: scope.locationIds } }
        : locationId
          ? { homeLocationId: locationId }
          : scope.locationId
            ? { homeLocationId: scope.locationId }
            : {};

  const baseWhere = { orgId, ...locationFilter };

  const [
    soldInRange,
    activeMembers,
    churnCancelledInRange,
    pastDueCount,
    failedAgg,
    activeByCategoryRaw,
  ] = await Promise.all([
    prisma.guestMembership.count({
      where: {
        ...baseWhere,
        createdAt: { gte: from, lte: to },
      },
    }),
    prisma.guestMembership.count({
      where: {
        ...baseWhere,
        status: "active",
      },
    }),
    prisma.guestMembership.count({
      where: {
        ...baseWhere,
        status: "cancelled",
        cancelledAt: { gte: from, lte: to },
      },
    }),
    prisma.guestMembership.count({
      where: {
        ...baseWhere,
        status: "past_due",
      },
    }),
    prisma.membershipPaymentAttempt.aggregate({
      where: {
        orgId,
        status: "failed",
        createdAt: { gte: from, lte: to },
        ...(locationId || (scope.parkLocked && scope.locationIds?.length)
          ? {
              guestMembership: locationFilter,
            }
          : {}),
      },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.guestMembership.findMany({
      where: { ...baseWhere, status: "active" },
      select: {
        plan: {
          select: {
            reportingCategory: true,
            category: { select: { name: true } },
          },
        },
      },
      take: 5000,
    }),
  ]);

  const categoryCounts = new Map<string, number>();
  for (const row of activeByCategoryRaw) {
    const key =
      row.plan.category?.name?.trim() ||
      row.plan.reportingCategory?.trim() ||
      "(uncategorized)";
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }
  const activeByReportingCategory = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const amountMajor = Number(failedAgg._sum.amount ?? 0);

  return {
    orgId,
    range: { from: from.toISOString(), to: to.toISOString() },
    soldInRange,
    activeMembers,
    churnCancelledInRange,
    pastDueCount,
    failedPayments: {
      count: failedAgg._count.id,
      amountMajor: Number.isFinite(amountMajor) ? amountMajor : 0,
    },
    activeByReportingCategory,
    scope: reportScope,
    locationId,
  };
}

/** KPI helpers for owner dashboard cards (same counts, current snapshot). */
export async function getMembershipKpis(
  actor: MembershipsActor
): Promise<{ soldLast30d: number; activeMembers: number }> {
  const orgId = await assertMembershipsStaff(actor);
  requireId(orgId, "orgId");
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const report = await getMembershipReports(actor, {
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return {
    soldLast30d: report.soldInRange,
    activeMembers: report.activeMembers,
  };
}
