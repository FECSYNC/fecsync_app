export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import connectDB, { withDbRetry } from "@/lib/db";
import { isTransientMongoError } from "@/lib/cartPersistence";
import { ok, created, badRequest, conflict, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { logActivityEntry } from "@/lib/audit/activityLog";
import { ensureOwnedWallet } from "@/lib/wallet";
import {
    calculateOrderTotals,
    getCartItemCount,
    loadCartForCheckout,
    refreshFabricLineSnapshots,
    resolveOrderOrgId,
    validateCartForOrder,
} from "@/lib/orderFulfillment";
import { actorOrgFilter, withStaffDataScope } from "@/lib/staffOrg";
import { loadOrdersList } from "@/lib/orderList";
import {
    resolveEffectiveParkScope,
    venueStampedResourceFilter,
} from "@/lib/parkAdminScope";
import { serializeOrder } from "@/lib/commerceSerialize";
import { orderMoneyComponentsMatchTotal } from "@/utils/tax";
import {
    formatShippingAddressLine,
    getOrCreateShippingSettings,
    isShippingCheckoutRequired,
    isShippingError,
    resolveDestinationSnapshot,
    resolveShippingSelectionForOrder,
    ShippingRateExpiredError,
    type ProfileShippingAddress,
    type ShippingSelectionInput,
} from "@/lib/shipping";

type OrderCreateBody = {
    carts?: unknown;
    address?: unknown;
    amount?: unknown;
    shippingSelection?: ShippingSelectionInput | null;
    shippingAddress?: ProfileShippingAddress | null;
    /** Tamper probes — rejected if present */
    shippingFee?: unknown;
    shippingMethod?: unknown;
};

export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(request, P.OrdersRead);
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

        const orgFilter = actorOrgFilter(actor);
        const filter = withStaffDataScope(actor, { orgId: orgFilter.orgId }, {
            user: actor.sub,
        });
        const parkScope = await resolveEffectiveParkScope(actor);
        const venueFilter = venueStampedResourceFilter(
            parkScope,
            "venueLocationId"
        );
        const orders = await loadOrdersList(
            { ...filter, ...venueFilter },
            {
            limit,
            hydrateCarts,
            includeShipmentOpsFields: hasPermission(
                actor.permissions,
                P.DeliveriesRead
            ),
        }
        );
        return ok(orders);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to fetch orders:", error);
        return badRequest("Failed to fetch orders: " + error);
    }
}

