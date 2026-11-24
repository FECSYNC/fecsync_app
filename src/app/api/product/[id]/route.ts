export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import connectDB, { withDbRetry } from "@/lib/db";
import { ok, badRequest, notFound, serverError, authErrorToResponse, authAudit, routeErrorResponse } from "@/lib/response";
import {
    requireAuthActiveAccount,
    requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { assertProductDeleteAllowed } from "@/lib/auth/resourcePolicy";
import {
    pickProductWriteFields,
    hasProductWriteFields,
    isProductObjectId,
    assertProductRefsInOrg,
    productWriteErrorResponse,
    resolveProductWriteImages,
    applyShopProductStockFromWrite,
    buildProductUpdateData,
} from "@/lib/productWrite";
import {
    resolveCatalogAccess,
    requireActorOrgId,
    assertActorOrgMatch,
    assertStaffProductOwnScope,
    actorHasCompanyWideView,
} from "@/lib/staffOrg";
import {
    resolveProductVenueLocationIdForWrite,
    assertProductVenueAccess,
} from "@/lib/productParkScope";
import { asIdString } from "@/lib/ids";
import { optimizeProductGalleryImages } from "@/lib/productImages";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
    findPopulatedProductById,
    PRODUCT_CATALOG_INCLUDE,
    shapeProductForApi,
} from "@/lib/productPopulate";
import { whereOrgAndCatalogId, catalogIdWhere } from "@/lib/catalogWrite";

// GET /api/product/[id] — public storefront detail, or ?scope=staff → actor.orgId.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isProductObjectId(id)) {
        return notFound("Product not found");
    }
    await connectDB();

    let access: Awaited<ReturnType<typeof resolveCatalogAccess>>;
    try {
        access = await resolveCatalogAccess(request, P.ProductsRead);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const loadWishlist = async () => {
        if (access.scope === "staff") return [] as string[];
        try {
            // ActiveAccount: suspended users must not learn wishlist product ids.
            const decoded = await requireAuthActiveAccount(request);
            const wishlist = await prisma.wishlist.findUnique({
                where: { userId: decoded.sub },
                include: { items: { select: { productId: true } } },
            });
            if (wishlist?.items?.length) {
                return wishlist.items.map((item) => item.productId);
            }
        } catch {
            /* Unauthenticated or account suspended — skip wishlist logic */
        }
        return [] as string[];
    };

    if (access.scope === "staff") {
        const product = await prisma.product.findFirst({
            where: catalogIdWhere(id),
            include: PRODUCT_CATALOG_INCLUDE,
        });
        if (!product) {
            return notFound("Product not found");
        }
        try {
            assertActorOrgMatch(access.orgId, product.orgId);
            assertStaffProductOwnScope(access.actor, product);
            await assertProductVenueAccess(access.actor, product);
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }
        return ok({
            ...shapeProductForApi(product),
            favourite: false,
        });
    }

    const [wishlistProductIds, product] = await Promise.all([
        loadWishlist(),
        prisma.product.findFirst({
            where: whereOrgAndCatalogId(access.orgId, id),
            include: PRODUCT_CATALOG_INCLUDE,
        }),
    ]);

    if (!product) {
        return notFound("Product not found");
    }

    const shaped = shapeProductForApi(product);
    const enriched = {
        ...shaped,
        images: optimizeProductGalleryImages(shaped.images, 960),
        favourite: wishlistProductIds.includes(product.id),
    };

    const response = ok(enriched);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
}

