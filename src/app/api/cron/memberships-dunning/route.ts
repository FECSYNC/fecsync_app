export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { runMembershipsDunningTick } from "@/lib/memberships/dunning";

/**
 * Dedicated memberships dunning / expiry tick (CRON_SECRET).
 * Also piggybacked from remind-company-subscriptions — no 3rd Vercel cron.
 */
export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;

  try {
    await connectDB();
    const summary = await runMembershipsDunningTick();
    return ok({ summary });
  } catch (err) {
    console.error("[cron] memberships-dunning:", err);
    return (
      authErrorToResponse(err) ??
      serverError("Failed to run memberships dunning")
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
