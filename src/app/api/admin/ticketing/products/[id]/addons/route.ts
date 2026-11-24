export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { isValidId } from "@/lib/ids";
import {
  ok,
  created,
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
import { listProductAddOns, linkProductAddOn, unlinkProductAddOn } from "@/lib/ticketing/products";
import {
  PRODUCT_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";

/*
 * GET|POST|DELETE /api/admin/ticketing/products/[id]/addons
 * POST links an add-on product to the parent.
 * DELETE ?addOnProductId= unlinks.
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parseLinkAddOnBody(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  const addOnProductId = String(b.addOnProductId ?? "");
  if (!addOnProductId) throw new Error("addOnProductId is required");
  const out: {
    addOnProductId: string;
    required?: boolean;
    maxQty?: number | null;
    stockPeriodId?: string | null;
  } = { addOnProductId };
  if (b.required !== undefined) out.required = Boolean(b.required);
  if (b.maxQty !== undefined) {
    out.maxQty =
      b.maxQty === null || b.maxQty === "" ? null : Number(b.maxQty);
  }
  if (b.stockPeriodId !== undefined) {
    out.stockPeriodId =
      b.stockPeriodId === null || b.stockPeriodId === ""
        ? null
        : String(b.stockPeriodId);
  }
  return out;
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
        authAudit(request, "GET /api/admin/ticketing/products/[id]/addons", {
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
    const addOns = await listProductAddOns(actor, id);
    return ok({ addOns });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list product add-ons",
      authAudit(request, "GET /api/admin/ticketing/products/[id]/addons", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingRead,
      })
    );
  }
}

export async function POST(
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
        authAudit(request, "POST /api/admin/ticketing/products/[id]/addons", {
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
    const input = parseLinkAddOnBody(body);
    const link = await linkProductAddOn(actor, id, input);
    return created({ link });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to link product add-on",
      authAudit(request, "POST /api/admin/ticketing/products/[id]/addons", {
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
        authAudit(request, "DELETE /api/admin/ticketing/products/[id]/addons", {
          permission: P.TicketingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(PRODUCT_NOT_FOUND);
  }

  const addOnProductId =
    request.nextUrl.searchParams.get("addOnProductId") || "";
  if (!addOnProductId || !isValidId(addOnProductId)) {
    return badRequest("addOnProductId is required");
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
    const result = await unlinkProductAddOn(actor, id, addOnProductId);
    return ok(result);
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to unlink product add-on",
      authAudit(request, "DELETE /api/admin/ticketing/products/[id]/addons", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
