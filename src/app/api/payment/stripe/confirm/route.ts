import { ok, badRequest, serverError, notFound } from "@/lib/response";
import { addFunds, getTransactionByReference, isWalletHelperResponse } from "@/lib/wallet";
import { getUserFromUuid } from "@/lib/utils";
import { getCheckoutSession, getStripe } from "@/lib/stripe";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { settleOrderGatewayPayment } from "@/lib/orderPaymentSettle";

/**
 * ACCEPTED OPEN (Step 7.1): no JWT — proves payment via Stripe session_id
 * (getCheckoutSession). Called from success pages + webhook. Mutates wallet/order
 * only after Stripe reports paid + metadata uuid ownership filter.
 *
 * Order settlement is idempotent (atomic paid lock + amount check + fulfill claim)
 * so browser success and Stripe webhook can both call this safely.
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
        return badRequest("Missing session_id");
    }

    try {
        await connectDB();
        const session = await getCheckoutSession(sessionId);
        const metadata = (session.metadata || {}) as Record<string, string | undefined>;
        const payment = {
            status:
                session.payment_status === "paid"
                    ? "success"
                    : session.payment_status || "unknown",
            metadata,
            amount: (session.amount_total || 0) / 100,
            id: session.id,
        };

        if (payment.status !== "success") {
            return badRequest("Payment not successful");
        }

        const { type, uuid, orderId, reference } = payment.metadata;

        // Manual accounting invoice Checkout — same shape as webhooks/stripe.
        if (type === "accounting_invoice") {
            const invoiceId = metadata.invoiceId?.trim();
            const orgId = metadata.orgId?.trim();
            const rawPi = session.payment_intent;
            const pi =
                typeof rawPi === "string"
                    ? rawPi
                    : rawPi && typeof rawPi === "object" && "id" in rawPi
                      ? String((rawPi as { id: string }).id)
                      : null;
            if (!invoiceId || !orgId || !pi) {
                return badRequest("Missing accounting invoice payment metadata");
            }
            const amountMinor =
                typeof session.amount_total === "number" ? session.amount_total : 0;
            const connectedAccountId =
                metadata.connectedAccountId?.trim() ||
                (typeof session.transfer_data?.destination === "string"
                    ? session.transfer_data.destination
                    : null);
            await prisma.$transaction(async (tx) => {
                const { createReceiptFromStripe } = await import(
                    "@/lib/accounting/receivables/customerReceipts"
                );
                await createReceiptFromStripe(tx, {
                    orgId,
                    invoiceId,
                    paymentIntentId: pi,
                    amountMinor,
                    connectedAccountId,
                });
            });
            try {
                const stripe = getStripe();
                const intent = await stripe.paymentIntents.retrieve(pi, {
                    expand: ["latest_charge.balance_transaction"],
                });
                const charge =
                    intent.latest_charge && typeof intent.latest_charge === "object"
                        ? intent.latest_charge
                        : null;
                const bal =
                    charge &&
                    typeof charge.balance_transaction === "object" &&
                    charge.balance_transaction
                        ? charge.balance_transaction
                        : null;
                if (bal && typeof bal === "object" && "id" in bal && "fee" in bal) {
                    const feeMinor = Number((bal as { fee?: number }).fee ?? 0);
                    if (feeMinor > 0) {
                        const { queueAccountingSync } = await import(
                            "@/lib/accounting/postingQueue"
                        );
                        await queueAccountingSync({
                            orgId,
                            locationId: metadata.locationId?.trim() || null,
                            sourceType: "processor_fee",
                            sourceId: String((bal as { id: string }).id),
                            sourceEvent: "fee",
                            payload: {
                                feeMinor,
                                connectedAccountId,
                                locationId: metadata.locationId?.trim() || null,
                                description: `Invoice ${invoiceId}`,
                            },
                        });
                    }
                }
            } catch (feeErr) {
                console.warn("[stripe confirm] accounting_invoice fee capture skipped", feeErr);
            }
            return ok({ kind: "accounting_invoice", settled: true });
        }

        if (!uuid) {
            return badRequest("Missing user UUID in payment metadata");
        }

        const user = await getUserFromUuid(uuid);

        if (!user || !user.id) {
            return badRequest("Missing user ID from payment metadata");
        }

        const userId = user.id;
        const txReference = reference || payment.id;

        if (type == "wallet") {
            const existing = await getTransactionByReference({
                reference: txReference,
                userId: String(userId),
            });

            if (existing) {
                return serverError("Transaction already processed");
            }
            const funds = await addFunds({
                amount: payment.amount,
                userId,
                reference: txReference,
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
                    _id: String(userId),
                    email: String(user.email ?? ""),
                    firstName:
                        typeof (user as { firstName?: unknown }).firstName ===
                        "string"
                            ? (user as { firstName: string }).firstName
                            : undefined,
                    lastName:
                        typeof (user as { lastName?: unknown }).lastName ===
                        "string"
                            ? (user as { lastName: string }).lastName
                            : undefined,
                    username:
                        typeof (user as { username?: unknown }).username ===
                        "string"
                            ? (user as { username: string }).username
                            : undefined,
                },
                chargedAmount: payment.amount,
                paymentReference: String(txReference),
                provider: "stripe",
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

        if (type == "tailoring") {
            const jobId = payment.metadata.jobId;
            if (!jobId) {
                return badRequest("Missing jobId in payment metadata");
            }

            const { settleTailoringJobGatewayPayment } = await import(
                "@/lib/tailoringJobPaymentSettle"
            );
            const settled = await settleTailoringJobGatewayPayment({
                jobId: String(jobId),
                user: {
                    _id: String(userId),
                    email: String(user.email ?? ""),
                    firstName:
                        typeof (user as { firstName?: unknown }).firstName ===
                        "string"
                            ? (user as { firstName: string }).firstName
                            : undefined,
                    lastName:
                        typeof (user as { lastName?: unknown }).lastName ===
                        "string"
                            ? (user as { lastName: string }).lastName
                            : undefined,
                    username:
                        typeof (user as { username?: unknown }).username ===
                        "string"
                            ? (user as { username: string }).username
                            : undefined,
                },
                chargedAmount: payment.amount,
                paymentReference: String(txReference),
                provider: "stripe",
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
                    jobId: String(settled.job.id),
                    status: settled.job.status,
                    paymentReference: settled.job.paymentReference,
                    amount: settled.job.amount,
                    alreadyProcessed: settled.alreadyProcessed,
                },
                settled.alreadyProcessed
                    ? "Tailoring payment already processed"
                    : "Tailoring payment processed successfully"
            );
        }

        return ok(session);
    } catch (err: unknown) {
        console.error("Failed to retrieve session:", err);
        return serverError(err ? String(err) : "Failed to retrieve session");
    }
}
