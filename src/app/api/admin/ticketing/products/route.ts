export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermission, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  listAdmissionProducts,
  createAdmissionProduct,
  parseCreateProductBody,
  type ProductListFilters,
} from "@/lib/ticketing/products";
import type { AdmissionProductType } from "@prisma/client";

/*
 * GET|POST /api/admin/ticketing/products
 * Actor.orgId only — never trust body.orgId / ?orgId=.
 * GET may filter by ?locationId= (lib validates via org/scope).
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export async function GET(request: NextRequest) {
  let actor;
  try {
    // List reads: JWT permission; live module/billing gates run in listAdmissionProducts.
    actor = requirePermission(request, P.TicketingRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/products", {
          permission: P.TicketingRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }

    const sp = request.nextUrl.searchParams;
    const typeRaw = sp.get("type");
    const publishedRaw = sp.get("published");
    const locationId = sp.get("locationId") || undefined;
    const categoryId = sp.get("categoryId") || undefined;
    const includeArchived = sp.get("includeArchived") === "true";
    const takeRaw = sp.get("take");
    const skipRaw = sp.get("skip");

    const filters: ProductListFilters = { includeArchived };
    if (typeRaw && typeRaw !== "all") {
      filters.type = typeRaw as AdmissionProductType;
    }
    if (publishedRaw === "true") filters.published = true;
    else if (publishedRaw === "false") filters.published = false;
    else if (publishedRaw === "all") filters.published = "all";
    if (locationId) filters.locationId = locationId;
    if (categoryId) filters.categoryId = categoryId;
    if (takeRaw) filters.take = Number(takeRaw);
    if (skipRaw) filters.skip = Number(skipRaw);

    const products = await listAdmissionProducts(actor, filters);
    return ok({
      products,
      orgId: String(actor.orgId),
    });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list ticket products",
      authAudit(request, "GET /api/admin/ticketing/products", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingRead,
      })
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/ticketing/products", {
          permission: P.TicketingWrite,
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
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const input = parseCreateProductBody(body);
    const product = await createAdmissionProduct(actor, input);

    logStaffActivityEntry(actor, {
      action: "Ticket Product Created",
      entityType: "AdmissionProduct",
      entityId: product.id,
      description: `Created ticket product "${product.name}" (${product.type})`,
      request,
    });

    return created({ product });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create ticket product",
      authAudit(request, "POST /api/admin/ticketing/products", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
