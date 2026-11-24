export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { ok, notFound, badRequest, serverError, authErrorToResponse, authAudit } from "@/lib/response";
import { requireAuthFresh, requireAuthActiveAccount, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { ownsResource, type NormalizedAccessToken } from "@/lib/auth/claims";
import {
  assertNoOrderFinancialMutation,
  assertOrderStatusChangeAllowed,
} from "@/lib/auth/resourcePolicy";
import { isMongoObjectId } from "@/lib/orderFulfillment";
import { loadOrderDetail } from "@/lib/orderList";
import { sendOrderStatusEmail } from "@/lib/mailer";
import { getOrderDisplayLines } from "@/utils/orderCartLines";
import {
    actorOrgFilter,
    assertActorOrgMatch,
    requireActorOrgId,
} from "@/lib/staffOrg";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
    cartLinesInclude,
    prismaOwnedByFilter,
    serializeOrder,
} from "@/lib/commerceSerialize";
import { parseShippingAddressJson } from "@/lib/shipping/address";
import { getUserFromUserid } from "@/lib/utils";
import { assertOrganizationActive } from "@/lib/org";

const ORDER_STATUSES = [
    "pending",
    "initiated",
    "paid",
    "shipped",
    "shipping",
    "delivered",
    "cancelled",
] as const;

function isOrderStatus(value: string): value is (typeof ORDER_STATUSES)[number] {
    return (ORDER_STATUSES as readonly string[]).includes(value);
}

function orderWriteWhere(
    actor: {
        sub: string;
        orgId?: string | null;
        permissions?: Iterable<string> | null;
    },
    id: string,
    orderUserId?: string | null
) {
    if (orderUserId != null && ownsResource(actor, orderUserId)) {
        return { id, ...prismaOwnedByFilter(actor) };
    }
    if (hasPermission(actor.permissions, P.OrdersManage)) {
        return { id, ...actorOrgFilter(actor) };
    }
    return { id, ...prismaOwnedByFilter(actor) };
}

async function readActorFresh(
    request: NextRequest
): Promise<NormalizedAccessToken | NextResponse> {
    try {
        // Owner shopping must work when primary Membership is a suspended company.
        return await requireAuthFresh(request, { allowSuspendedOrg: true });
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }
}

async function readActorForGet(
    request: NextRequest
): Promise<NormalizedAccessToken | NextResponse> {
    try {
        const decoded = await requireAuthActiveAccount(request);
        const staffReader = hasPermission(decoded.permissions, P.OrdersRead);
        // Staff order detail must Fresh-load Membership (revoke / CWV / org change).
        // Customer owner path can keep cached JWT when they lack OrdersRead.
        if (staffReader) {
            return await requireAuthFresh(request, { allowSuspendedOrg: true });
        }
        return decoded;
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }
}

function isErrorResponse(
    value: NormalizedAccessToken | NextResponse
): value is NextResponse {
    return "headers" in value && "status" in value;
}

