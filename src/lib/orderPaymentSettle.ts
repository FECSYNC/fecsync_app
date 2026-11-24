/**
 * Shared gateway order settlement for Stripe confirm + Paystack callback.
 */

import type { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  addFunds,
  deductFunds,
  getTransactionByReference,
  isWalletHelperResponse,
} from "@/lib/wallet";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import {
  serializeOrder,
  type SerializedOrder,
} from "@/lib/commerceSerialize";
import {
  completeOrderFulfillment,
  loadCartForCheckout,
} from "@/lib/orderFulfillment";
import { notifyOrderPaid } from "@/lib/mailer";
import { getOrderDisplayLines } from "@/utils/orderCartLines";
import { notifyStaffOfPaidOrder } from "@/lib/notifyStaffOrderPaid";
import { queueAccountingSync } from "@/lib/accounting/postingQueue";

export type GatewayPaymentProvider = "stripe" | "paystack";

export type IOrder = SerializedOrder;

export type SettleCustomer = {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

export type SettleOrderGatewayPaymentInput = {
  orderId: string;
  user: SettleCustomer;
  chargedAmount: number;
  paymentReference: string;
  provider: GatewayPaymentProvider;
};

export type SettleOrderGatewayPaymentResult =
  | {
      ok: true;
      order: IOrder;
      alreadyProcessed: boolean;
      fulfillmentError?: string;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "amount_mismatch"
        | "invalid_status"
        | "wallet_error"
        | "missing_reference";
      message: string;
      response?: NextResponse;
    };

export function amountsMatch(
  charged: number,
  expected: number,
  toleranceCents = 1
): boolean {
  const a = Math.round(Number(charged) * 100);
  const b = Math.round(Number(expected) * 100);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= toleranceCents;
}

function walletCreditRef(provider: string, paymentReference: string) {
  return `gw:${provider}:${paymentReference}:in`;
}

function walletDebitRef(provider: string, paymentReference: string) {
  return `gw:${provider}:${paymentReference}:out`;
}

async function ensureWalletCredit(params: {
  userId: string;
  amount: number;
  reference: string;
  description: string;
}): Promise<NextResponse | null> {
  const existing = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (existing) return null;

  const credited = await addFunds({
    amount: params.amount,
    userId: params.userId,
    reference: params.reference,
    description: params.description,
  });
  if (!isWalletHelperResponse(credited)) return null;

  const again = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (again) return null;
  return credited;
}

async function ensureWalletDebit(params: {
  userId: string;
  amount: number;
  reference: string;
  description: string;
}): Promise<NextResponse | null> {
  const existing = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (existing) return null;

  const deducted = await deductFunds({
    amount: params.amount,
    userId: params.userId,
    reference: params.reference,
    description: params.description,
  });
  if (!isWalletHelperResponse(deducted)) return null;

  const again = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (again) return null;
  return deducted;
}

export async function ensurePaidNotification(
  order: IOrder,
  user: SettleCustomer
): Promise<void> {
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    undefined;

  await notifyStaffOfPaidOrder({
    orderId: String(order._id),
    orgId: order.orgId ? String(order.orgId) : null,
    amount: order.amount,
    customerLabel: fullName || user.email || "Customer",
  });

  const claimed = await prisma.order.updateMany({
    where: {
      id: order._id,
      userId: user._id,
      paidNotifiedAt: null,
    },
    data: { paidNotifiedAt: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    let items: {
      name: string;
      quantity: number;
      imageUrl?: string;
      unitLabel?: string;
    }[] = [];
    try {
      const cartId =
        typeof order.carts === "object" && order.carts && "_id" in order.carts
          ? String(order.carts._id)
          : String(order.cartId ?? order.carts ?? "");
      const cart = await loadCartForCheckout(cartId, String(user._id));
      items = getOrderDisplayLines(cart).map((line) => ({
        name: line.name,
        quantity: line.quantity,
        imageUrl: line.imageUrl,
        unitLabel: line.unitLabel,
      }));
    } catch (cartError) {
      console.warn(
        "Could not load cart for order paid email; sending without line items:",
        cartError
      );
    }

    await notifyOrderPaid({
      customerEmail: user.email,
      customerName: fullName,
      orderId: String(order._id),
      amount: order.amount,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      taxLabel: order.taxLabel,
      shippingFee: order.shippingFee,
      hasShippingMethod: Boolean(order.shippingMethod),
      items,
      orgId: order.orgId ? String(order.orgId) : null,
    });
  } catch (emailError) {
    console.error("Failed to send order paid emails:", emailError);
    await prisma.order.updateMany({
      where: { id: order._id, userId: user._id },
      data: { paidNotifiedAt: null },
    });
  }
}

async function fulfillPaidOrderSafely(
  orderId: string,
  userId: string
): Promise<string | undefined> {
  try {
    await completeOrderFulfillment(orderId, userId);
    return undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[settleOrderGatewayPayment] fulfillment failed order=${orderId}:`,
      err
    );
    return message;
  }
}

/** Auto-book after paid email — never throws; never rolls back payment. */
async function autoBookAfterPaidSafely(orderId: string): Promise<void> {
  try {
    const { maybeAutoBookShipmentAfterPayment } = await import(
      "@/lib/shipping/booking"
    );
    await maybeAutoBookShipmentAfterPayment(orderId);
  } catch (bookErr) {
    console.error(
      `[settleOrderGatewayPayment] auto-book failed order=${orderId}:`,
      bookErr
    );
  }
}

/** Alert ops when fulfill fails so auto-book is intentionally skipped. */
async function notifyStaffAutoBookSkipped(
  orderId: string,
  reason: string
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orgId: true },
    });
    if (!order?.orgId) return;
    const { createNotification } = await import(
      "@/services/notificationService"
    );
    const { P } = await import("@/lib/auth/permissions");
    const {
      effectiveMembershipPermissions,
      templatePermissionsForMembership,
    } = await import("@/lib/membership");

    const members = await prisma.membership.findMany({
      where: { orgId: order.orgId, status: "active" },
      select: {
        userId: true,
        orgId: true,
        rolePreset: true,
        roleTemplateId: true,
        permissionsOverride: true,
      },
    });
    const short = orderId.slice(-8);
    await Promise.allSettled(
      members.map(async (member) => {
        const templatePermissions = await templatePermissionsForMembership({
          orgId: member.orgId,
          roleTemplateId: member.roleTemplateId,
        });
        const permissions = effectiveMembershipPermissions({
          rolePreset: String(member.rolePreset ?? ""),
          permissionsOverride: member.permissionsOverride,
          templatePermissions,
        });
        if (
          !permissions.includes(P.DeliveriesRead) &&
          !permissions.includes(P.DeliveriesManage) &&
          !permissions.includes(P.OrdersRead)
        ) {
          return;
        }
        await createNotification(
          member.userId,
          "Auto-book skipped — fulfill failed",
          `Order #${short}: ${reason.slice(0, 180)}. Fix fulfillment, then book from Deliveries.`,
          "system",
          { orderId }
        );
      })
    );
  } catch (err) {
    console.error(
      `[settleOrder] auto-book-skip notify failed order=${orderId}:`,
      err
    );
  }
}

