import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { runAccountingMaintenance } from "@/lib/accounting/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Optional external scheduler for accounting maintenance.
 * Hourly reconcile-company-subscriptions already chains this as a safe sibling —
 * do not add a third vercel.json cron entry.
 */
export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;

  try {
    await connectDB();
    const summary = await runAccountingMaintenance();
    return ok({ summary });
  } catch (err) {
    console.error("[cron] accounting-maintenance:", err);
    return (
      authErrorToResponse(err) ?? serverError("Failed to run accounting maintenance")
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
