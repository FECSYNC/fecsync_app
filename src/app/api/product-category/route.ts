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
  pickCategoryWriteFields,
  hasCategoryWriteFields,
} from "@/lib/categoryWrite";
import {
  catalogWriteErrorResponse,
  isPlainObject,
  auditCreateToPrisma,
} from "@/lib/catalogWrite";
import {
  resolveStaffCategoryListFilter,
  requireActorOrgId,
  isStaffCatalogScope,
  staffOwnCreatedByFilter,
} from "@/lib/staffOrg";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { attachCategoryProductCounts } from "@/lib/categoryProductCounts";
import { shapeCategoryForApi } from "@/lib/productPopulate";
import {
  ensureMissingPublicCategoryPages,
  insertPublicCategoryPage,
  publicPageClientErrorMessage,
  publicPageDtosForProductCategories,
  retryOnPublicSlugConflict,
} from "@/lib/publicCategory/pages";

/*
 * Step 5.3 — GET public → storefront; GET ?scope=staff → actor.orgId.
 * POST stamps actor.orgId. Unique name is per org.
 */

// GET /api/product-category — public storefront, or ?scope=staff admin list.
export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    void searchParams.get("seller");
    void searchParams.get("shop");
    void searchParams.get("orgId");

    let orgFilter: Record<string, unknown>;
    try {
      orgFilter = await resolveStaffCategoryListFilter(
        request,
        staffOwnCreatedByFilter
      );
    } catch (err) {
      return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const orgId = String(orgFilter.orgId);
    const categories = await prisma.productCategory.findMany({
      where: orgFilter,
      orderBy: { name: "asc" },
    });
    const shaped = categories.map((c) => shapeCategoryForApi(c));

    if (isStaffCatalogScope(request)) {
      await ensureMissingPublicCategoryPages(
        orgId,
        "menu",
        categories.map((row) => ({ id: row.id, name: row.name }))
      );
      const withCounts = await attachCategoryProductCounts(shaped, orgId);
      const pages = await publicPageDtosForProductCategories(
        orgId,
        withCounts.map((row) => String(row._id))
      );
      return ok(
        withCounts.map((row) => ({
          ...row,
          publicPage: pages.get(String(row._id)) ?? null,
        }))
      );
    }
    return ok(shaped);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    return serverError(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// POST /api/product-category — categories:write; stamp actor.orgId.
export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.CategoriesWrite);
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

  const fields = pickCategoryWriteFields(body);
  if (!hasCategoryWriteFields(fields)) {
    return badRequest("No valid category fields");
  }

  const name =
    typeof fields.name === "string" ? fields.name.trim() : "";
  if (!name) {
    return badRequest("Name is required");
  }
  fields.name = name;
  if (typeof fields.description === "string") {
    fields.description = fields.description.trim();
  }
  const slug = typeof fields.id === "string" ? fields.id.trim() : "";
  if (!slug) {
    return badRequest("id (slug) is required");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertWithinPlanLimit } = await import("@/lib/planLimits");
    await assertWithinPlanLimit(orgId, "categories");
    const existingCategory = await prisma.productCategory.findFirst({
      where: { orgId, name },
    });
    if (existingCategory) {
      return badRequest("Category with this name already exists.");
    }
    const audit = await stampCreate(actor.sub);
    const newCategory = await retryOnPublicSlugConflict(() =>
      prisma.$transaction(async (tx) => {
      const created = await tx.productCategory.create({
        data: {
          orgId,
          name,
          description:
            typeof fields.description === "string" ? fields.description : null,
          legacyStringId: slug,
          ...auditCreateToPrisma(audit),
        },
      });
      await insertPublicCategoryPage(tx, {
        orgId,
        kind: "menu",
        name,
        productCategoryId: created.id,
      });
      return created;
      })
    );
    logStaffActivityEntry(actor, {
      action: "Category Created",
      entityType: "Category",
      entityId: newCategory.id,
      description: `Created category "${newCategory.name}"`,
      request,
    });
    const lean = shapeCategoryForApi(newCategory);
    const pages = await publicPageDtosForProductCategories(orgId, [
      newCategory.id,
    ]);
    return created({
      ...lean,
      productCount: 0,
      shopProductCount: 0,
      bookingProductCount: 0,
      publicPage: pages.get(newCategory.id) ?? null,
    });
  } catch (error) {
    const publicMessage = publicPageClientErrorMessage(error);
    if (publicMessage) return badRequest(publicMessage);
    return catalogWriteErrorResponse(error, "product category");
  }
}