/**
 * Statuses that mean payment already succeeded.
 * Phase 3 auto-book may advance paid → shipping before Stripe retries;
 * those must stay idempotent success (never invalid_status).
 */
const PAYMENT_SETTLED_STATUSES = new Set([
  "paid",
  "shipping",
  "shipped",
  "delivered",
]);

async function settleIfAlreadyPaid(
  orderId: string,
  userId: string,
  user: SettleCustomer,
  current: IOrder
): Promise<SettleOrderGatewayPaymentResult | null> {
  if (!PAYMENT_SETTLED_STATUSES.has(current.status)) return null;

  // Recovery path: ensure accounting outbox has the paid event (idempotent unique key).
  if (current.orgId) {
    await queueAccountingSync({
      orgId: current.orgId,
      locationId: current.venueLocationId ?? null,
      sourceType: "shop_order",
      sourceId: current.id ?? orderId,
      sourceEvent: "paid",
    });
  }

  // Fulfill may still be pending if auto-book or admin status raced ahead
  // of inventory/cart clear. completeOrderFulfillment is idempotent on fulfilledAt.
  let fulfillmentError: string | undefined;
  fulfillmentError = await fulfillPaidOrderSafely(orderId, userId);

  const mid = (await loadOwnedOrder(orderId, userId)) ?? current;
  await ensurePaidNotification(mid, user);

  // Auto-book only after inventory/cart fulfill succeeds. Booking without
  // fulfill risks oversell (live courier label while stock/cart uncleared).
  if (current.status === "paid" && !fulfillmentError) {
    await autoBookAfterPaidSafely(orderId);
  } else if (current.status === "paid" && fulfillmentError) {
    await notifyStaffAutoBookSkipped(orderId, fulfillmentError);
  }

  const refreshed = await loadOwnedOrder(orderId, userId);
  return {
    ok: true,
    order: refreshed ?? mid,
    alreadyProcessed: true,
    fulfillmentError,
  };
}

