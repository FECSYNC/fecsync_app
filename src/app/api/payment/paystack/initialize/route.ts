export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import {
  ok,
  badRequest,
  serverError,
  notFound,
  authErrorToResponse,
} from "@/lib/response";
import { requireAuthActiveAccount, assertCheckoutMethod } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { isPlainObject } from "@/lib/catalogWrite";
import { initializePayment2 } from "@/lib/paystack";
import { getUserFromUserid } from "@/lib/utils";
import { isValidId } from "@/lib/ids";

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requireAuthActiveAccount(request);
    assertCheckoutMethod("paystack", "api");
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const raw = isPlainObject(body.metadata) ? body.metadata : {};
  const orderId = typeof raw.orderId === "string" ? raw.orderId.trim() : "";
  if (!orderId || !isValidId(orderId)) {
    return notFound("Order not found");
  }

  try {
    await connectDB();
    const userDetails = await getUserFromUserid(actor.sub);
    if (!userDetails) {
      return notFound("User not found");
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, ...prismaOwnedByFilter(actor) },
    });
    if (!order) {
      return notFound("Order not found");
    }
    if (order.status !== "pending" && order.status !== "initiated") {
      return badRequest("Order already processed");
    }
    const amount = Number(order.amount);
    if (!amount || amount <= 0) {
      return badRequest("Order amount is invalid");
    }

    const paymentInit = await initializePayment2(actor.email, amount, {
      items: [],
      type: "order",
      amount,
      uuid: userDetails.uuid,
      orderId,
      orgId: order.orgId,
    });

    return ok({
      success: true,
      message: "Payment initialized",
      data: paymentInit,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Failed to initialize payment:", error);
    return serverError("Failed to initialize payment: " + error);
  }
}
