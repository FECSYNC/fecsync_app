export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import connectDB from "@/lib/db";
import {
  ok,
  notFound,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  pickCategoryWriteFields,
  hasCategoryWriteFields,
} from "@/lib/categoryWrite";
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
import { attachCategoryProductCounts } from "@/lib/categoryProductCounts";
import { shapeCategoryForApi } from "@/lib/productPopulate";
import {
  applyPublicPagePatch,
  deactivatePublicCategoryPage,
  ensureMissingPublicCategoryPages,
  parsePublicPageSettingsPatch,
  publicPageClientErrorMessage,
  publicPageDtosForProductCategories,
  retryOnPublicSlugConflict,
} from "@/lib/publicCategory/pages";

// GET /api/product-category/[id] — public, or ?scope=staff → actor.orgId.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isCatalogObjectId(id)) {
    return notFound("Product category not found");
  }
  try {
    const { searchParams } = new URL(request.url);
    void searchParams.get("seller");
    void searchParams.get("shop");
    await connectDB();

    let access: Awaited<ReturnType<typeof resolveCatalogAccess>>;
    try {
      access = await resolveCatalogAccess(request, P.CategoriesRead);
    } catch (err) {
      return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    if (access.scope === "staff") {
      const categoryData = await prisma.productCategory.findFirst({
        where: catalogIdWhere(id),
      });
      if (!categoryData) {
        return notFound("Product category not found");
      }
      assertActorOrgMatch(access.orgId, categoryData.orgId);
      assertStaffCreatedByOwnScope(access.actor, categoryData.createdById);
      await ensureMissingPublicCategoryPages(access.orgId, "menu", [
        { id: categoryData.id, name: categoryData.name },
      ]);
      const shaped = shapeCategoryForApi(categoryData);
      const [withCount] = await attachCategoryProductCounts(
        [shaped],
        access.orgId
      );
      const pages = await publicPageDtosForProductCategories(access.orgId, [
        categoryData.id,
      ]);
      return ok({
        ...withCount,
        publicPage: pages.get(categoryData.id) ?? null,
      });
    }

    const categoryData = await prisma.productCategory.findFirst({
      where: whereOrgAndCatalogId(access.orgId, id),
    });
    if (!categoryData) {
      return notFound("Product category not found");
    }
    return ok(shapeCategoryForApi(categoryData));
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    return serverError(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// PUT /api/product-category/[id] — categories:write; actor.orgId only.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.CategoriesWrite);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  const { id } = await params;
  if (!isCatalogObjectId(id)) {
    return notFound("Product category not found");
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

  const fields = pickCategoryWriteFields(body);
  let publicPatch: ReturnType<typeof parsePublicPageSettingsPatch> = null;
  try {
    publicPatch = parsePublicPageSettingsPatch(body, { slugKey: "publicSlug" });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Invalid public link");
  }
  if (!hasCategoryWriteFields(fields) && !publicPatch) {
    return badRequest("No valid category fields");
  }

  if (fields.name !== undefined) {
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    if (!name) {
      return badRequest("Name is required");
    }
    fields.name = name;
  }

  if (typeof fields.description === "string") {
    fields.description = fields.description.trim();
  }
  if (fields.id !== undefined) {
    const slug = typeof fields.id === "string" ? fields.id.trim() : "";
    if (!slug) {
      return badRequest("id (slug) cannot be empty");
    }
    fields.id = slug;
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const existing = await prisma.productCategory.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
      select: { id: true, orgId: true, createdById: true },
    });
    if (!existing) {
      return notFound("Product category not found");
    }
    assertActorOrgMatch(orgId, existing.orgId);
    assertStaffCreatedByOwnScope(actor, existing.createdById);

    if (typeof fields.name === "string") {
      const duplicate = await prisma.productCategory.findFirst({
        where: {
          orgId,
          name: fields.name,
          NOT: { id: existing.id },
        },
      });
      if (duplicate) {
        return badRequest("Category with this name already exists.");
      }
    }
    const audit = await stampUpdate(actor.sub);
    const updateData: {
      name?: string;
      description?: string | null;
      legacyStringId?: string;
      updatedById?: string;
      updatedByName?: string;
    } = { ...auditUpdateToPrisma(audit) };
    if (typeof fields.name === "string") updateData.name = fields.name;
    if (fields.description !== undefined) {
      updateData.description =
        typeof fields.description === "string" ? fields.description : null;
    }
    if (typeof fields.id === "string") updateData.legacyStringId = fields.id;

    const updatedCategory = await retryOnPublicSlugConflict(() =>
      prisma.$transaction(async (tx) => {
      const updated = await tx.productCategory.update({
        where: { id: existing.id },
        data: updateData,
      });
      if (publicPatch) {
        await applyPublicPagePatch(
          tx,
          {
            orgId,
            kind: "menu",
            name: updated.name,
            productCategoryId: existing.id,
          },
          publicPatch
        );
      }
      return updated;
      })
    );
    logStaffActivityEntry(actor, {
      action: "Category Updated",
      entityType: "Category",
      entityId: id,
      description: `Updated category "${updatedCategory.name ?? id}"`,
      request,
    });
    const shaped = shapeCategoryForApi(updatedCategory);
    const [withCount] = await attachCategoryProductCounts([shaped], orgId);
    const pages = await publicPageDtosForProductCategories(orgId, [
      updatedCategory.id,
    ]);
    return ok({
      ...withCount,
      publicPage: pages.get(updatedCategory.id) ?? null,
    });
  } catch (error) {
    const publicMessage = publicPageClientErrorMessage(error);
    if (publicMessage) return badRequest(publicMessage);
    return catalogWriteErrorResponse(error, "product category");
  }
}

// DELETE /api/product-category/[id] — categories:delete; actor.orgId only.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.CategoriesDelete);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  const { id } = await params;
  if (!isCatalogObjectId(id)) {
    return notFound("Product category not found");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const existing = await prisma.productCategory.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
      select: { id: true, orgId: true, name: true, createdById: true },
    });
    if (!existing) {
      return notFound("Product category not found");
    }
    assertActorOrgMatch(orgId, existing.orgId);
    assertStaffCreatedByOwnScope(actor, existing.createdById);

    const shopLinked = await prisma.product.count({
      where: { orgId, categoryId: existing.id },
    });
    if (shopLinked > 0) {
      return badRequest(
        `Cannot delete this category because it is used by ${shopLinked} shop product${
          shopLinked === 1 ? "" : "s"
        }. Reassign or remove those products first.`
      );
    }

    const deletedCategory = await prisma.$transaction(async (tx) => {
      await deactivatePublicCategoryPage(tx, {
        orgId,
        productCategoryId: existing.id,
      });
      return tx.productCategory.delete({
        where: { id: existing.id },
      });
    });
    logStaffActivityEntry(actor, {
      action: "Category Deleted",
      entityType: "Category",
      entityId: id,
      description: `Deleted category "${deletedCategory.name ?? id}"`,
      request,
    });
    return ok(shapeCategoryForApi(deletedCategory));
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (err instanceof Error && err.message.includes("Cannot delete")) {
      return badRequest(err.message);
    }
    // Race: product linked after preflight count — Restrict FK must not look like 404.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return badRequest(
        "Cannot delete this category because it is still linked to one or more products. Reassign or remove those products first."
      );
    }
    return notFound("Product category not found");
  }
}
