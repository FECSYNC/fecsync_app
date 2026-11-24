export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { isValidId } from "@/lib/ids";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { setProductExpiry } from "@/lib/ticketing/products";
import {
  PRODUCT_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";

/*
 * PATCH /api/admin/ticketing/products/[id]/expiry
 * Body: { defaultPassExpiryDays: number | null }
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parseExpiryBody(body: unknown): number | null {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  if (!Object.prototype.hasOwnProperty.call(b, "defaultPassExpiryDays")) {
    throw new Error("defaultPassExpiryDays is required");
  }
  if (b.defaultPassExpiryDays === null || b.defaultPassExpiryDays === "") {
    return null;
  }
  return Number(b.defaultPassExpiryDays);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/ticketing/products/[id]/expiry", {
          permission: P.TicketingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(PRODUCT_NOT_FOUND);
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
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const defaultPassExpiryDays = parseExpiryBody(body);
    const product = await setProductExpiry(actor, id, defaultPassExpiryDays);
    return ok({ product });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update product expiry",
      authAudit(request, "PATCH /api/admin/ticketing/products/[id]/expiry", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
