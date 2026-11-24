import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { runPartyMaintenance } from "@/lib/parties/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Party maintenance for external schedulers (CRON_SECRET bearer). Vercel runs
 * the same job from reconcile-company-subscriptions — no extra vercel.json cron.
 */
export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;
  try {
    await connectDB();
    return ok({ parties: await runPartyMaintenance() });
  } catch (err) {
    console.error("[cron] parties-maintenance:", err);
    return authErrorToResponse(err) ?? serverError("Failed to run party maintenance");
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
