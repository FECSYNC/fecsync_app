export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { serverError, ok, badRequest, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { initializePayment2 } from "@/lib/paystack";
import { getUserFromUserid } from "@/lib/utils";

// POST /api/wallet/fund — session user only. Never trust body.user.
export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: { amount?: unknown; metadata?: unknown; gateway?: unknown };
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    if (!body.amount || !body.metadata || !body.gateway) {
        return badRequest("Amount, metadata, and gateway are required");
    }

    try {
        await connectDB();
        const userDetails = await getUserFromUserid(actor.sub);
        if (!userDetails) {
            return badRequest("User not found");
        }

        if (body.gateway === "paystack") {
            const amount = Number(body.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return badRequest("Invalid amount");
            }

            const metadata = {
                uuid: userDetails.uuid,
                type: "wallet",
                amount,
                orderId: "",
                items: [] as unknown[],
            };

            const paymentInit = await initializePayment2(
                actor.email,
                amount,
                metadata,
            );

            return ok({
                paymentInit,
            });
        }

        return badRequest("Unsupported gateway");
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return serverError("Failed to fund wallet: " + error);
    }
}
