export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
import {
  cancelTailoringPayment,
  cancelTailoringPaymentBySession,
} from "@/lib/tailoringJobPayment";

/**
 * POST /api/payment/tailoring/cancel
 * Body: { jobId } with auth, or { sessionId } from Stripe cancel URL (no auth).
 * Reverts payment_pending → quoted when checkout is abandoned.
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

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

  try {
    await connectDB();

    if (sessionId) {
      const result = await cancelTailoringPaymentBySession(sessionId);
      return ok(result, result.reverted ? "Payment cancelled" : "No change");
    }

    if (!jobId) return badRequest("jobId or sessionId is required");

    let user;
    try {
      user = await requireAuthActiveAccount(request);
    } catch (err) {
      return authErrorToResponse(err) ?? unauthorized("Unauthorized");
    }

    const result = await cancelTailoringPayment({
      jobId,
      customerId: user.sub,
    });
    return ok(result, result.reverted ? "Payment cancelled" : "No change");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Job not found") return notFound(message);
    if (message === "Forbidden") return forbidden(message);
    if (
      message === "Not a tailoring checkout session" ||
      message === "Invalid checkout session metadata" ||
      message === "Checkout session user not found" ||
      message === "sessionId is required"
    ) {
      return badRequest(message);
    }
    console.error("[payment/tailoring/cancel]", err);
    return serverError(message || "Failed to cancel payment");
  }
}
