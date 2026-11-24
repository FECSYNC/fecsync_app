export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  serverError,
  unauthorized,
  notFound,
  forbidden,
  authErrorToResponse,
} from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { getUserFromUserid } from "@/lib/utils";
import { initiateTailoringStripePayment } from "@/lib/tailoringJobPayment";

/**
 * POST /api/payment/tailoring
 * Body: { jobId, type: "stripe-gateway" }
 * Owner-only; job must be quoted (or payment_pending retry) with quotedPrice > 0.
 */
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

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";

  if (!jobId) return badRequest("jobId is required");
  if (type !== "stripe-gateway") {
    return badRequest('type must be "stripe-gateway"');
  }

  try {
    await connectDB();
    const userDetails = await getUserFromUserid(user.sub);
    if (!userDetails) {
      return notFound("User not found");
    }
    const email = String(userDetails.email ?? "");
    const uuid = String(userDetails.uuid ?? "");
    if (!email || !uuid) {
      return badRequest("User email/uuid required for checkout");
    }

    const session = await initiateTailoringStripePayment({
      jobId,
      customerId: user.sub,
      email,
      uuid,
    });

    return ok(
      {
        sessionId: session.sessionId,
        url: session.url,
        amount: session.amount,
        taxAmount: session.taxAmount,
        currency: session.currency,
        jobId: session.jobId,
      },
      "Checkout session created"
    );
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Job not found") return notFound(message);
    if (message === "Forbidden") return forbidden(message);
    if (
      message.includes("quotedPrice") ||
      message.includes("already paid") ||
      message.includes("cannot be paid")
    ) {
      return badRequest(message);
    }
    console.error("[payment/tailoring]", err);
    return serverError(message || "Failed to start payment");
  }
}
