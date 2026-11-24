export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import connectDB from "@/lib/db";
import {
  ok,
  notFound,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { attachFabricProductCounts } from "@/lib/fabricProductCounts";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  pickFabricBody,
  hasFabricWriteFields,
  validateFabricPayload,
  resolveFabricWriteImage,
} from "@/lib/fabricApi";
import {
  isCatalogObjectId,
  catalogWriteErrorResponse,
  isPlainObject,
  whereOrgAndCatalogId,
  catalogIdWhere,
  auditUpdateToPrisma,
} from "@/lib/catalogWrite";
import {
  resolveCatalogAccess,
  requireActorOrgId,
  assertActorOrgMatch,
  assertStaffCreatedByOwnScope,
} from "@/lib/staffOrg";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { shapeFabricForApi } from "@/lib/productPopulate";

function mapFabricUpdateData(payload: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const keys = [
    "name",
    "image",
    "type",
    "color",
    "pattern",
    "composition",
    "supplier",
    "inStock",
    "isSellable",
    "taxExempt",
  ] as const;
  for (const key of keys) {
    if (payload[key] !== undefined) {
      data[key] = payload[key];
    }
  }
  for (const key of ["weight", "width", "pricePerMeter", "yardBundle", "bundlePrice", "stockBundles", "taxRate"] as const) {
    if (payload[key] !== undefined) {
      data[key] =
        payload[key] === null ? null : Number(payload[key]);
    }
  }
  return data;
}

// GET /api/fabric/[id] — public storefront, or ?scope=staff → actor.orgId.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isCatalogObjectId(id)) {
    return notFound("Fabric not found");
  }
  try {
    const { searchParams } = new URL(request.url);
    void searchParams.get("seller");
    void searchParams.get("shop");
    void searchParams.get("orgId");
    await connectDB();

    let access: Awaited<ReturnType<typeof resolveCatalogAccess>>;
    try {
      access = await resolveCatalogAccess(request, P.FabricsRead);
    } catch (err) {
      return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    if (access.scope === "staff") {
      const fabricData = await prisma.fabric.findFirst({
        where: catalogIdWhere(id),
      });
      if (!fabricData) {
        return notFound("Fabric not found");
      }
      assertActorOrgMatch(access.orgId, fabricData.orgId);
      assertStaffCreatedByOwnScope(access.actor, fabricData.createdById);
      const shaped = shapeFabricForApi(fabricData);
      const [withCount] = await attachFabricProductCounts(
        [shaped],
        access.orgId
      );
      return ok(withCount);
    }

    const fabricData = await prisma.fabric.findFirst({
      where: whereOrgAndCatalogId(access.orgId, id),
    });
    if (!fabricData) {
      return notFound("Fabric not found");
    }
    return ok(shapeFabricForApi(fabricData));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    return serverError(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// PUT /api/fabric/[id] — fabrics:write; actor.orgId only.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.FabricsWrite);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  const { id } = await params;
  if (!isCatalogObjectId(id)) {
    return notFound("Fabric not found");
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

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const existing = await prisma.fabric.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
    });
    if (!existing) {
      return notFound("Fabric not found");
    }
    assertActorOrgMatch(orgId, existing.orgId);
    assertStaffCreatedByOwnScope(actor, existing.createdById);

    const merged = { ...existing, ...payload };
    const validationError = validateFabricPayload(merged as Record<string, unknown>);
    if (validationError) {
      return badRequest(validationError);
    }

    if (payload.name !== undefined) {
      if (typeof payload.name !== "string" || !payload.name.trim()) {
        return badRequest("Name cannot be empty");
      }
      payload.name = payload.name.trim();
    }

    const resolved = await resolveFabricWriteImage(payload);
    const audit = auditUpdateToPrisma(await stampUpdate(actor.sub));
    const updatedFabric = await prisma.fabric.update({
      where: { id: existing.id },
      data: {
        ...mapFabricUpdateData(resolved),
        ...audit,
      },
    });
    logStaffActivityEntry(actor, {
      action: "Fabric Updated",
      entityType: "Fabric",
      entityId: id,
      description: `Updated fabric "${updatedFabric.name ?? id}"`,
      request,
    });
    const shaped = shapeFabricForApi(updatedFabric);
    const [withCount] = await attachFabricProductCounts([shaped], orgId);
    return ok(withCount);
  } catch (error) {
    return catalogWriteErrorResponse(error, "fabric");
  }
}

// DELETE /api/fabric/[id] — fabrics:delete; actor.orgId only.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.FabricsDelete);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  const { id } = await params;
  if (!isCatalogObjectId(id)) {
    return notFound("Fabric not found");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const existing = await prisma.fabric.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
      select: { id: true, orgId: true, name: true, createdById: true },
    });
    if (!existing) {
      return notFound("Fabric not found");
    }
    assertActorOrgMatch(orgId, existing.orgId);
    assertStaffCreatedByOwnScope(actor, existing.createdById);

    const linkedProducts = await prisma.product.count({
      where: { orgId, fabricTypeId: existing.id },
    });
    if (linkedProducts > 0) {
      return badRequest(
        `Cannot delete this fabric because it is used by ${linkedProducts} product${
          linkedProducts === 1 ? "" : "s"
        }. Reassign or remove those products first.`
      );
    }

    const deletedFabric = await prisma.fabric.delete({
      where: { id: existing.id },
    });
    logStaffActivityEntry(actor, {
      action: "Fabric Deleted",
      entityType: "Fabric",
      entityId: id,
      description: `Deleted fabric "${deletedFabric.name ?? id}"`,
      request,
    });
    return ok(shapeFabricForApi(deletedFabric));
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (err instanceof Error && err.message.includes("Cannot delete")) {
      return badRequest(err.message);
    }
    return notFound("Fabric not found");
  }
}
