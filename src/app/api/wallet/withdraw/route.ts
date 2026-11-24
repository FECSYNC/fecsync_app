export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import crypto from "crypto";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { serverError, ok, badRequest, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import {
    addFunds,
    attachWalletTransferCode,
    deductFunds,
    isWalletHelperResponse,
} from "@/lib/wallet";
import { initiatePaystackTransfer } from "@/lib/paystack";
import { apiRateLimited } from "@/lib/rateLimit";

function parsePositiveAmount(value: unknown): number | null {
    const n =
        typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number(value.trim())
              : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

// POST /api/wallet/withdraw — session user only. Debit wallet first, then transfer.
export async function POST(request: NextRequest) {
    const limited = apiRateLimited(request, "wallet-withdraw", 5, 15 * 60 * 1000);
    if (limited) return limited;

    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: {
        name?: unknown;
        account_number?: unknown;
        bank_code?: unknown;
        amount?: unknown;
        reason?: unknown;
    };
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const account_number =
        typeof body.account_number === "string"
            ? body.account_number.trim()
            : String(body.account_number ?? "").trim();
    const bank_code =
        typeof body.bank_code === "string"
            ? body.bank_code.trim()
            : String(body.bank_code ?? "").trim();
    const amount = parsePositiveAmount(body.amount);
    const reason =
        (typeof body.reason === "string" && body.reason.trim()) ||
        "Wallet withdrawal";

    if (!name || !account_number || !bank_code || amount == null) {
        return badRequest("Name, account number, bank code, and a positive amount are required");
    }

    const reference = `wd-${crypto.randomUUID()}`;

    try {
        await connectDB();

        const walletDetails = await deductFunds({
            amount,
            userId: actor.sub,
            reference,
            description: reason,
        });

        if (isWalletHelperResponse(walletDetails)) {
            return walletDetails;
        }

        try {
            const transfer = await initiatePaystackTransfer({
                name,
                account_number,
                bank_code,
                amount,
                reason,
                reference,
            });

            const transferCode =
                typeof transfer?.transfer_code === "string"
                    ? transfer.transfer_code
                    : "";
            if (transferCode) {
                await attachWalletTransferCode({
                    userId: actor.sub,
                    reference,
                    transferCode,
                });
            }

            return ok({
                walletDetails,
                transfer: {
                    reference: transfer?.reference || reference,
                    status: transfer?.status,
                    transfer_code: transferCode || undefined,
                },
            });
        } catch (transferError) {
            console.error("[wallet/withdraw] transfer failed, refunding:", transferError);
            const refund = await addFunds({
                amount,
                userId: actor.sub,
                reference: `refund:${reference}`,
                description: "Withdrawal reversed — transfer failed",
            });
            if (isWalletHelperResponse(refund)) {
                return serverError(
                    "Withdrawal transfer failed and the refund could not be completed. Contact support with reference " +
                        reference
                );
            }
            const message =
                transferError instanceof Error
                    ? transferError.message
                    : "Failed to initiate transfer";
            return badRequest(message);
        }
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return serverError("Failed to withdraw from wallet: " + error);
    }
}
