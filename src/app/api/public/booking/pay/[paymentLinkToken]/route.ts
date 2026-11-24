export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getPaymentLinkByToken, payViaPaymentLink } from "@/lib/ticketing/paymentLinks";
type Ctx = { params: Promise<{ paymentLinkToken: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-pay-get", 30, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const { paymentLinkToken } = await ctx.params;
    return ok({ link: await getPaymentLinkByToken(paymentLinkToken) });
  } catch (err) { return bookingRouteCatch(err, request, "GET pay link", null, "Failed"); }
}
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-pay-post", 20, 60_000);
  if (limited) return limited;
  let body: any = {};
  try { const t = await request.text(); if (t) body = JSON.parse(t); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    const { paymentLinkToken } = await ctx.params;
    const result = await payViaPaymentLink(paymentLinkToken, { amount: body.amount != null ? Number(body.amount) : undefined });
    return ok(result);
  } catch (err) { return bookingRouteCatch(err, request, "POST pay link", null, "Failed"); }
}
