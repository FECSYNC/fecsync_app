export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { badRequest, created, ok, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { getAdminEmail, sendCustomRequestMail } from "@/lib/mailer";
import { pickCustomizationFields } from "@/lib/customizationAccess";
import { serializeCustomization } from "@/lib/commerceSerialize";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";

export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(request, P.CustomizationsRead);
        await assertStorefrontStaffOrg(actor);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    await connectDB();
    try {
        // No Customization.orgId — storefront staff only (not registered companies).
        const data = await prisma.customization.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });
        return ok(data.map(serializeCustomization));
    } catch (error) {
        console.error("Failed to fetch customizations:", error);
        return serverError("Failed to fetch customizations");
    }
}

export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    try {
        await connectDB();
        const fields = pickCustomizationFields(body);
        const customization = await prisma.customization.create({
            data: {
                userId: actor.sub,
                outfit: String(fields.outfit ?? ""),
                fabricType: String(fields.fabricType ?? ""),
                size: String(fields.size ?? ""),
                preferredColor: String(fields.preferredColor ?? ""),
                outfitOption: fields.outfitOption != null ? String(fields.outfitOption) : undefined,
                additionalNotes: fields.additionalNotes != null ? String(fields.additionalNotes) : undefined,
                productId: fields.productId != null ? String(fields.productId) : undefined,
                referenceImage: Array.isArray(fields.referenceImage) ? fields.referenceImage as string[] : [],
                fabricImage: fields.fabricImage != null ? String(fields.fabricImage) : undefined,
                selections: fields.selections ?? undefined,
            },
        });

        const serialized = serializeCustomization(customization);

        try {
            await sendCustomRequestMail({
                to: actor.email,
                subject: "FECSYNC - Customization Request",
                type: "user",
                data: serialized,
            });
            await sendCustomRequestMail({
                to: getAdminEmail() || "",
                subject: "FECSYNC - Customization Request",
                type: "admin",
                data: serialized,
                customerEmail: actor.email,
            });
        } catch (mailError) {
            console.error("Customization request email failed (non-blocking):", mailError);
        }

        return created(serialized);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return badRequest("Failed to create customization: " + error);
    }
}
