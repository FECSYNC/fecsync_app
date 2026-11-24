export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import connectDB, { withDbRetry } from "@/lib/db";
import { ok, created, badRequest, notFound, serverError, authErrorToResponse, routeErrorResponse } from "@/lib/response";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
    requireAuthActiveAccount,
    requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
    pickProductWriteFields,
    hasProductWriteFields,
    isProductObjectId,
    assertProductRefsInOrg,
    productWriteErrorResponse,
    resolveProductWriteImages,
    applyShopProductStockFromWrite,
    buildProductCreateData,
} from "@/lib/productWrite";
import {
    resolveStaffCatalogListFilter,
    requireActorOrgId,
    isStaffCatalogScope,
    staffOwnProductFilter,
    actorOrgFilter,
    actorHasCompanyWideView,
} from "@/lib/staffOrg";
import { resolveEffectiveParkScope, venueStampedResourceFilter } from "@/lib/parkAdminScope";
import {
    resolveProductVenueLocationIdForWrite,
} from "@/lib/productParkScope";
import { slimCatalogImages } from "@/lib/catalogImages";
import { stampCreate } from "@/lib/audit/recordAudit";
import {
    findPopulatedProductById,
    PRODUCT_CATALOG_INCLUDE,
    shapeProductForApi,
    genderFromApi,
    genderToApi,
    sizesToApi,
    findCategoryInOrg,
    findFabricInOrg,
    firstRemoteProductImage,
} from "@/lib/productPopulate";

/*
 * Step 5.3 — tenant-scoped staff catalog:
 * - GET public → DEFAULT_ORG_ID / default org.
 * - GET ?scope=staff → actor.orgId (products:read).
 * - POST → stamp actor.orgId (products:write).
 */

function buildProductSort(
    sortParam: string | null
): Prisma.ProductOrderByWithRelationInput {
    if (sortParam === "price_asc") return { price: "asc" };
    if (sortParam === "price_desc") return { price: "desc" };
    if (sortParam === "oldest") return { createdAt: "asc" };
    return { createdAt: "desc" };
}

// POST /api/product — staff catalog write. Never trust body.seller / body.shop / body.orgId.
export async function POST(req: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(req, P.ProductsWrite);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

        const fields = pickProductWriteFields(body);
        if (!hasProductWriteFields(fields)) {
            return badRequest("No valid product fields");
        }

        try {
            await connectDB();
            const orgId = requireActorOrgId(actor);
            const { assertWithinPlanLimit } = await import("@/lib/planLimits");
            await assertWithinPlanLimit(orgId, "products");
            const refError = await assertProductRefsInOrg(fields, orgId);
        if (refError) {
            return badRequest(refError);
        }
        const resolved = await resolveProductWriteImages(fields);
        const audit = await stampCreate(actor.sub);
        const data = await buildProductCreateData(orgId, resolved, audit, actor.sub);
        const venueLocationId = await resolveProductVenueLocationIdForWrite(
            actor,
            orgId,
            body.venueLocationId !== undefined
                ? body.venueLocationId
                : resolved.venueLocationId,
            { requiredForParkLocked: true }
        );
        if (venueLocationId !== undefined) {
            data.venueLocationId = venueLocationId;
        } else {
            const scope = await resolveEffectiveParkScope(actor);
            if (scope.parkLocked) {
                data.venueLocationId =
                    scope.locationId ?? scope.assignedLocationIds[0] ?? null;
            }
        }
        const desiredStock =
            typeof data.remainingInStock === "number" ? data.remainingInStock : 0;
        data.remainingInStock = 0;
        const product = await prisma.product.create({ data });
        await applyShopProductStockFromWrite({
            orgId,
            productId: product.id,
            previousStock: 0,
            nextStock: desiredStock,
            actorId: actor.sub,
            isCreate: true,
        });
        logStaffActivityEntry(actor, {
            action: "Product Created",
            entityType: "Product",
            entityId: product.id,
            description: `Created product "${product.name}"`,
            request: req,
        });
        const populated = await findPopulatedProductById(product.id);
        return created(populated ?? shapeProductForApi(product));
    } catch (error) {
        return productWriteErrorResponse(error);
    }
}

