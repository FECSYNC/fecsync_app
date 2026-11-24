export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  serverError,
  notFound,
  forbidden,
} from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { getCheckoutSession } from "@/lib/stripe";
import { getUserFromUuid } from "@/lib/utils";
import { settleTailoringJobGatewayPayment } from "@/lib/tailoringJobPaymentSettle";

/**
 * GET /api/payment/tailoring/confirm?session_id=…
 * Idempotent settlement for Stripe Checkout (browser success page).
 * Returns a minimal receipt — not full job PII (measurements, email).
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");

  if (!sessionId) {
    return badRequest("Missing session_id");
  }

  try {
    await connectDB();
    const session = await getCheckoutSession(sessionId);
    const metadata = (session.metadata || {}) as Record<
      string,
      string | undefined
    >;

    if (session.payment_status !== "paid") {
      return badRequest("Payment not successful");
    }

    const { type, uuid, jobId, reference } = metadata;
    if (type !== "tailoring") {
      return badRequest("Not a tailoring checkout session");
    }
    if (!uuid) {
      return badRequest("Missing user UUID in payment metadata");
    }
    if (!jobId) {
      return badRequest("Missing jobId in payment metadata");
    }

    const user = await getUserFromUuid(uuid);
    if (!user?.id) {
      return badRequest("Missing user from payment metadata");
    }

    let actorSub: string | null = null;
    try {
      actorSub = (await requireAuthActiveAccount(req)).sub;
    } catch {
      /* optional — Stripe return may precede cookie refresh */
    }
    if (actorSub && String(user.id) !== actorSub) {
      return forbidden("Checkout session does not match signed-in user");
    }

    const chargedAmount = (session.amount_total || 0) / 100;
    const settled = await settleTailoringJobGatewayPayment({
      jobId: String(jobId),
      user: {
        _id: String(user.id),
        email: String(user.email ?? ""),
        firstName:
          typeof (user as { firstName?: unknown }).firstName === "string"
            ? (user as { firstName: string }).firstName
            : undefined,
        lastName:
          typeof (user as { lastName?: unknown }).lastName === "string"
            ? (user as { lastName: string }).lastName
            : undefined,
        username:
          typeof (user as { username?: unknown }).username === "string"
            ? (user as { username: string }).username
            : undefined,
      },
      chargedAmount,
      paymentReference: String(reference || session.id),
      provider: "stripe",
    });

    if (!settled.ok) {
      if (settled.response) return settled.response;
      if (settled.code === "not_found") return notFound(settled.message);
      return badRequest(settled.message);
    }

    const job = settled.job;

    return ok(
      {
        job: {
          _id: job.id,
          title: job.title,
          amount: job.amount ?? chargedAmount,
          currency: job.currency,
          paymentReference: job.paymentReference,
        },
        jobId: job.id,
        alreadyProcessed: settled.alreadyProcessed,
        paymentReference: job.paymentReference,
        amount: job.amount ?? chargedAmount,
        currency: job.currency,
      },
      settled.alreadyProcessed
        ? "Payment already processed"
        : "Payment processed successfully"
    );
  } catch (err) {
    console.error("[payment/tailoring/confirm]", err);
    return serverError(err ? String(err) : "Failed to confirm payment");
  }
}
