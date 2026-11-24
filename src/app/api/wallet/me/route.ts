export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { ensureOwnedWallet } from "@/lib/wallet";

// GET /api/wallet/me — own wallet only. Ignore ?userId=.
export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    try {
        await connectDB();
        const walletDetails = await ensureOwnedWallet(actor.sub);
        return ok({
            walletDetails,
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to fetch wallet details:", error);
        return serverError("Failed to fetch wallet details: " + error);
    }
}
