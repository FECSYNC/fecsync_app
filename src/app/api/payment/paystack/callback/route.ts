export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import axios from "axios";
import connectDB from "@/lib/db";
import { ok, badRequest, serverError, notFound } from "@/lib/response";
import { addFunds, getTransactionByReference, isWalletHelperResponse } from "@/lib/wallet";
import { getUserFromUuid } from "@/lib/utils";
import { settleOrderGatewayPayment } from "@/lib/orderPaymentSettle";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const reference = searchParams.get("reference");

    if (!reference) {
        return badRequest("Missing reference");
    }

    try {
        await connectDB();

        const { data } = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
            }
        );

        const payment = data?.data;
        if (!payment || payment.status !== "success") {
            return badRequest("Payment not successful");
        }

        const metadata = (payment.metadata || {}) as {
            type?: string;
            amount?: number | string;
            uuid?: string;
            orderId?: string;
        };
        const { type, uuid, orderId } = metadata;

        if (!uuid) {
            return badRequest("Missing user UUID in payment metadata");
        }

        const user = await getUserFromUuid(uuid);
        if (!user?.id) {
            return badRequest("Missing user from payment metadata");
        }

        // Paystack `data.amount` is kobo; prefer that as the charged amount.
        const chargedAmount =
            typeof payment.amount === "number"
                ? payment.amount / 100
                : Number(metadata.amount);

        if (type == "wallet") {
            const existing = await getTransactionByReference({
                reference,
                userId: String(user.id),
            });

            if (existing) {
                return serverError("Transaction already processed");
            }
            const funds = await addFunds({
                amount: chargedAmount,
                userId: user.id,
                reference,
            });
            if (isWalletHelperResponse(funds)) {
                return funds;
            }
            return ok(funds, "Funds processed successfully");
        }

        if (type == "order") {
            if (!orderId) {
                return badRequest("Missing orderId in payment metadata");
            }

            const settled = await settleOrderGatewayPayment({
                orderId: String(orderId),
                user: {
                    _id: String(user.id),
                    email: user.email,
                    firstName:
                        typeof user.firstName === "string"
                            ? user.firstName
                            : undefined,
                    lastName:
                        typeof user.lastName === "string"
                            ? user.lastName
                            : undefined,
                    username:
                        typeof user.username === "string"
                            ? user.username
                            : undefined,
                },
                chargedAmount,
                paymentReference: String(reference),
                provider: "paystack",
            });

            if (!settled.ok) {
                if (settled.response) return settled.response;
                if (settled.code === "not_found") {
                    return notFound(settled.message);
                }
                return badRequest(settled.message);
            }

            return ok(
                {
                    ...(settled.order &&
                    typeof settled.order === "object" &&
                    !Array.isArray(settled.order)
                        ? (settled.order as unknown as Record<string, unknown>)
                        : { order: settled.order }),
                    fulfillmentError: settled.fulfillmentError ?? null,
                },
                settled.alreadyProcessed
                    ? "Order already processed"
                    : "Order processed successfully"
            );
        }

        return badRequest("Unknown payment type");
    } catch (err: unknown) {
        console.error("Verification failed:", err);
        return serverError();
    }
}
