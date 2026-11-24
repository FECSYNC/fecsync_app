/**
 * Company SaaS subscription expiry reconcile CLI.
 *
 * Logic lives in `src/lib/reconcileCompanySubscriptions.ts` so Step 3 cron
 * routes can call the same function without drift. Also runs booking hold /
 * payment-link expiry (same sibling as the HTTP cron route).
 *
 *   yarn reconcile:subscriptions
 *   npx tsx scripts/reconcile-company-subscriptions.mts
 *
 * Cron recommendation: hourly (see README). Safe to run locally.
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

async function main() {
  const { runReconcileCompanySubscriptions } = await import(
    "../src/lib/reconcileCompanySubscriptions.ts"
  );
  const { runBookingExpiryMaintenance } = await import(
    "../src/lib/ticketing/expireHolds.ts"
  );
  const { runPartyMaintenance } = await import("../src/lib/parties/maintenance.ts");
  const { runAccountingMaintenanceSafe } = await import(
    "../src/lib/accounting/maintenance.ts"
  );
  const prisma = (await import("../src/lib/prisma.ts")).default;

  try {
    const summary = await runReconcileCompanySubscriptions();
    console.log(
      `[reconcile] done candidates=${summary.candidates} refreshed=${summary.refreshed} expired=${summary.expired} clearedBindings=${summary.clearedBindings} skipped=${summary.skipped} errors=${summary.errors}`
    );
    const { bookingHolds, paymentLinks } = await runBookingExpiryMaintenance();
    console.log(
      `[reconcile] bookingHolds=${JSON.stringify(bookingHolds)} paymentLinks=${JSON.stringify(paymentLinks)}`
    );
    const parties = await runPartyMaintenance();
    console.log(`[reconcile] parties=${JSON.stringify(parties)}`);
    const accounting = await runAccountingMaintenanceSafe();
    console.log(`[reconcile] accounting=${JSON.stringify(accounting)}`);
    if (summary.errors > 0) {
      process.exitCode = 1;
    }
    if ("error" in bookingHolds || "error" in paymentLinks) {
      process.exitCode = 1;
    }
    if (Object.values(parties).some((p) => "error" in p)) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[reconcile] fatal:", err);
  process.exitCode = 1;
});
