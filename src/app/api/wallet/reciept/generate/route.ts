export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, badRequest, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { getTransactionByReference } from "@/lib/wallet";
import { sendReceiptMail } from "@/lib/sendReceipts";
import { getUserFromUserid } from "@/lib/utils";

// POST /api/wallet/reciept/generate — own transactions only.
export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: { reference?: unknown };
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const reference = body?.reference;
    if (!reference || typeof reference !== "string") {
        return badRequest("Transaction reference is required");
    }

    try {
        await connectDB();

        const transaction = await getTransactionByReference({
            reference,
            userId: actor.sub,
        });
        if (!transaction) {
            return badRequest("Transaction not found");
        }
        const userRecord = await getUserFromUserid(actor.sub);

        try {
            await sendReceiptMail({
                to: actor.email,
                subject: "Payment Receipt",
                data: {
                    customerName: userRecord
                        ? userRecord.firstName
                            ? userRecord.lastName
                                ? `${userRecord.firstName} ${userRecord.lastName}`
                                : userRecord.firstName
                            : userRecord.username || "Customer"
                        : "Customer",
                    receiptId: transaction.reference,
                    amountPaid: transaction.amount || 0,
                    paymentMethod: transaction.type || "Wallet",
                    date: new Date().toISOString().split("T")[0],
                },
            });
        } catch (mailErr) {
            // Payment already succeeded — do not fail the API when SMTP/mail is down.
            console.error("Receipt email failed:", mailErr);
            return ok({
                success: true,
                message: "Transaction found; receipt email could not be sent",
                data: {
                    reference: transaction.reference,
                    emailSent: false,
                },
            });
        }

        return ok({
            success: true,
            message: "Receipt sent successfully",
            data: {
                reference: transaction.reference,
                emailSent: true,
            },
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Error sending receipt:", error);
        return serverError("Failed to send receipt: " + error);
    }
}
