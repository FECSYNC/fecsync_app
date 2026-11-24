export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { ok, notFound, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import {
  requireAuthFresh,
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { ownsResource } from "@/lib/auth/claims";
import { P } from "@/lib/auth/permissions";
import { isValidId } from "@/lib/ids";
import { prismaOwnedByFilter, serializeCustomization } from "@/lib/commerceSerialize";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    let actor;
    try {
        actor = await requireAuthFresh(request, { allowSuspendedOrg: true });
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const { userId } = await params;
    if (!isValidId(userId)) {
        return notFound("User not found");
    }

    const isOwner = ownsResource(actor, userId);
    if (!isOwner) {
        // Staff path: storefront org only (matches GET /api/customization list).
        try {
            actor = await requirePermissionFresh(request, P.CustomizationsRead);
            const { assertStorefrontStaffOrg } = await import("@/lib/staffOrg");
            await assertStorefrontStaffOrg(actor);
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }
    }

    try {
        await connectDB();
        const customizations = await prisma.customization.findMany({
            where: isOwner ? prismaOwnedByFilter(actor) : { userId },
            orderBy: { createdAt: "desc" },
        });

        return ok((customizations ?? []).map(serializeCustomization));
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return badRequest("Failed to fetch customizations: " + error);
    }
}
