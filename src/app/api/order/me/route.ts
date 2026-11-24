export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { loadOrdersList } from "@/lib/orderList";

export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    await connectDB();

    try {
        const { searchParams } = new URL(request.url);
        const limitRaw = Number(searchParams.get("limit"));
        const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
        const hydrateParam = searchParams.get("hydrate");
        const hydrateCarts =
            hydrateParam == null ||
            !["0", "false", "no"].includes(hydrateParam.toLowerCase());

        const orders = await loadOrdersList(prismaOwnedByFilter(actor), {
            limit,
            hydrateCarts,
        });
        return ok(orders);
    } catch (error) {
        console.error("Failed to fetch orders:", error);
        return badRequest("Failed to fetch orders" + error);
    }
}
