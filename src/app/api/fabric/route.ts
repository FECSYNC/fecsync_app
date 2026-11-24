export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  pickFabricBody,
  hasFabricWriteFields,
  validateFabricPayload,
  resolveFabricWriteImage,
} from "@/lib/fabricApi";
import {
  catalogWriteErrorResponse,
  isPlainObject,
  auditCreateToPrisma,
} from "@/lib/catalogWrite";
import {
  resolveStaffCatalogListFilter,
  requireActorOrgId,
  isStaffCatalogScope,
  staffOwnCreatedByFilter,
} from "@/lib/staffOrg";
import { toStorefrontFabricImage } from "@/lib/catalogImages";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { attachFabricProductCounts } from "@/lib/fabricProductCounts";
import { shapeFabricForApi } from "@/lib/productPopulate";

function mapFabricCreateData(
  orgId: string,
  payload: Record<string, unknown>,
  audit: ReturnType<typeof auditCreateToPrisma>
) {
  return {
    orgId,
    name: String(payload.name ?? ""),
    image: String(payload.image ?? ""),
    type: String(payload.type ?? ""),
    color: String(payload.color ?? ""),
    pattern:
      payload.pattern !== undefined ? String(payload.pattern) : undefined,
    weight: payload.weight !== undefined ? Number(payload.weight) : undefined,
    width: payload.width !== undefined ? Number(payload.width) : undefined,
    composition:
      payload.composition !== undefined
        ? String(payload.composition)
        : undefined,
    supplier:
      payload.supplier !== undefined ? String(payload.supplier) : undefined,
    pricePerMeter:
      payload.pricePerMeter !== undefined
        ? Number(payload.pricePerMeter)
        : undefined,
    inStock: payload.inStock !== undefined ? Boolean(payload.inStock) : true,
    yardBundle:
      payload.yardBundle !== undefined
        ? Number(payload.yardBundle)
        : undefined,
    bundlePrice:
      payload.bundlePrice !== undefined
        ? Number(payload.bundlePrice)
        : undefined,
    stockBundles:
      payload.stockBundles !== undefined
        ? Number(payload.stockBundles)
        : undefined,
    isSellable:
      payload.isSellable !== undefined ? Boolean(payload.isSellable) : false,
    taxRate:
      payload.taxRate === null || payload.taxRate === undefined
        ? null
        : Number(payload.taxRate),
    taxExempt:
      payload.taxExempt !== undefined ? Boolean(payload.taxExempt) : false,
    ...audit,
  };
}

/*
 * Step 5.3 — GET public → storefront org; GET ?scope=staff → actor.orgId.
 * POST stamps actor.orgId.
 */

// GET /api/fabric — public storefront, or ?scope=staff admin list.
export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const sellableOnly = searchParams.get("sellable") === "true";
    void searchParams.get("seller");
    void searchParams.get("shop");
    void searchParams.get("orgId");

    let orgFilter: Record<string, unknown>;
    try {
      orgFilter = await resolveStaffCatalogListFilter(
        request,
        P.FabricsRead,
        staffOwnCreatedByFilter
      );
    } catch (err) {
      return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const orgId = String(orgFilter.orgId);
    const where: Record<string, unknown> = sellableOnly
      ? { ...orgFilter, isSellable: true, inStock: true }
      : { ...orgFilter };

    const staffScope = isStaffCatalogScope(request);
    const fabrics = await prisma.fabric.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: staffScope
        ? undefined
        : {
            id: true,
            name: true,
            type: true,
            color: true,
            pattern: true,
            image: true,
            yardBundle: true,
            bundlePrice: true,
            taxRate: true,
            taxExempt: true,
            inStock: true,
            isSellable: true,
            createdAt: true,
            updatedAt: true,
          },
    });

    const shaped = fabrics.map((row) => shapeFabricForApi(row as Parameters<typeof shapeFabricForApi>[0]));

    const payload = staffScope
      ? await attachFabricProductCounts(shaped, orgId)
      : shaped.map((row) => toStorefrontFabricImage(row, 480));

    const response = ok(payload);
    if (!staffScope) {
      response.headers.set("Cache-Control", "private, no-store");
    }
    return response;
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    return serverError(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// POST /api/fabric — fabrics:write; stamp actor.orgId.
export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.FabricsWrite);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const payload = pickFabricBody(body);
  if (!hasFabricWriteFields(payload)) {
    return badRequest("No valid fabric fields");
  }

  if (!payload.name || typeof payload.name !== "string" || !payload.name.trim()) {
    return badRequest("Name is required");
  }
  payload.name = payload.name.trim();

  const validationError = validateFabricPayload(payload, { requireName: true });
  if (validationError) {
    return badRequest(validationError);
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertWithinPlanLimit } = await import("@/lib/planLimits");
    await assertWithinPlanLimit(orgId, "fabrics");
    const resolved = await resolveFabricWriteImage(payload);
    const audit = auditCreateToPrisma(await stampCreate(actor.sub));
    const newFabric = await prisma.fabric.create({
      data: mapFabricCreateData(orgId, resolved, audit),
    });
    logStaffActivityEntry(actor, {
      action: "Fabric Created",
      entityType: "Fabric",
      entityId: newFabric.id,
      description: `Created fabric "${newFabric.name}"`,
      request,
    });
    const lean = shapeFabricForApi(newFabric);
    return created({ ...lean, productCount: 0 });
  } catch (error) {
    return catalogWriteErrorResponse(error, "fabric");
  }
}