export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: OrderCreateBody;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    // Never accept client-authored fee/method/amount — only validated shippingSelection.
    if (
        Object.prototype.hasOwnProperty.call(body, "shippingFee") ||
        Object.prototype.hasOwnProperty.call(body, "shippingMethod") ||
        Object.prototype.hasOwnProperty.call(body, "amount") ||
        Object.prototype.hasOwnProperty.call(body, "subtotal") ||
        Object.prototype.hasOwnProperty.call(body, "taxAmount")
    ) {
        return badRequest(
            "Order totals and shippingMethod cannot be set directly; select a quoted rate"
        );
    }

    try {
        return await withDbRetry(async () => {
            await connectDB();

            const wallet = await ensureOwnedWallet(actor.sub);

            const cart = await loadCartForCheckout(String(body.carts ?? ""), actor.sub);
            await refreshFabricLineSnapshots(cart);
            await validateCartForOrder(cart);

            const orgId = await resolveOrderOrgId(cart);
            const shippingSettings = await getOrCreateShippingSettings(orgId);
            const shippingRequired = isShippingCheckoutRequired(shippingSettings);

            const user = await prisma.user.findUnique({
                where: { id: actor.sub },
                select: {
                    email: true,
                    phoneNumber: true,
                    firstName: true,
                    lastName: true,
                },
            });
            const fallbackName = [user?.firstName, user?.lastName]
                .filter(Boolean)
                .join(" ")
                .trim();

            const structuredAddress =
                resolveDestinationSnapshot(
                    body.shippingAddress ?? undefined,
                    user?.phoneNumber,
                    fallbackName
                ) ??
                (typeof body.address === "object" && body.address
                    ? resolveDestinationSnapshot(
                          body.address as ProfileShippingAddress,
                          user?.phoneNumber,
                          fallbackName
                      )
                    : null);

            const destinationForRates =
                structuredAddress &&
                structuredAddress.line1 &&
                structuredAddress.city &&
                structuredAddress.state &&
                structuredAddress.phone
                    ? structuredAddress
                    : null;

            let address =
                typeof body.address === "string" ? body.address.trim() : "";
            // Structured snapshot is SSOT when present — keep legacy address string in sync.
            if (structuredAddress) {
                address = formatShippingAddressLine(structuredAddress);
            }
            if (!address) {
                return badRequest("Delivery address is required");
            }

            let shippingFee = 0;
            let shippingMethodJson: Awaited<
                ReturnType<typeof resolveShippingSelectionForOrder>
            >["shippingMethod"] | null = null;

            const selection = body.shippingSelection;
            const hasSelection =
                Boolean(selection) &&
                typeof selection === "object" &&
                !Array.isArray(selection);

            if (shippingRequired && !destinationForRates) {
                return badRequest(
                    "A complete delivery address with phone is required for shipping"
                );
            }

            if (shippingRequired && !hasSelection) {
                return badRequest(
                    "SHIPPING_REQUIRED: A delivery method is required. Please select a shipping rate at checkout."
                );
            }

            // Ignore leftover client selection when live shipping is not configured
            // (avoids hard-fail on stale quoteSession after rates were turned off).
            if (hasSelection && selection && shippingRequired) {
                if (!destinationForRates) {
                    return badRequest(
                        "A complete delivery address with phone is required when selecting shipping"
                    );
                }
                const quoteSessionId = String(selection.quoteSessionId ?? "").trim();
                const optionId = String(selection.optionId ?? "").trim();
                const serviceCode = selection.serviceCode
                    ? String(selection.serviceCode).trim()
                    : "";
                if (!quoteSessionId || !optionId) {
                    return badRequest(
                        "Shipping selection is incomplete. Please choose a delivery method."
                    );
                }
                // Bound string sizes — prevent oversized payloads to quote/provider APIs.
                if (
                    quoteSessionId.length > 128 ||
                    optionId.length > 128 ||
                    serviceCode.length > 128
                ) {
                    return badRequest("Invalid shipping selection");
                }
                const rawFee =
                    selection.fee !== undefined && selection.fee !== null
                        ? Number(selection.fee)
                        : undefined;
                const fee =
                    rawFee !== undefined && Number.isFinite(rawFee)
                        ? rawFee
                        : undefined;
                const validated = await resolveShippingSelectionForOrder({
                    selection: {
                        quoteSessionId,
                        optionId,
                        fee,
                        serviceCode: serviceCode || undefined,
                        provider: selection.provider
                            ? String(selection.provider).slice(0, 64)
                            : undefined,
                        courierName: selection.courierName
                            ? String(selection.courierName).slice(0, 128)
                            : undefined,
                    },
                    userId: actor.sub,
                    orgId,
                    cart,
                    destination: destinationForRates,
                    recipientEmail: user?.email,
                });
                shippingFee = validated.shippingFee;
                shippingMethodJson = validated.shippingMethod;
            }

            const totals = await calculateOrderTotals(cart, shippingFee);
            if (totals.total <= 0) {
                return badRequest("Order total must be greater than zero");
            }
            if (
                !orderMoneyComponentsMatchTotal({
                    amount: totals.total,
                    subtotal: totals.subtotal,
                    taxAmount: totals.taxAmount,
                    shippingFee: totals.shipping,
                })
            ) {
                return serverError("Order totals failed consistency check");
            }

            // Keep shippingMethod.fee aligned with Order.shippingFee (same rounded value).
            if (shippingMethodJson) {
                shippingMethodJson = {
                    ...shippingMethodJson,
                    fee: totals.shipping,
                };
            }

            const { resolveOrderVenueLocationIdFromCart } = await import(
                "@/lib/orderParkStamp"
            );
            const venueLocationId = await resolveOrderVenueLocationIdFromCart(
                cart._id
            );

            const newOrder = await prisma.order.create({
                data: {
                    userId: actor.sub,
                    orgId,
                    venueLocationId,
                    walletId: wallet._id,
                    cartId: cart._id,
                    subtotal: totals.subtotal,
                    taxAmount: totals.taxAmount,
                    taxRate: totals.effectiveRate,
                    taxLabel: totals.label,
                    shippingFee: totals.shipping,
                    shippingMethod: shippingMethodJson ?? undefined,
                    shippingAddress: structuredAddress ?? undefined,
                    amount: totals.total,
                    address,
                },
            });

            logActivityEntry({
                actorSub: actor.sub,
                orgId: newOrder.orgId ?? null,
                action: "Placed Order",
                entityType: "Order",
                entityId: String(newOrder.id),
                description: `User placed order #${newOrder.id} worth $${totals.total}`,
                metadata: {
                    totalAmount: totals.total,
                    subtotal: totals.subtotal,
                    taxAmount: totals.taxAmount,
                    taxRate: totals.effectiveRate,
                    shippingFee: totals.shipping,
                    itemCount: getCartItemCount(cart),
                    shippingProvider: shippingMethodJson?.provider ?? null,
                },
            });

            return created(serializeOrder(newOrder));
        });
    } catch (error) {
        if (error instanceof ShippingRateExpiredError) {
            return conflict(`SHIPPING_RATE_EXPIRED: ${error.message}`);
        }
        if (isShippingError(error)) {
            return badRequest(error.message);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (
            message.includes("Cart") ||
            message.includes("stock") ||
            message.includes("available") ||
            message.includes("empty")
        ) {
            return badRequest(message);
        }
        if (isTransientMongoError(error)) {
            return serverError(
                "Database temporarily unavailable while creating your order. Please wait a moment and try again."
            );
        }
        return serverError("Failed to create order: " + message);
    }
}
