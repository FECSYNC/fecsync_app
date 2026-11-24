import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P, toDbUserRole } from "@/lib/auth/permissions";
import { ACTIVE_TAILORING_JOB_STATUSES } from "@/lib/tailoringJobs.shared";
import { actorOrgFilter, withStaffDataScope, staffOwnProductFilter, actorHasCompanyWideView } from "@/lib/staffOrg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REVENUE_STATUSES = ["paid", "shipped", "shipping", "delivered"];

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.AnalyticsRead);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    await connectDB();

    const orgFilter = withStaffDataScope(actor, actorOrgFilter(actor), {
      userId: actor.sub,
    });
    const productWhere = withStaffDataScope(
      actor,
      actorOrgFilter(actor),
      staffOwnProductFilter(actor)
    );

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 60);
    since.setUTCHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const orderWhere = {
      orgId: orgFilter.orgId,
      ...(orgFilter.userId ? { userId: orgFilter.userId } : {}),
    };

    const nonCancelledWhere = {
      ...orderWhere,
      status: { not: "cancelled" as const },
    };
    const revenueWhere = {
      ...orderWhere,
      status: { in: REVENUE_STATUSES },
    };

    // Avoid findMany(all orders) — that was O(n) rows into Node for every dashboard load.
    const [
      totalOrders,
      revenueAgg,
      customerGroups,
      productCount,
      tailoringJobsTotal,
      tailoringJobsActive,
      recentWindowOrders,
      recentOrderIdRows,
      recentPaidOrders,
    ] = await Promise.all([
      prisma.order.count({ where: nonCancelledWhere }),
      prisma.order.aggregate({
        where: revenueWhere,
        _sum: { amount: true },
      }),
      prisma.order.groupBy({
        by: ["userId"],
        where: nonCancelledWhere,
      }),
      prisma.product.count({
        where: productWhere,
      }),
      prisma.tailoringJob.count({
        where: { orgId: orgFilter.orgId },
      }),
      prisma.tailoringJob.count({
        where: {
          orgId: orgFilter.orgId,
          status: { in: [...ACTIVE_TAILORING_JOB_STATUSES] },
        },
      }),
      // Charts: last 60 days only
      prisma.order.findMany({
        where: {
          ...nonCancelledWhere,
          createdAt: { gte: since },
        },
        select: {
          userId: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      }),
      // Activity: newest 80 ids (not full history)
      prisma.order.findMany({
        where: orderWhere,
        orderBy: { createdAt: "desc" },
        take: 80,
        select: { id: true },
      }),
      // Popular items: paid window only
      prisma.order.findMany({
        where: {
          ...revenueWhere,
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          cartId: true,
          createdAt: true,
        },
      }),
    ]);

    const totalRevenue = revenueAgg._sum.amount ?? 0;
    const totalCustomers = customerGroups.length;

    const dailyMap = new Map<
      string,
      { orders: number; revenue: number; customerIds: Set<string> }
    >();
    for (const order of recentWindowOrders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const bucket = dailyMap.get(key) ?? {
        orders: 0,
        revenue: 0,
        customerIds: new Set<string>(),
      };
      bucket.orders += 1;
      if (REVENUE_STATUSES.includes(order.status)) {
        bucket.revenue += order.amount;
      }
      bucket.customerIds.add(order.userId);
      dailyMap.set(key, bucket);
    }
    const dailyData = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, bucket]) => ({
        _id: day,
        orders: bucket.orders,
        revenue: bucket.revenue,
        customers: bucket.customerIds.size,
      }));

    const cartIds = [...new Set(recentPaidOrders.map((o) => o.cartId))];
    const cartLines =
      cartIds.length > 0
        ? await prisma.cartLine.findMany({
            where: { cartId: { in: cartIds } },
            select: {
              cartId: true,
              productId: true,
              fabricId: true,
              quantity: true,
            },
          })
        : [];

    const linesByCart = new Map<string, typeof cartLines>();
    for (const line of cartLines) {
      const list = linesByCart.get(line.cartId);
      if (list) list.push(line);
      else linesByCart.set(line.cartId, [line]);
    }

    const itemQty = new Map<string, number>();
    for (const order of recentPaidOrders) {
      const lines = linesByCart.get(order.cartId) ?? [];
      for (const line of lines) {
        const itemId = line.productId ?? line.fabricId;
        if (!itemId) continue;
        itemQty.set(itemId, (itemQty.get(itemId) ?? 0) + line.quantity);
      }
    }

    const topItems = [...itemQty.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const productIds = topItems.map(([id]) => id);
    const [products, fabrics] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds }, orgId: orgFilter.orgId },
        select: { id: true, name: true },
      }),
      prisma.fabric.findMany({
        where: { id: { in: productIds }, orgId: orgFilter.orgId },
        select: { id: true, name: true },
      }),
    ]);
    const nameById = new Map([
      ...products.map((p) => [p.id, p.name] as const),
      ...fabrics.map((f) => [f.id, f.name] as const),
    ]);

    const mostPopularOrders = topItems.map(([productId, totalQuantity]) => ({
      productId,
      totalQuantity,
      name: nameById.get(productId) ?? "Unknown",
    }));

    const orderIds = recentOrderIdRows.map((o) => o.id);

    const activityOrgId = orgFilter.orgId;
    const companyWide = actorHasCompanyWideView(actor);
    // Never OR bare userId alone — members of this org may have ActivityLog
    // rows stamped for another tenant (or null org). Tenant scope is required.
    type ActivityWhere = import("@prisma/client").Prisma.ActivityLogWhereInput;
    const tenantOrgClause: ActivityWhere | null =
      activityOrgId && isValidId(activityOrgId)
        ? {
            OR: [
              { orgId: activityOrgId },
              { metadata: { path: ["orgId"], equals: activityOrgId } },
            ],
          }
        : null;

    const orClauses: ActivityWhere[] = [];
    if (orderIds.length) {
      // orderIds already filtered to actor.orgId (+ own-scope when CWV false).
      // Still require tenant org on the log row when known (legacy null-org rows excluded).
      orClauses.push(
        tenantOrgClause
          ? {
              AND: [
                tenantOrgClause,
                {
                  entityType: "Order",
                  entityId: { in: orderIds },
                },
              ],
            }
          : {
              entityType: "Order",
              entityId: { in: orderIds },
            }
      );
    }
    if (tenantOrgClause) {
      if (companyWide) {
        orClauses.push(tenantOrgClause);
      } else {
        orClauses.push({
          AND: [{ userId: actor.sub }, tenantOrgClause],
        });
      }
    }
    // No bare userId fallback — that leaked cross-tenant staff activity.

    const activityLog =
      orClauses.length > 0
        ? await prisma.activityLog.findMany({
            where: { OR: orClauses },
            orderBy: { createdAt: "desc" },
            take: 12,
            include: {
              user: { select: { email: true, username: true, role: true } },
            },
          })
        : [];

    // Hide FECSYNC software-owner actors + platform-ops stamps from non-owners.
    let activityFiltered = activityLog;
    {
      const {
        listStorefrontPlatformAdminUserIds,
        resolveIsPlatformSoftwareOwner,
        PLATFORM_OWNER_REDACTED_LABEL,
      } = await import("@/lib/resolvePlatformSoftwareOwner");
      const viewerIsOwner = await resolveIsPlatformSoftwareOwner(actor);
      if (!viewerIsOwner) {
        const ownerIds = await listStorefrontPlatformAdminUserIds();
        activityFiltered = activityLog
          .filter((row) => {
            if (row.userId && ownerIds.has(row.userId)) return false;
            const meta = row.metadata as Record<string, unknown> | null;
            if (meta && meta.domain === "platform-ops") return false;
            return true;
          })
          .map((row) => {
            // Belt-and-suspenders: if an audit stamp somehow remains, redact.
            if (row.userId && ownerIds.has(row.userId)) {
              return {
                ...row,
                description: PLATFORM_OWNER_REDACTED_LABEL,
                action: PLATFORM_OWNER_REDACTED_LABEL,
                user: null,
              };
            }
            return row;
          });
      }
    }

    const activityLogOut = activityFiltered.map((row) => {
      const user = row.user
        ? {
            ...row.user,
            role: toDbUserRole(row.user.role),
          }
        : null;
      return {
        ...row,
        _id: row.id,
        user,
      };
    });

    return ok({
      totals: {
        orders: totalOrders,
        revenue: totalRevenue,
        customers: totalCustomers,
        products: productCount,
        tailoringJobs: tailoringJobsTotal,
        tailoringJobsActive,
      },
      dailyData,
      mostPopularOrders,
      activityLog: activityLogOut,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Analytics error:", error);
    return serverError(
      error instanceof Error ? error.message : "Failed to fetch analytics"
    );
  }
}
