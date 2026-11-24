export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import connectDB from "@/lib/db";
import { ok, created, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
    pickProductWriteFields,
    hasProductWriteFields,
    assertProductRefsInOrg,
    productWriteErrorResponse,
    resolveProductWriteImages,
    buildProductCreateData,
} from "@/lib/productWrite";
import {
    actorOrgFilter,
    requireActorOrgId,
    actorHasCompanyWideView,
    staffOwnProductFilter,
} from "@/lib/staffOrg";
import {
    resolveEffectiveParkScope,
    venueStampedResourceFilter,
} from "@/lib/parkAdminScope";
import { resolveProductVenueLocationIdForWrite } from "@/lib/productParkScope";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { shapeProductForApi } from "@/lib/productPopulate";

// POST /api/product/bulk — products:write. Stamp actor.orgId + seller. Never trust seller/shop/orgId.
export async function POST(req: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(req, P.ProductsWrite);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    if (!Array.isArray(body)) {
        return badRequest("Request body must be an array of products");
    }

    const productsPayload = body.map((item) => {
        const raw =
            item && typeof item === "object"
                ? (item as Record<string, unknown>)
                : {};
        return {
            fields: pickProductWriteFields(raw),
            venueLocationId: raw.venueLocationId,
        };
    });
    if (
        productsPayload.length === 0 ||
        productsPayload.some((row) => !hasProductWriteFields(row.fields))
    ) {
        return badRequest("No valid product fields");
    }

    try {
        await connectDB();
        const orgId = requireActorOrgId(actor);
        const { assertWithinPlanLimit } = await import("@/lib/planLimits");
        await assertWithinPlanLimit(orgId, "products", productsPayload.length);
        for (const row of productsPayload) {
            const refError = await assertProductRefsInOrg(row.fields, orgId);
            if (refError) {
                return badRequest(refError);
            }
        }
        const resolvedPayload = await Promise.all(
            productsPayload.map(async (row) => {
                const fields = await resolveProductWriteImages(row.fields);
                const venueLocationId =
                    await resolveProductVenueLocationIdForWrite(
                        actor,
                        orgId,
                        row.venueLocationId !== undefined
                            ? row.venueLocationId
                            : fields.venueLocationId,
                        { requiredForParkLocked: true }
                    );
                return { fields, venueLocationId };
            })
        );
        const audit = await stampCreate(actor.sub);
        const createData = await Promise.all(
            resolvedPayload.map(async ({ fields, venueLocationId }) => {
                const data = await buildProductCreateData(
                    orgId,
                    fields,
                    audit,
                    actor.sub
                );
                if (venueLocationId !== undefined) {
                    data.venueLocationId = venueLocationId;
                } else {
                    const scope = await resolveEffectiveParkScope(actor);
                    if (scope.parkLocked) {
                        data.venueLocationId =
                            scope.locationId ??
                            scope.assignedLocationIds[0] ??
                            null;
                    }
                }
                return data;
            })
        );
        const products = await prisma.$transaction(
            createData.map((data) => prisma.product.create({ data }))
        );
        logStaffActivityEntry(actor, {
            action: "Products Bulk Created",
            entityType: "Product",
            description: `Created ${products.length} products`,
            request: req,
            metadata: { count: products.length },
        });
        return created(products.map((p) => shapeProductForApi(p)));
    } catch (error) {
        return productWriteErrorResponse(error);
    }
}

// GET /api/product/bulk — products:read; actor.orgId (not public storefront).
export async function GET(req: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(req, P.ProductsRead);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    try {
        await connectDB();
        const base = actorOrgFilter(actor);
        const parkScope = await resolveEffectiveParkScope(actor);
        const venueFilter = venueStampedResourceFilter(
            parkScope,
            "venueLocationId"
        );
        const where = actorHasCompanyWideView(actor)
            ? { orgId: base.orgId, ...venueFilter }
            : {
                  orgId: base.orgId,
                  ...staffOwnProductFilter(actor),
                  ...venueFilter,
              };
        const products = await prisma.product.findMany({ where });
        return ok(products.map((p) => shapeProductForApi(p)));
    } catch (err) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        return serverError("Failed to fetch products");
    }
}