async function loadOwnedOrderMeta(
    actor: NormalizedAccessToken,
    id: string,
    allowPermissions: readonly (typeof P.OrdersRead | typeof P.OrdersManage)[]
) {
    if (!isMongoObjectId(id)) {
        return { error: notFound("Order not found") };
    }
    const existingOrder = await prisma.order.findUnique({
        where: { id },
        select: {
            userId: true,
            status: true,
            orgId: true,
            shippingAddress: true,
            venueLocationId: true,
        },
    });
    if (!existingOrder) {
        return { error: notFound("Order not found") };
    }
    try {
        assertOwnedDocument(actor, { user: existingOrder.userId }, allowPermissions);
    } catch (err) {
        return {
            error: authErrorToResponse(err) ?? serverError("Failed to authorize"),
        };
    }

    if (!ownsResource(actor, existingOrder.userId)) {
        try {
            if (actor.orgId) {
                await assertOrganizationActive(actor.orgId);
            }
            assertActorOrgMatch(
                requireActorOrgId(actor),
                existingOrder.orgId
            );
            const { resolveEffectiveParkScope } = await import(
                "@/lib/parkAdminScope"
            );
            const { ForbiddenError } = await import("@/lib/auth/http-error");
            const parkScope = await resolveEffectiveParkScope(actor);
            if (parkScope.parkLocked) {
                const venueId = existingOrder.venueLocationId;
                if (
                    !venueId ||
                    !parkScope.assignedLocationIds.includes(venueId)
                ) {
                    throw new ForbiddenError("Outside your park assignment");
                }
            }
        } catch (err) {
            return {
                error: authErrorToResponse(err) ?? serverError("Failed to authorize"),
            };
        }
    }

    return {
        existingOrder: {
            ...existingOrder,
            user: existingOrder.userId,
        },
    };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const actorOrRes = await readActorForGet(request);
    if (isErrorResponse(actorOrRes)) return actorOrRes;
    const actor = actorOrRes;

    const { id } = await params;
    await connectDB();

    try {
        const access = await loadOwnedOrderMeta(actor, id, [P.OrdersRead]);
        if ("error" in access) return access.error;

        const staffScoped = !ownsResource(actor, access.existingOrder.user);
        const includeOps =
            staffScoped &&
            hasPermission(actor.permissions, P.DeliveriesRead);
        const order = await loadOrderDetail(
            staffScoped
                ? { _id: id, orgId: actorOrgFilter(actor).orgId }
                : { _id: id },
            includeOps ? { includeShipmentOpsFields: true } : undefined
        );

        if (!order) {
            return notFound("Order not found");
        }

        if (staffScoped) {
            const { resolveEffectiveParkScope } = await import(
                "@/lib/parkAdminScope"
            );
            const { ForbiddenError } = await import("@/lib/auth/http-error");
            const parkScope = await resolveEffectiveParkScope(actor);
            if (parkScope.parkLocked) {
                const venueId =
                    typeof order.venueLocationId === "string"
                        ? order.venueLocationId
                        : null;
                if (
                    !venueId ||
                    !parkScope.assignedLocationIds.includes(venueId)
                ) {
                    throw new ForbiddenError("Outside your park assignment");
                }
            }
        }

        return ok(order);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to fetch orders:", error);
        return badRequest("Failed to fetch orders");
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const actorOrRes = await readActorFresh(request);
    if (isErrorResponse(actorOrRes)) return actorOrRes;
    const actor = actorOrRes;

    const { id } = await params;
    await connectDB();
    let body: { address?: unknown; status?: unknown };
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }
    const orderAudit = authAudit(request, "PUT /api/order/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.OrdersManage,
    });
    try {
        assertNoOrderFinancialMutation(body as Record<string, unknown>);
    } catch (err) {
        const authRes = authErrorToResponse(err, orderAudit);
        if (authRes) return authRes;
        return badRequest(String(err));
    }
    try {
        const access = await loadOwnedOrderMeta(actor, id, [P.OrdersManage]);
        if ("error" in access) return access.error;
        const { existingOrder } = access;

        const previousStatus = existingOrder.status;
        const nextStatus = typeof body?.status === "string" ? body.status : previousStatus;
        // Manual status override is authoritative going forward: Shipbubble
        // webhooks only upgrade order status rank (paid→shipping→shipped→delivered)
        // and never downgrade a newer manual status (see statusSync.ts).
        try {
            assertOrderStatusChangeAllowed(actor, previousStatus, nextStatus);
        } catch (err) {
            return (
                authErrorToResponse(err, orderAudit) ??
                serverError("Failed to authorize")
            );
        }

        const updates: Record<string, unknown> = {};
        if (typeof body?.address === "string") {
            const address = body.address.trim();
            if (!address) {
                return badRequest("Delivery address is required");
            }
            // Once courier booking/progress started, keep address + snapshot aligned.
            // Pending/initiated/paid (incl. fee=0 snapshot orders) may still correct
            // the legacy address string — pre-shipping admin/customer behavior.
            const statusLocked =
                existingOrder.status === "shipping" ||
                existingOrder.status === "shipped" ||
                existingOrder.status === "delivered";
            const liveShipment = statusLocked
                ? null
                : await prisma.shipment.findFirst({
                      where: {
                          orderId: id,
                          status: {
                              in: [
                                  "booked",
                                  "picked_up",
                                  "in_transit",
                                  "out_for_delivery",
                                  "delivered",
                              ],
                          },
                      },
                      select: { id: true },
                  });
            if (
                parseShippingAddressJson(existingOrder.shippingAddress) &&
                (statusLocked || liveShipment)
            ) {
                return badRequest(
                    "Delivery address is locked to the shipping snapshot for this order"
                );
            }
            updates.address = address;
        }
        const isStaffManage =
            hasPermission(actor.permissions, P.OrdersManage) &&
            !ownsResource(actor, existingOrder.user);

        if (typeof body?.status === "string") {
            if (!isOrderStatus(body.status)) {
                return badRequest("Invalid order status");
            }
            // Courier / shipment guards before mutating Order.status.
            if (
                isStaffManage &&
                body.status !== previousStatus &&
                (body.status === "cancelled" ||
                    body.status === "shipped" ||
                    body.status === "delivered")
            ) {
                const orderShip = await prisma.order.findUnique({
                    where: { id },
                    select: {
                        shippingMethod: true,
                        shippingFee: true,
                        shipments: {
                            orderBy: { createdAt: "desc" },
                            take: 5,
                        },
                    },
                });
                const { findActiveShipment } = await import(
                    "@/lib/shipping/consistency"
                );
                const { parseOrderShippingMethodJson } = await import(
                    "@/lib/shipping/address"
                );
                const method = parseOrderShippingMethodJson(
                    orderShip?.shippingMethod
                );
                const active = findActiveShipment(
                    orderShip?.shipments ?? [],
                    method?.provider
                );
                const shippingFee = Math.max(
                    0,
                    Number(orderShip?.shippingFee) || 0
                );
                const hasShipmentRows = (orderShip?.shipments?.length ?? 0) > 0;

                if (body.status === "cancelled") {
                    if (active?.status === "delivered") {
                        return badRequest(
                            "Cannot cancel an order that has a delivered shipment"
                        );
                    }
                    // Live courier cancel uses deliveries:manage inside align;
                    // without it, align still performs local cancel + reconcile alert.
                }

                if (
                    (body.status === "shipped" ||
                        body.status === "delivered") &&
                    (method || shippingFee > 0 || hasShipmentRows)
                ) {
                    const hasLiveProgress =
                        Boolean(
                            String(active?.providerShipmentId || "").trim()
                        ) &&
                        active != null &&
                        (active.status === "booked" ||
                            active.status === "picked_up" ||
                            active.status === "in_transit" ||
                            active.status === "out_for_delivery" ||
                            active.status === "delivered");
                    if (!hasLiveProgress) {
                        return badRequest(
                            "Book a courier shipment before marking this order shipped or delivered"
                        );
                    }
                }
            }
            updates.status = body.status;
        }

        if (isStaffManage && Object.keys(updates).length > 0) {
            const audit = await stampUpdate(actor.sub);
            Object.assign(updates, {
                updatedById: audit.updatedBy,
                updatedByName: audit.updatedByName,
            });
        }

        let writeWhere;
        try {
            writeWhere = orderWriteWhere(actor, id, existingOrder.user);
        } catch (err) {
            return authErrorToResponse(err, orderAudit) ?? serverError("Failed to authorize");
        }

        const updateResult = await prisma.order.updateMany({
            where: writeWhere,
            data: updates as never,
        });
        if (updateResult.count === 0) {
            return notFound("Order not found");
        }

        let shipmentAligned: {
            shipmentId: string | null;
            aligned: boolean;
            shipmentCancelled: boolean;
        } = { shipmentId: null, aligned: false, shipmentCancelled: false };

        if (
            isStaffManage &&
            previousStatus !== nextStatus &&
            typeof body?.status === "string"
        ) {
            try {
                const { alignShipmentWithManualOrderStatus } = await import(
                    "@/lib/shipping/statusSync"
                );
                shipmentAligned = await alignShipmentWithManualOrderStatus({
                    orderId: id,
                    nextOrderStatus: nextStatus as
                        | "pending"
                        | "initiated"
                        | "paid"
                        | "shipping"
                        | "shipped"
                        | "delivered"
                        | "cancelled",
                    allowCourierCancel: hasPermission(
                        actor.permissions,
                        P.DeliveriesManage
                    ),
                });
            } catch (alignErr) {
                const { isShippingError } = await import(
                    "@/lib/shipping/errors"
                );
                if (
                    isShippingError(alignErr) &&
                    alignErr.code === "cannot_cancel_delivered_shipment"
                ) {
                    await prisma.order.updateMany({
                        where: { id, status: "cancelled" },
                        data: {
                            status: previousStatus as
                                | "pending"
                                | "initiated"
                                | "paid"
                                | "shipping"
                                | "shipped"
                                | "delivered"
                                | "cancelled",
                        },
                    });
                    return badRequest(alignErr.message);
                }
                // Keep order↔shipment consistent when cancel/align fails after
                // the order row already moved to cancelled.
                if (
                    isShippingError(alignErr) &&
                    nextStatus === "cancelled" &&
                    (alignErr.code === "cancel_persist_failed" ||
                        alignErr.code === "cancel_failed" ||
                        alignErr.code === "cannot_cancel")
                ) {
                    await prisma.order.updateMany({
                        where: { id, status: "cancelled" },
                        data: {
                            status: previousStatus as
                                | "pending"
                                | "initiated"
                                | "paid"
                                | "shipping"
                                | "shipped"
                                | "delivered"
                                | "cancelled",
                        },
                    });
                    return badRequest(alignErr.message);
                }
                if (nextStatus === "cancelled") {
                    await prisma.order.updateMany({
                        where: { id, status: "cancelled" },
                        data: {
                            status: previousStatus as
                                | "pending"
                                | "initiated"
                                | "paid"
                                | "shipping"
                                | "shipped"
                                | "delivered"
                                | "cancelled",
                        },
                    });
                    console.error(
                        `[PUT /api/order] shipment align failed order=${id}:`,
                        alignErr
                    );
                    return serverError("Failed to align shipment with order cancel");
                }
                console.error(
                    `[PUT /api/order] shipment align failed order=${id}:`,
                    alignErr
                );
            }
        }

        const row = await prisma.order.findFirst({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        phoneNumber: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                cart: { include: cartLinesInclude },
                shipments: {
                    orderBy: { createdAt: "desc" },
                    take: 5,
                },
            },
        });
        if (!row) {
            return notFound("Order not found");
        }
        const updatedOrder = serializeOrder(
            {
                ...row,
                user: row.user ?? undefined,
                cart: row.cart ?? undefined,
            },
            undefined,
            isStaffManage &&
                hasPermission(actor.permissions, P.DeliveriesRead)
                ? { includeShipmentOpsFields: true }
                : undefined
        );

        if (
            previousStatus !== nextStatus &&
            (nextStatus === "cancelled" || nextStatus === "paid") &&
            row.orgId
        ) {
            const { queueAccountingSync } = await import(
                "@/lib/accounting/postingQueue"
            );
            await queueAccountingSync({
                orgId: row.orgId,
                locationId: row.venueLocationId ?? null,
                sourceType:
                    nextStatus === "cancelled" ? "shop_order_refund" : "shop_order",
                sourceId: row.id,
                sourceEvent: String(nextStatus),
            });
            if (
                nextStatus === "cancelled" &&
                row.fulfilledAt &&
                row.cartId &&
                row.userId
            ) {
                const { restockInventoryForOrder } = await import(
                    "@/lib/orderFulfillment"
                );
                await restockInventoryForOrder({
                    orderId: row.id,
                    orgId: row.orgId,
                    cartId: row.cartId,
                    userId: row.userId,
                }).catch((err) => {
                    console.error(
                        `[PUT /api/order] restock failed order=${id}:`,
                        err
                    );
                });
            }
        }

        if (isStaffManage && Object.keys(updates).length > 0) {
            logStaffActivityEntry(actor, {
                action: "Order Updated",
                entityType: "Order",
                entityId: updatedOrder._id,
                description:
                    typeof body?.status === "string"
                        ? `Updated order status to "${body.status}"`
                        : `Updated order ${id}`,
                request,
                metadata: {
                    previousStatus,
                    status: nextStatus,
                },
            });
        }

        if (
            previousStatus !== nextStatus &&
            typeof nextStatus === "string"
        ) {
            try {
                const user = await getUserFromUserid(String(existingOrder.user));
                if (user?.email) {
                    const fullName =
                        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
                        user.username ||
                        undefined;
                    const cartShape =
                        typeof updatedOrder.carts === "object"
                            ? updatedOrder.carts
                            : row.cart
                              ? { lines: row.cart.lines }
                              : null;
                    const items = getOrderDisplayLines(cartShape).map((line) => ({
                        name: line.name,
                        quantity: line.quantity,
                        imageUrl: line.imageUrl,
                        unitLabel: line.unitLabel,
                    }));
                    await sendOrderStatusEmail({
                        to: user.email,
                        customerName: fullName,
                        orderId: String(updatedOrder._id),
                        status: nextStatus,
                        items,
                        trackingUrl:
                            updatedOrder.shipment?.trackingUrl || undefined,
                        courierName:
                            updatedOrder.shipment?.courierName ||
                            updatedOrder.shippingMethod?.courierName ||
                            undefined,
                        trackingNumber:
                            updatedOrder.shipment?.trackingNumber || undefined,
                        orgId: existingOrder.orgId ?? null,
                    });
                }
            } catch (emailError) {
                console.error("Failed to send order status email:", emailError);
            }

            // Phase 4 S8: in-app for shipment progress. Skip "cancelled" when
            // cancelShipmentRecord already notified (order cancel → align path).
            const shipmentNotifyStatuses = new Set([
                "shipping",
                "shipped",
                "delivered",
            ]);
            const shipmentId =
                updatedOrder.shipment?.id || shipmentAligned.shipmentId;
            const userId = String(existingOrder.user || "").trim();
            if (
                shipmentNotifyStatuses.has(nextStatus) &&
                shipmentId &&
                userId
            ) {
                try {
                    const { notifyCustomerShipmentUpdate } = await import(
                        "@/lib/notifyShipmentStatus"
                    );
                    await notifyCustomerShipmentUpdate({
                        userId,
                        orderId: String(updatedOrder._id),
                        shipmentId,
                        status: nextStatus as
                            | "shipping"
                            | "shipped"
                            | "delivered",
                        trackingUrl:
                            updatedOrder.shipment?.trackingUrl || null,
                    });
                } catch (notifyError) {
                    console.error(
                        "Failed to send order status notification:",
                        notifyError
                    );
                }
            }
        }

        return ok(updatedOrder);
    } catch (error) {
        return badRequest("Invalid order data: " + error);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const actorOrRes = await readActorFresh(request);
    if (isErrorResponse(actorOrRes)) return actorOrRes;
    const actor = actorOrRes;

    const { id } = await params;
    await connectDB();
    try {
        const access = await loadOwnedOrderMeta(actor, id, [P.OrdersManage]);
        if ("error" in access) return access.error;
        const { existingOrder } = access;

        if (existingOrder.status !== "pending" && existingOrder.status !== "initiated") {
            return badRequest("Only pending or initiated orders can be cancelled");
        }

        let writeWhere;
        try {
            writeWhere = orderWriteWhere(actor, id, existingOrder.user);
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }

        const deleted = await prisma.order.deleteMany({ where: writeWhere });
        if (deleted.count === 0) {
            return notFound("Order not found");
        }
        logStaffActivityEntry(actor, {
            action: "Order Cancelled",
            entityType: "Order",
            entityId: id,
            description: "Cancelled pending/initiated order",
            request,
        });
        return ok({ deleted: true });
    } catch {
        return notFound("Order not found");
    }
}