async function loadOwnedOrder(orderId: string, userId: string) {
  const row = await prisma.order.findFirst({
    where: { id: orderId, ...prismaOwnedByFilter({ sub: userId }) },
    include: {
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  return row ? serializeOrder(row) : null;
}

export async function settleOrderGatewayPayment(
  input: SettleOrderGatewayPaymentInput
): Promise<SettleOrderGatewayPaymentResult> {
  const { orderId, user, chargedAmount, paymentReference, provider } = input;
  const userId = String(user._id);

  if (!paymentReference) {
    return {
      ok: false,
      code: "missing_reference",
      message: "Missing payment reference",
    };
  }

  const order = await loadOwnedOrder(orderId, userId);
  if (!order) {
    return { ok: false, code: "not_found", message: "Order not found" };
  }

  const early = await settleIfAlreadyPaid(orderId, userId, user, order);
  if (early) return early;

  if (order.status !== "pending" && order.status !== "initiated") {
    return {
      ok: false,
      code: "invalid_status",
      message: `Order cannot be settled from status "${order.status}"`,
    };
  }

  if (!amountsMatch(chargedAmount, order.amount)) {
    console.error(
      `[settleOrderGatewayPayment] amount mismatch order=${orderId} charged=${chargedAmount} expected=${order.amount} provider=${provider}`
    );
    return {
      ok: false,
      code: "amount_mismatch",
      message: `Charged amount (${chargedAmount}) does not match order total (${order.amount})`,
    };
  }

  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      userId,
      status: { in: ["pending", "initiated"] },
      OR: [
        { paymentReference: null },
        { paymentReference },
      ],
    },
    data: {
      paymentReference,
      paymentProvider: provider,
      status: "initiated",
    },
  });

  if (claimed.count === 0) {
    const current = await loadOwnedOrder(orderId, userId);
    if (!current) {
      return { ok: false, code: "not_found", message: "Order not found" };
    }
    const claimedEarly = await settleIfAlreadyPaid(
      orderId,
      userId,
      user,
      current
    );
    if (claimedEarly) return claimedEarly;
    if (
      current.paymentReference &&
      current.paymentReference !== paymentReference
    ) {
      return {
        ok: false,
        code: "invalid_status",
        message: "Order is already tied to a different payment",
      };
    }
  }

  const working = (await loadOwnedOrder(orderId, userId))!;
  if (!working) {
    return { ok: false, code: "not_found", message: "Order not found" };
  }

  const workingEarly = await settleIfAlreadyPaid(
    orderId,
    userId,
    user,
    working
  );
  if (workingEarly) return workingEarly;

  const creditRef = walletCreditRef(provider, paymentReference);
  const debitRef = walletDebitRef(provider, paymentReference);

  const creditErr = await ensureWalletCredit({
    userId,
    amount: Number(working.amount),
    reference: creditRef,
    description: `${provider} payment credit`,
  });
  if (creditErr) {
    return {
      ok: false,
      code: "wallet_error",
      message: "Failed to credit wallet for gateway payment",
      response: creditErr,
    };
  }

  const debitErr = await ensureWalletDebit({
    userId,
    amount: Number(working.amount),
    reference: debitRef,
    description: `${provider} payment settlement`,
  });
  if (debitErr) {
    return {
      ok: false,
      code: "wallet_error",
      message: "Failed to debit wallet for order settlement",
      response: debitErr,
    };
  }

  const paidUpdate = await prisma.order.updateMany({
    where: {
      id: orderId,
      userId,
      status: { in: ["pending", "initiated"] },
    },
    data: {
      status: "paid",
      paymentReference,
      paymentProvider: provider,
    },
  });

  if (paidUpdate.count === 0) {
    const current = await loadOwnedOrder(orderId, userId);
    if (!current) {
      return { ok: false, code: "not_found", message: "Order not found" };
    }
    // Peer settle may already have paid + auto-booked → shipping/shipped/delivered.
    const raced = await settleIfAlreadyPaid(orderId, userId, user, current);
    if (raced) return raced;
    return {
      ok: false,
      code: "invalid_status",
      message: "Failed to mark order as paid",
    };
  }

  const finalOrder = await loadOwnedOrder(orderId, userId);
  if (!finalOrder || finalOrder.status !== "paid") {
    const current = finalOrder ?? (await loadOwnedOrder(orderId, userId));
    if (current) {
      const raced = await settleIfAlreadyPaid(orderId, userId, user, current);
      if (raced) return raced;
    }
    return {
      ok: false,
      code: "invalid_status",
      message: "Failed to mark order as paid",
    };
  }

  const alreadyProcessed = false;
  if (finalOrder.orgId) {
    await queueAccountingSync({
      orgId: finalOrder.orgId,
      locationId: finalOrder.venueLocationId ?? null,
      sourceType: "shop_order",
      sourceId: finalOrder.id,
      sourceEvent: "paid",
    });
  }
  const fulfillmentError = await fulfillPaidOrderSafely(orderId, userId);
  // Paid email before auto-book so customers are not notified of shipping first.
  await ensurePaidNotification(finalOrder, user);
  if (!fulfillmentError) {
    await autoBookAfterPaidSafely(orderId);
  } else {
    await notifyStaffAutoBookSkipped(orderId, fulfillmentError);
  }
  // Reload after fulfill + auto-book (status may be shipping; shipment populated).
  const refreshed = await loadOwnedOrder(orderId, userId);
  const settledOrder = refreshed ?? finalOrder;

  return {
    ok: true,
    order: settledOrder,
    alreadyProcessed,
    fulfillmentError,
  };
}

