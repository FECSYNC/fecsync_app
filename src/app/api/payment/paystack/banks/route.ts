export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { getPaystackBanks } from "@/lib/paystack";
import { requireAuth } from "@/lib/middleware/requireAuth";

/*
 * Step 4.4 — unused by UI; was unauthenticated. requireAuth only
 * (staff lack wallet:transact_own). Not a checkout-method switch.
 */
export async function GET(request: NextRequest) {
  try {
    requireAuth(request);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    await connectDB();
    const banks = await getPaystackBanks();
    return ok({ banks });
  } catch (error) {
    console.error("Failed to fetch banks:", error);
    return serverError("Failed to fetch banks");
  }
}
