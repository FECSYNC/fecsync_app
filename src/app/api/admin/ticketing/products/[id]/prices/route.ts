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
import {
  listProductPrices,
  replaceProductPrices,
  type PriceBandInput,
} from "@/lib/ticketing/products";
import {
  PRODUCT_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";

/*
 * GET|POST /api/admin/ticketing/products/[id]/prices
 * POST replaces all price bands: { prices: PriceBandInput[] }.
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parseReplacePricesBody(body: unknown): PriceBandInput[] {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  if (!Array.isArray(b.prices)) {
    throw new Error("At least one price band is required");
  }
  return b.prices as PriceBandInput[];
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
        authAudit(request, "GET /api/admin/ticketing/products/[id]/prices", {
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
    const prices = await listProductPrices(actor, id);
    return ok({ prices });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list product prices",
      authAudit(request, "GET /api/admin/ticketing/products/[id]/prices", {
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
        authAudit(request, "POST /api/admin/ticketing/products/[id]/prices", {
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
    const prices = parseReplacePricesBody(body);
    const product = await replaceProductPrices(actor, id, prices);
    return created({ product, prices: product.prices });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to replace product prices",
      authAudit(request, "POST /api/admin/ticketing/products/[id]/prices", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
