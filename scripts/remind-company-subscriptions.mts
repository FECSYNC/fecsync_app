import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

/**
 * Mirrors GET /api/cron/remind-company-subscriptions:
 * daily 14/7/3/1 reminds + overdue membership invite expiry (Hobby 2-cron parity).
 */
async function main() {
  const { runCompanySubscriptionReminders } = await import(
    "../src/lib/companySubscriptionRemind.ts"
  );
  const { expireOverdueMembershipInvites } = await import(
    "../src/lib/membershipInvites.ts"
  );
  const prisma = (await import("../src/lib/prisma.ts")).default;
  try {
    let remindErrors = 0;
    let inviteOk = true;
    try {
      const remind = await runCompanySubscriptionReminders();
      console.log("[remind] summary", remind);
      remindErrors = remind.errors;
    } catch (err) {
      console.error("[remind] remind phase failed:", err);
      remindErrors = 1;
    }
    try {
      const invites = await expireOverdueMembershipInvites();
      console.log("[remind] invites", invites);
    } catch (err) {
      console.error("[remind] invite expire phase failed:", err);
      inviteOk = false;
    }
    if (remindErrors > 0 || !inviteOk) process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[remind] fatal:", err);
  process.exit(1);
});
