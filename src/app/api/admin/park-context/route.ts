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
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  getParkContext,
  setParkContext,
  parseParkContextBody,
} from "@/lib/parkContext";

/*
 * GET|PUT /api/admin/park-context
 * Park assignment scope for Growth/Starter park admins (no Enterprise required).
 * Never trust body/query orgId / userId / membershipId / locationId as authority.
 */

const PARK_CONTEXT_PERMS = [
  P.SettingsManage,
  P.AnalyticsRead,
  P.ProductsWrite,
  P.ProductsRead,
  P.OrdersRead,
  P.TicketingRead,
  P.TicketingWrite,
  P.BookingsRead,
  P.BookingsWrite,
  P.MembershipsRead,
  P.MembershipsWrite,
  P.MembershipsSell,
  P.MembershipsBilling,
  P.MembershipsAdmin,
  P.WaiversRead,
  P.WaiversWrite,
  P.WaiversVerify,
  P.WaiversAdmin,
  P.PosRead,
  P.PosSell,
  P.PosAdmin,
  P.PosCheckin,
  P.PosTabs,
  P.PosTillOpen,
] as const;

const VALIDATION_MESSAGES = new Set([
  "Invalid JSON",
  "locationId must be a string or null",
]);

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...PARK_CONTEXT_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/park-context", {
          permission: "park-context:any",
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("userId") ||
      request.nextUrl.searchParams.has("membershipId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const context = await getParkContext(actor);
    return ok({ context });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to load park context",
      authAudit(request, "GET /api/admin/park-context", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
      })
    );
  }
}

export async function PUT(request: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...PARK_CONTEXT_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PUT /api/admin/park-context", {
          permission: "park-context:any",
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const limited = apiRateLimited(
    request,
    "park-context",
    30,
    15 * 60 * 1000,
    `${actor.orgId ?? ""}:${actor.sub}`
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("userId") ||
      request.nextUrl.searchParams.has("membershipId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }

    let parsed: { locationId: string | null };
    try {
      parsed = parseParkContextBody(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON";
      if (VALIDATION_MESSAGES.has(msg)) return badRequest(msg);
      throw err;
    }

    const context = await setParkContext(actor, parsed.locationId);
    return ok({ context });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to set park context",
      authAudit(request, "PUT /api/admin/park-context", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
      })
    );
  }
}
