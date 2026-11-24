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
import {
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  getBookingCategory,
  updateBookingCategory,
  archiveBookingCategory,
} from "@/lib/ticketing/categories";

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function rejectOrgSelectors(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has("orgId") ||
    request.nextUrl.searchParams.has("organizationId")
  ) {
    return badRequest("Unsupported selector in query");
  }
  return null;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingProductsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/categories/[id]", {
          permission: P.TicketingProductsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const rejected = rejectOrgSelectors(request);
    if (rejected) return rejected;
    const { id } = await ctx.params;
    const category = await getBookingCategory(actor, id);
    return ok({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load booking category",
      authAudit(request, "GET /api/admin/ticketing/categories/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingProductsRead,
      })
    );
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingProductsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/ticketing/categories/[id]", {
          permission: P.TicketingProductsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const rejected = rejectOrgSelectors(request);
    if (rejected) return rejected;
    const { id } = await ctx.params;
    const category = await updateBookingCategory(actor, id, body);
    return ok({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update booking category",
      authAudit(request, "PATCH /api/admin/ticketing/categories/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingProductsWrite,
      })
    );
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingProductsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/ticketing/categories/[id]", {
          permission: P.TicketingProductsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const rejected = rejectOrgSelectors(request);
    if (rejected) return rejected;
    const { id } = await ctx.params;
    const category = await archiveBookingCategory(actor, id);
    return ok({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to archive booking category",
      authAudit(request, "DELETE /api/admin/ticketing/categories/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingProductsWrite,
      })
    );
  }
}