export async function GET(req: NextRequest) {
    try {
        await connectDB();

        const { searchParams } = new URL(req.url);

        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
        const skip = (page - 1) * limit;

        const category = searchParams.get("category");
        const fabric = searchParams.get("fabric");
        const gender = searchParams.get("gender")?.trim() || "";
        const minPrice = searchParams.get("minPrice");
        const maxPrice = searchParams.get("maxPrice");
        const search = searchParams.get("search")?.trim() || "";
        void searchParams.get("seller");
        void searchParams.get("shop");
        void searchParams.get("orgId");

        if (category && !isProductObjectId(category)) {
            return notFound("Product not found");
        }
        if (fabric && !isProductObjectId(fabric)) {
            return notFound("Product not found");
        }

        const sortParam = searchParams.get("sort");
        const orderBy = buildProductSort(sortParam);

        const totalsRaw = (searchParams.get("totals") || "1").trim().toLowerCase();
        const includeTotals = !(
            totalsRaw === "0" ||
            totalsRaw === "false" ||
            totalsRaw === "no"
        );

        let orgFilter: Record<string, unknown>;
        let staffActor: Awaited<ReturnType<typeof requirePermissionFresh>> | null =
            null;
        try {
            if (isStaffCatalogScope(req)) {
                // Single Fresh auth — previously resolveStaffCatalogListFilter +
                // park-scope each called requirePermissionFresh (2× membership reload).
                staffActor = await requirePermissionFresh(req, P.ProductsRead);
                orgFilter = actorOrgFilter(staffActor);
                if (!actorHasCompanyWideView(staffActor)) {
                    Object.assign(orgFilter, staffOwnProductFilter(staffActor));
                }
            } else {
                orgFilter = await resolveStaffCatalogListFilter(
                    req,
                    P.ProductsRead,
                    staffOwnProductFilter
                );
            }
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }

        const orgId = String(orgFilter.orgId);
        const where: Prisma.ProductWhereInput = { orgId };

        if (Array.isArray(orgFilter.OR)) {
            where.OR = orgFilter.OR as Prisma.ProductWhereInput["OR"];
        }

        if (staffActor) {
            try {
                const parkScope = await resolveEffectiveParkScope(staffActor);
                const venueFilter = venueStampedResourceFilter(
                    parkScope,
                    "venueLocationId"
                ) as Prisma.ProductWhereInput;
                Object.assign(where, venueFilter);
            } catch (err) {
                return authErrorToResponse(err) ?? serverError("Failed to authorize");
            }
        }

        if (category) {
            const cat = await findCategoryInOrg(orgId, category);
            if (!cat) {
                return notFound("Product not found");
            }
            where.categoryId = cat.id;
        }
        if (fabric) {
            const fabricDoc = await findFabricInOrg(orgId, fabric);
            if (!fabricDoc) {
                return notFound("Product not found");
            }
            where.fabricTypeId = fabricDoc.id;
        }
        if (gender) {
            const g = genderFromApi(gender);
            if (g) where.gender = g;
        }

        if (minPrice || maxPrice) {
            const price: Prisma.FloatFilter = {};
            if (minPrice) price.gte = Number(minPrice);
            if (maxPrice) price.lte = Number(maxPrice);
            where.price = price;
        }

        if (search) {
            where.name = { contains: search, mode: "insensitive" };
        }

        const staffScope = isStaffCatalogScope(req);
        const leanRaw = (searchParams.get("lean") || "").trim().toLowerCase();
        const leanList =
            staffScope &&
            (leanRaw === "1" || leanRaw === "true" || leanRaw === "yes");

        let wishlistProductIds: string[] = [];

        if (!staffScope && req.cookies.get("access-token")?.value) {
            try {
                // ActiveAccount: suspended users must not learn wishlist product ids.
                const decoded = await requireAuthActiveAccount(req);
                const wishlist = await prisma.wishlist.findUnique({
                    where: { userId: decoded.sub },
                    include: { items: { select: { productId: true } } },
                });
                if (wishlist?.items?.length) {
                    wishlistProductIds = wishlist.items.map((item) => item.productId);
                }
            } catch {
                /* unauthenticated or account suspended — skip favourite flags */
            }
        }

        const wishlistSet =
            wishlistProductIds.length > 0
                ? new Set(wishlistProductIds)
                : null;

        let total: number;
        let products: Array<Record<string, unknown>>;

        if (staffScope && leanList) {
            // Dashboard / hover prefetch: skip images JSON + category/fabric joins
            // (base64 data URLs in images[] were multi‑MB and ~30s per list call).
            [total, products] = await withDbRetry(async () => {
                const rowsPromise = prisma.product.findMany({
                    where,
                    orderBy,
                    skip,
                    take: limit,
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        createdAt: true,
                        gender: true,
                        sizes: true,
                        remainingInStock: true,
                    },
                });
                const mapLean = (
                    row: Awaited<typeof rowsPromise>[number]
                ): Record<string, unknown> => ({
                    _id: row.id,
                    id: row.id,
                    name: row.name,
                    price: row.price,
                    createdAt: row.createdAt,
                    gender: genderToApi(row.gender),
                    sizes: sizesToApi(row.sizes),
                    remainingInStock: row.remainingInStock,
                    images: [],
                });
                if (!includeTotals) {
                    const rows = await rowsPromise;
                    return [skip + rows.length, rows.map(mapLean)];
                }
                const [count, rows] = await Promise.all([
                    prisma.product.count({ where }),
                    rowsPromise,
                ]);
                return [count, rows.map(mapLean)];
            });
        } else if (staffScope) {
            [total, products] = await withDbRetry(async () => {
                const rowsPromise = prisma.product.findMany({
                    where,
                    include: PRODUCT_CATALOG_INCLUDE,
                    orderBy,
                    skip,
                    take: limit,
                });
                if (!includeTotals) {
                    const rows = await rowsPromise;
                    return [
                        skip + rows.length,
                        rows.map((row) => shapeProductForApi(row)),
                    ];
                }
                const [count, rows] = await Promise.all([
                    prisma.product.count({ where }),
                    rowsPromise,
                ]);
                return [count, rows.map((row) => shapeProductForApi(row))];
            });
        } else {
            [total, products] = await withDbRetry(async () => {
                const rowsPromise = prisma.product.findMany({
                    where,
                    include: PRODUCT_CATALOG_INCLUDE,
                    orderBy,
                    skip,
                    take: limit,
                });
                const mapStorefrontRow = (
                    row: Awaited<typeof rowsPromise>[number]
                ) => {
                    const shaped = shapeProductForApi(row, {
                        fabricRefMode: "minimal",
                    });
                    return {
                        ...shaped,
                        images: slimCatalogImages(
                            firstRemoteProductImage(row.images),
                            480
                        ),
                    };
                };
                if (!includeTotals) {
                    const rows = await rowsPromise;
                    return [
                        skip + rows.length,
                        rows.map(mapStorefrontRow),
                    ];
                }
                const [countResult, rows] = await Promise.all([
                    prisma.product.count({ where }).catch((err) => {
                        console.warn(
                            "[product] count timed out; using page-size estimate",
                            err
                        );
                        return null as number | null;
                    }),
                    rowsPromise,
                ]);
                const count =
                    typeof countResult === "number"
                        ? countResult
                        : skip + rows.length;
                return [count, rows.map(mapStorefrontRow)];
            });
        }

        const enriched = products.map((product) => ({
            ...product,
            // Staff lists used to ship full base64 data URLs (multi‑MB each) —
            // same stall as storefront before slimCatalogImages. Thumbs only.
            // Lean lists already omit images.
            images: leanList
                ? []
                : slimCatalogImages(product.images, staffScope ? 320 : 480),
            favourite: wishlistSet
                ? wishlistSet.has(String(product._id))
                : false,
        }));

        const response = ok({
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0,
            count: enriched.length,
            data: enriched,
        });

        if (!staffScope) {
            response.headers.set("Cache-Control", "private, no-store");
        }

        return response;
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return routeErrorResponse(error, "Failed to fetch products");
    }
}
