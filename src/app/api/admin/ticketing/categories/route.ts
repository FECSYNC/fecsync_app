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
  created,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  listBookingCategories,
  createBookingCategory,
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

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingProductsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/categories", {
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
    const includeArchived =
      request.nextUrl.searchParams.get("includeArchived") === "1" ||
      request.nextUrl.searchParams.get("includeArchived") === "true";
    const categories = await listBookingCategories(actor, {
      includeArchived,
    });
    return ok({ categories, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list booking categories",
      authAudit(request, "GET /api/admin/ticketing/categories", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingProductsRead,
      })
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingProductsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/ticketing/categories", {
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
    const category = await createBookingCategory(actor, body);
    return created({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create booking category",
      authAudit(request, "POST /api/admin/ticketing/categories", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingProductsWrite,
      })
    );
  }
}
