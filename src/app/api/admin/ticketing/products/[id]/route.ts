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
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  getAdmissionProduct,
  updateAdmissionProduct,
  archiveAdmissionProduct,
} from "@/lib/ticketing/products";
import {
  PRODUCT_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";

/*
 * GET|PATCH|DELETE /api/admin/ticketing/products/[id]
 * DELETE soft-archives. Actor.orgId only — never trust body.orgId / ?orgId=.
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parsePatchProductBody(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    name: typeof b.name === "string" ? b.name : undefined,
    description:
      b.description === undefined
        ? undefined
        : typeof b.description === "string"
          ? b.description
          : null,
    images: Array.isArray(b.images) ? (b.images as string[]) : undefined,
    resourceId:
      b.resourceId === undefined
        ? undefined
        : b.resourceId === null || b.resourceId === ""
          ? null
          : String(b.resourceId),
    categoryId:
      b.categoryId === undefined
        ? undefined
        : b.categoryId === null || b.categoryId === ""
          ? null
          : String(b.categoryId),
    published: typeof b.published === "boolean" ? b.published : undefined,
    waiverRequired:
      typeof b.waiverRequired === "boolean" ? b.waiverRequired : undefined,
    minGuests:
      b.minGuests === undefined
        ? undefined
        : b.minGuests === null || b.minGuests === ""
          ? null
          : Number(b.minGuests),
    maxGuests:
      b.maxGuests === undefined
        ? undefined
        : b.maxGuests === null || b.maxGuests === ""
          ? null
          : Number(b.maxGuests),
    defaultPassExpiryDays:
      b.defaultPassExpiryDays === undefined
        ? undefined
        : b.defaultPassExpiryDays === null || b.defaultPassExpiryDays === ""
          ? null
          : Number(b.defaultPassExpiryDays),
    taxExemptDefault:
      typeof b.taxExemptDefault === "boolean"
        ? b.taxExemptDefault
        : undefined,
    archive: b.archive === true ? true : undefined,
    unarchive: b.unarchive === true ? true : undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/products/[id]", {
          permission: P.TicketingRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(PRODUCT_NOT_FOUND);
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
    const product = await getAdmissionProduct(actor, id);
    return ok({ product });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load ticket product",
      authAudit(request, "GET /api/admin/ticketing/products/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingRead,
      })
    );
  }
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
        authAudit(request, "PATCH /api/admin/ticketing/products/[id]", {
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
    const patch = parsePatchProductBody(body);
    const product = await updateAdmissionProduct(actor, id, patch);
    return ok({ product });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update ticket product",
      authAudit(request, "PATCH /api/admin/ticketing/products/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}

export async function DELETE(
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
        authAudit(request, "DELETE /api/admin/ticketing/products/[id]", {
          permission: P.TicketingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(PRODUCT_NOT_FOUND);
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
    const product = await archiveAdmissionProduct(actor, id);

    logStaffActivityEntry(actor, {
      action: "Ticket Product Archived",
      entityType: "AdmissionProduct",
      entityId: product.id,
      description: `Archived ticket product "${product.name}"`,
      request,
    });

    return ok({ product });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to archive ticket product",
      authAudit(request, "DELETE /api/admin/ticketing/products/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
