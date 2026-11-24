export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import {
  assertMembershipsStaff,
  locationScopeFilter,
} from "@/lib/memberships/common";
import { listDunningWorkQueue } from "@/lib/memberships/dunning";

const ROUTE = "GET /api/admin/memberships/dunning-queue";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      P.MembershipsBilling,
      P.MembershipsRead,
      P.MembershipsAdmin,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, ROUTE, { permission: P.MembershipsBilling })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const sp = request.nextUrl.searchParams;
    if (sp.has("orgId") || sp.has("organizationId")) {
      return badRequest("Unsupported selector in query");
    }
    const orgId = await assertMembershipsStaff(actor);
    const queue = await listDunningWorkQueue({ orgId, take: 100 });

    // Park-locked / HQ-scoped seats only see members homed in their parks.
    const scope = await locationScopeFilter(actor);
    const scopedIds = scope.parkLocked
      ? scope.locationIds ?? (scope.locationId ? [scope.locationId] : [])
      : scope.locationId
        ? [scope.locationId]
        : null;
    let items = queue.items;
    if (scopedIds) {
      const allowed = await prisma.guestMembership.findMany({
        where: {
          orgId,
          id: { in: items.map((i) => i.id) },
          homeLocationId: { in: scopedIds },
        },
        select: { id: true },
      });
      const allowedSet = new Set(allowed.map((r) => r.id));
      items = items.filter((i) => allowedSet.has(i.id));
    }

    return ok({
      advanced: queue.advanced,
      retryDays: queue.retryDays,
      items,
    });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to load dunning queue",
      authAudit(request, ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsBilling,
      })
    );
  }
}
