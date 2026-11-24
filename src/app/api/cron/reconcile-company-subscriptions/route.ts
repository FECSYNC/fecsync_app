import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { runReconcileCompanySubscriptions } from "@/lib/reconcileCompanySubscriptions";
import { runBookingExpiryMaintenance } from "@/lib/ticketing/expireHolds";
import { runPartyMaintenance } from "@/lib/parties/maintenance";
import { runAccountingMaintenanceSafe } from "@/lib/accounting/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly — expire overdue company subscriptions.
 * Also runs expireBookingHolds() + expireBookingPaymentLinks(), party
 * maintenance, and accounting maintenance (wrapped so billing never fails).
 * Do not add a third Vercel cron entry.
 */
export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;

  try {
    await connectDB();
    const summary = await runReconcileCompanySubscriptions();
    // Sibling hold expiry must not fail company billing if ticketing throws.
    const { bookingHolds, paymentLinks } = await runBookingExpiryMaintenance();
    const parties = await runPartyMaintenance();
    const accounting = await runAccountingMaintenanceSafe();
    return ok({ summary, bookingHolds, paymentLinks, parties, accounting });
  } catch (err) {
    console.error("[cron] reconcile-company-subscriptions:", err);
    return (
      authErrorToResponse(err) ??
      serverError("Failed to reconcile company subscriptions")
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
