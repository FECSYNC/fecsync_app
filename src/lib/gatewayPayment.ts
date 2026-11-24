import prisma from "@/lib/prisma";
import { createCheckoutSession } from "@/lib/stripe";
import { initializePayment2 } from "@/lib/paystack";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import {
  buildPaymentLineItems,
  loadCartForCheckout,
  validateCartForOrder,
} from "@/lib/orderFulfillment";

type GatewayType = "stripe-gateway" | "paystack-gateway";

export async function initiateGatewayPayment({
  userId,
  orderId,
  email,
  uuid,
  gateway,
}: {
  userId: string;
  orderId: string;
  email: string;
  uuid: string;
  gateway: GatewayType;
}) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...prismaOwnedByFilter({ sub: userId }) },
    select: {
      id: true,
      amount: true,
      status: true,
      cartId: true,
      userId: true,
      orgId: true,
    },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.status !== "pending" && order.status !== "initiated") {
    throw new Error("Order already processed");
  }

  if (order.status === "pending") {
    const updated = await prisma.order.updateMany({
      where: { id: orderId, userId, status: "pending" },
      data: { status: "initiated" },
    });

    if (updated.count === 0) {
      const current = await prisma.order.findFirst({
        where: { id: orderId, userId },
        select: { status: true },
      });
      if (current?.status !== "initiated") {
        throw new Error("Order already processed");
      }
    }
  }

  if (gateway === "stripe-gateway") {
    const session = await createCheckoutSession({
      amount: order.amount,
      email,
      successUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout`,
      metadata: {
        orderId: order.id,
        uuid,
        amount: order.amount,
        type: "order",
      },
    });

    return session;
  }

  const cart = await loadCartForCheckout(order.cartId, userId);
  const items = buildPaymentLineItems(cart);

  return initializePayment2(email, order.amount, {
    items,
    type: "order",
    amount: order.amount,
    uuid,
    orderId: order.id,
    orgId: order.orgId,
  });
}

export async function initiateGatewayPaymentWithValidation({
  userId,
  orderId,
  email,
  uuid,
  gateway,
}: {
  userId: string;
  orderId: string;
  email: string;
  uuid: string;
  gateway: GatewayType;
}) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...prismaOwnedByFilter({ sub: userId }) },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.status !== "pending" && order.status !== "initiated") {
    throw new Error("Order already processed");
  }

  const cart = await loadCartForCheckout(order.cartId, userId);
  await validateCartForOrder(cart);
  const items = buildPaymentLineItems(cart);

  if (order.status === "pending") {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "initiated" },
    });
  }

  if (gateway === "stripe-gateway") {
    return createCheckoutSession({
      amount: order.amount,
      email,
      successUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout`,
      metadata: {
        orderId: order.id,
        uuid,
        amount: order.amount,
        type: "order",
      },
    });
  }

  return initializePayment2(email, order.amount, {
    items,
    type: "order",
    amount: order.amount,
    uuid,
    orderId: order.id,
    orgId: order.orgId,
  });
}
