export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest } from "next/server";
import connectDB, { withDbRetry } from "@/lib/db";
import prisma from "@/lib/prisma";
import { ok, badRequest, serverError, unauthorized, notFound, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, assertCheckoutMethod } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { isPlainObject } from "@/lib/catalogWrite";
import { checkoutMethodFromPurchaseType } from "@/lib/auth/permissions";
import { isValidId } from "@/lib/ids";
import {
    loadCartForCheckout,
    validateCartForOrder,
} from "@/lib/orderFulfillment";
import { isTransientMongoError } from "@/lib/cartPersistence";
import { initiateGatewayPayment } from "@/lib/gatewayPayment";
import { settleOrderWalletPayment } from "@/lib/orderPaymentSettle";
import { getUserFromUserid } from "@/lib/utils";

export async function POST(request: NextRequest) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }
    if (!isPlainObject(body)) {
        return badRequest("Invalid JSON");
    }

    let user;
    try {
        user = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? unauthorized("Unauthorized");
    }

    const type = typeof body.type === "string" ? body.type : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!type || !orderId) {
        return badRequest("Type and orderId are required");
    }
    if (!isValidId(orderId)) {
        return notFound("Order not found");
    }

    const method = checkoutMethodFromPurchaseType(type);
    if (!method) {
        return badRequest("Invalid payment type");
    }
    try {
        assertCheckoutMethod(method, "api");
    } catch (err) {
        return (
            authErrorToResponse(err) ?? badRequest("Invalid payment type")
        );
    }

    try {
        return await withDbRetry(async () => {
            await connectDB();
            const userDetails = await getUserFromUserid(user.sub);
            if (!userDetails) {
                return notFound("User not found");
            }
            const uuid = userDetails.uuid;

            if (method === "wallet") {
                const wallet = await prisma.wallet.findFirst({
                    where: prismaOwnedByFilter(user),
                });
                if (!wallet) {
                    return badRequest("Wallet not found for user");
                }

                const order = await prisma.order.findFirst({
                    where: { id: orderId, ...prismaOwnedByFilter(user) },
                });

                if (!order) {
                    return badRequest("Order not found");
                }
                if (
                    order.status !== "pending" &&
                    order.status !== "initiated" &&
                    order.status !== "paid" &&
                    order.status !== "shipping" &&
                    order.status !== "shipped" &&
                    order.status !== "delivered"
                ) {
                    return badRequest("Order already processed");
                }

                const alreadySettled =
                    order.status === "paid" ||
                    order.status === "shipping" ||
                    order.status === "shipped" ||
                    order.status === "delivered";

                if (!alreadySettled) {
                    const cart = await loadCartForCheckout(order.cartId, user.sub);
                    await validateCartForOrder(cart);

                    if (order.amount > wallet.balance) {
                        return badRequest("Insufficient funds in wallet");
                    }
                }

                const settled = await settleOrderWalletPayment({
                    orderId,
                    userId: user.sub,
                    user: {
                        _id: String(user.sub),
                        email: user.email,
                        firstName:
                            typeof userDetails.firstName === "string"
                                ? userDetails.firstName
                                : undefined,
                        lastName:
                            typeof userDetails.lastName === "string"
                                ? userDetails.lastName
                                : undefined,
                        username:
                            typeof userDetails.username === "string"
                                ? userDetails.username
                                : undefined,
                    },
                });

                if (!settled.ok) {
                    if (settled.response) return settled.response;
                    if (settled.code === "not_found") return notFound(settled.message);
                    return badRequest(settled.message);
                }

                return ok({
                    success: true,
                    message: settled.alreadyProcessed
                        ? "Order already processed"
                        : "Funds deducted from wallet",
                    fulfillmentError: settled.fulfillmentError,
                });
            }

            if (method === "paystack" || method === "stripe") {
                const paymentInit = await initiateGatewayPayment({
                    userId: user.sub,
                    orderId,
                    email: user.email,
                    uuid,
                    gateway:
                        method === "stripe" ? "stripe-gateway" : "paystack-gateway",
                });

                return ok({
                    success: true,
                    message: "Payment initialized",
                    data: paymentInit,
                });
            }

            return badRequest("Invalid payment type");
        }, 2);
    } catch (error) {
        console.error("Failed to initialize payment:", error);
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        if (isTransientMongoError(error)) {
            return serverError(
                "Database temporarily unavailable. Please wait a moment and try checkout again."
            );
        }
        const message = error instanceof Error ? error.message : String(error);
        return badRequest(message);
    }
}
