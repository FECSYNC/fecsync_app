import { createCheckoutSession } from "@/lib/stripe";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { requireAuthActiveAccount, assertCheckoutMethod } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { isPlainObject } from "@/lib/catalogWrite";
import { getUserFromUserid } from "@/lib/utils";
import { isValidId } from "@/lib/ids";
import {
  authErrorToResponse,
  badRequest,
  notFound,
  serverError,
} from "@/lib/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthActiveAccount(req);
    assertCheckoutMethod("stripe", "api");
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId || !isValidId(orderId)) {
    return notFound("Order not found");
  }

  try {
    await connectDB();
    const userDetails = await getUserFromUserid(actor.sub);
    if (!userDetails) {
      return notFound("User not found");
    }
    const uuid = userDetails.uuid;

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

    const session = await createCheckoutSession({
      amount,
      email: actor.email,
      successUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout`,
      metadata: {
        type: "order",
        amount,
        uuid,
        orderId,
      },
    });

    return Response.json({ id: session.id, url: session.url });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Stripe create-session error:", err);
    return badRequest("Failed to create checkout session");
  }
}