export async function settleOrderWalletPayment(input: {
  orderId: string;
  userId: string;
  user: SettleCustomer;
}): Promise<SettleOrderGatewayPaymentResult> {
  const { orderId, userId, user } = input;
  const paymentReference = `wallet:${orderId}`;

  const order = await loadOwnedOrder(orderId, String(userId));
  if (!order) {
    return { ok: false, code: "not_found", message: "Order not found" };
  }

  const early = await settleIfAlreadyPaid(
    orderId,
    String(userId),
    user,
    order
  );
  if (early) return early;

  if (order.status !== "pending" && order.status !== "initiated") {
    return {
      ok: false,
      code: "invalid_status",
      message: `Order cannot be settled from status "${order.status}"`,
    };
  }

  await prisma.order.updateMany({
    where: {
      id: orderId,
      userId: String(userId),
      status: { in: ["pending", "initiated"] },
      OR: [{ paymentReference: null }, { paymentReference }],
    },
    data: {
      status: "initiated",
      paymentReference,
      paymentProvider: "wallet",
    },
  });

  const working = await loadOwnedOrder(orderId, String(userId));
  if (!working) {
    return { ok: false, code: "not_found", message: "Order not found" };
  }
  const workingEarly = await settleIfAlreadyPaid(
    orderId,
    String(userId),
    user,
    working
  );
  if (workingEarly) return workingEarly;

  if (
    working.paymentReference &&
    working.paymentReference !== paymentReference
  ) {
    return {
      ok: false,
      code: "invalid_status",
      message: "Order is already tied to a different payment",
    };
  }

  const debitErr = await ensureWalletDebit({
    userId: String(userId),
    amount: Number(working.amount),
    reference: walletDebitRef("wallet", paymentReference),
    description: "Wallet order payment",
  });
  if (debitErr) {
    return {
      ok: false,
      code: "wallet_error",
      message: "Failed to debit wallet for order payment",
      response: debitErr,
    };
  }

  const paidUpdate = await prisma.order.updateMany({
    where: {
      id: orderId,
      userId: String(userId),
      status: { in: ["pending", "initiated"] },
    },
    data: {
      status: "paid",
      paymentReference,
      paymentProvider: "wallet",
    },
  });

  if (paidUpdate.count === 0) {
    const current = await loadOwnedOrder(orderId, String(userId));
    if (!current) {
      return { ok: false, code: "not_found", message: "Order not found" };
    }
    const raced = await settleIfAlreadyPaid(
      orderId,
      String(userId),
      user,
      current
    );
    if (raced) return raced;
    return {
      ok: false,
      code: "invalid_status",
      message: "Failed to mark order as paid",
    };
  }

  const finalOrder = await loadOwnedOrder(orderId, String(userId));
  if (!finalOrder || finalOrder.status !== "paid") {
    const current = finalOrder ?? (await loadOwnedOrder(orderId, String(userId)));
    if (current) {
      const raced = await settleIfAlreadyPaid(
        orderId,
        String(userId),
        user,
        current
      );
      if (raced) return raced;
    }
    return {
      ok: false,
      code: "invalid_status",
      message: "Failed to mark order as paid",
    };
  }

  if (finalOrder.orgId) {
    await queueAccountingSync({
      orgId: finalOrder.orgId,
      locationId: finalOrder.venueLocationId ?? null,
      sourceType: "shop_order",
      sourceId: finalOrder.id,
      sourceEvent: "paid",
    });
  }
  const fulfillmentError = await fulfillPaidOrderSafely(orderId, userId);
  await ensurePaidNotification(finalOrder, user);
  if (!fulfillmentError) {
    await autoBookAfterPaidSafely(orderId);
  } else {
    await notifyStaffAutoBookSkipped(orderId, fulfillmentError);
  }
  const refreshed = await loadOwnedOrder(orderId, String(userId));
  const settledOrder = refreshed ?? finalOrder;

  return {
    ok: true,
    order: settledOrder,
    alreadyProcessed: false,
    fulfillmentError,
  };
}
