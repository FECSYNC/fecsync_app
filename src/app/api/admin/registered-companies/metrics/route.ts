import { NextRequest } from "next/server";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  assertStorefrontPlatformAdmin,
  collectSoftSuspendedRegisteredCompanyIds,
} from "@/lib/companyApproval";
import {
  projectedActiveOrgWhere,
  projectedSuspendedOrgWhere,
} from "@/lib/billingSoftHold";
import { getStorefrontOrgId } from "@/lib/org";
import prisma from "@/lib/prisma";
import connectDB, { withDbRetry } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/registered-companies/metrics
 * Harewa storefront platform_admin company SaaS overview counts.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.RegisteredCompaniesRead);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/registered-companies/metrics", {
          permission: P.RegisteredCompaniesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const storefrontOrgId = await getStorefrontOrgId();
    const baseWhere = {
      isDefault: false as const,
      id: { not: storefrontOrgId },
    };

    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    // Background expire — do not block metrics cards.
    void collectSoftSuspendedRegisteredCompanyIds({
      storefrontOrgId,
      now,
      reason: "metrics:bg-expire",
      softHoldTake: 20,
      demoTake: 10,
      maxRounds: 2,
      applyLazyExpire: true,
      collectRemainingIds: false,
    }).catch(() => undefined);

    const liveEndsAtOk = {
      OR: [
        { subscriptionEndsAt: null },
        { subscriptionEndsAt: { gt: now } },
      ],
    };

    const projectedActive = projectedActiveOrgWhere(now);

    const [
      pendingCount,
      activeCompanyCount,
      suspendedCount,
      subscribedCount,
      expiringWithin7Days,
      offboardRequestedCount,
    ] = await withDbRetry(() =>
      Promise.all([
        prisma.organization.count({
          where: { ...baseWhere, status: "pending" },
        }),
        prisma.organization.count({
          where: {
            ...baseWhere,
            ...projectedActive,
          },
        }),
        prisma.organization.count({
          where: {
            ...baseWhere,
            ...projectedSuspendedOrgWhere(now),
          },
        }),
        prisma.organization.count({
          where: {
            ...baseWhere,
            ...projectedActive,
            // Live paid period only — past_due without endsAt (refuse-before-stamp)
            // must not count as subscribed; active/trialing may still have ops null endsAt.
            OR: [
              {
                subscriptionStatus: { in: ["active", "trialing"] },
                ...liveEndsAtOk,
              },
              {
                subscriptionStatus: "past_due",
                subscriptionEndsAt: { gt: now },
              },
            ],
          },
        }),
        prisma.organization.count({
          where: {
            ...baseWhere,
            ...projectedActive,
            // Align with subscribedCount — only live paid statuses count as “expiring”.
            subscriptionStatus: { in: ["active", "trialing", "past_due"] },
            subscriptionEndsAt: { gte: now, lte: in7Days },
          },
        }),
        prisma.organization.count({
          where: {
            ...baseWhere,
            offboardRequestedAt: { not: null },
          },
        }),
      ])
    );

    return ok({
      metrics: {
        pendingCount,
        activeCompanyCount,
        suspendedCount,
        subscribedCount,
        expiringWithin7Days,
        offboardRequestedCount,
      },
    });
  } catch (err) {
    console.error("registered-companies metrics error:", err);
    return serverError("Failed to load company metrics");
  }
}
