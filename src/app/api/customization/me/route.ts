export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import prisma from "@/lib/prisma";
import { serializeCustomization } from "@/lib/commerceSerialize";

export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    void request.nextUrl.searchParams;

    try {
        await connectDB();
        const customizations = await prisma.customization.findMany({
            where: prismaOwnedByFilter(actor),
            orderBy: { createdAt: "desc" },
        });

        return ok((customizations ?? []).map(serializeCustomization));
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        const message = error instanceof Error ? error.message : String(error);
        return badRequest("Failed to fetch customizations: " + message);
    }
}