// PUT /api/product/[id] — products:write; actor.orgId only.
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    let actor;
    try {
        actor = await requirePermissionFresh(request, P.ProductsWrite);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const { id } = await params;
    if (!isProductObjectId(id)) {
        return notFound("Product not found");
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const fields = pickProductWriteFields(body);
    if (!hasProductWriteFields(fields)) {
        return badRequest("No valid product fields");
    }

    try {
        return await withDbRetry(async () => {
        await connectDB();
        const orgId = requireActorOrgId(actor);
        const refErrorPromise = assertProductRefsInOrg(fields, orgId);
        const resolvedPromise = resolveProductWriteImages(fields);
        const auditPromise = stampUpdate(actor.sub);
        const [existing, refError, resolved, audit] = await Promise.all([
            prisma.product.findFirst({
                where: whereOrgAndCatalogId(orgId, id),
                select: {
                    id: true,
                    orgId: true,
                    sellerId: true,
                    createdById: true,
                    venueLocationId: true,
                },
            }),
            refErrorPromise,
            resolvedPromise,
            auditPromise,
        ]);
        if (!existing) {
            return notFound("Product not found");
        }
        assertActorOrgMatch(orgId, existing.orgId);
        assertStaffProductOwnScope(actor, existing);
        await assertProductVenueAccess(actor, existing);
        if (refError) {
            return badRequest(refError);
        }
        const updateData = await buildProductUpdateData(resolved, orgId, audit);
        const nextStock =
            updateData.remainingInStock !== undefined
                ? Number(updateData.remainingInStock)
                : undefined;
        if (nextStock !== undefined) {
            delete updateData.remainingInStock;
        }
        if (body.venueLocationId !== undefined || resolved.venueLocationId !== undefined) {
            const nextVenue = await resolveProductVenueLocationIdForWrite(
                actor,
                orgId,
                body.venueLocationId !== undefined
                    ? body.venueLocationId
                    : resolved.venueLocationId
            );
            if (nextVenue !== undefined) {
                updateData.venueLocationId = nextVenue;
            }
        }
        // Never claim a coworker's legacy null sellerId under CWV=true.
        if (
            !existing.sellerId &&
            (!actorHasCompanyWideView(actor) ||
                asIdString(existing.createdById) === actor.sub)
        ) {
            updateData.sellerId = actor.sub;
        }
        await prisma.product.update({
            where: { id: existing.id },
            data: updateData,
        });
        if (nextStock !== undefined) {
            await applyShopProductStockFromWrite({
                orgId,
                productId: existing.id,
                previousStock: existing.remainingInStock,
                nextStock,
                actorId: actor.sub,
            });
        }
        logStaffActivityEntry(actor, {
            action: "Product Updated",
            entityType: "Product",
            entityId: existing.id,
            description: `Updated product "${(resolved.name as string | undefined) ?? id}"`,
            request,
        });
        const populated = await findPopulatedProductById(existing.id);
        return ok(populated);
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return routeErrorResponse(error, "Failed to save product");
    }
}

// DELETE /api/product/[id] — products:delete; actor.orgId only.
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    let actor;
    try {
        actor = await requirePermissionFresh(request, P.ProductsDelete);
    } catch (err) {
        return (
            authErrorToResponse(
                err,
                authAudit(request, "DELETE /api/product/[id]", {
                    permission: P.ProductsDelete,
                })
            ) ?? serverError("Failed to authorize")
        );
    }

    assertProductDeleteAllowed(actor.permissions);

    const { id } = await params;
    if (!isProductObjectId(id)) {
        return notFound("Product not found");
    }

    try {
        await connectDB();
        const orgId = requireActorOrgId(actor);
        const existing = await prisma.product.findFirst({
            where: whereOrgAndCatalogId(orgId, id),
            select: {
                id: true,
                orgId: true,
                sellerId: true,
                createdById: true,
                name: true,
                venueLocationId: true,
            },
        });
        if (!existing) {
            return notFound("Product not found");
        }
        assertActorOrgMatch(orgId, existing.orgId);
        assertStaffProductOwnScope(actor, existing);
        await assertProductVenueAccess(actor, existing);

        const deleted = await prisma.product.delete({
            where: { id: existing.id },
        });
        logStaffActivityEntry(actor, {
            action: "Product Deleted",
            entityType: "Product",
            entityId: id,
            description: `Deleted product "${deleted.name ?? id}"`,
            request,
        });
        return ok(shapeProductForApi(deleted));
    } catch (err) {
        const authRes = authErrorToResponse(
            err,
            authAudit(request, "DELETE /api/product/[id]", {
                actorSub: actor.sub,
                orgId: actor.orgId ?? null,
                permission: P.ProductsDelete,
            })
        );
        if (authRes) return authRes;
        return notFound("Product not found");
    }
}
