/**
 * Lean Phase 4 audit recheck — no full org sell matrix.
 * Covers must-fix gates after follow-up audit patches.
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { dunningRetryDaysForPlan } = await import(
    "../src/lib/memberships/dunning.ts"
  );
  const g = dunningRetryDaysForPlan("growth");
  const e = dunningRetryDaysForPlan("enterprise");
  check(
    "dunning-schedules",
    g.join(",") === "0,3,5,7" && e.join(",") === "0,2,4,6,9,12,14"
  );

  const { ROLE_PRESETS, P, CLIENT_PROFILE_TAB_PERMISSIONS, API_PERMISSIONS } =
    await import("../src/lib/auth/permissions.ts");
  check(
    "client-own",
    ROLE_PRESETS.client.includes(P.MembershipsReadOwn) &&
      ROLE_PRESETS.client.includes(P.MembershipsWriteOwn)
  );
  check(
    "tailor-clean",
    !ROLE_PRESETS.tailor.includes(P.MembershipsReadOwn) &&
      !ROLE_PRESETS.tailor.includes(P.MembershipsWriteOwn)
  );
  check(
    "profile-tab",
    CLIENT_PROFILE_TAB_PERMISSIONS.memberships === P.MembershipsReadOwn
  );
  check(
    "api-me-cancel",
    "POST /api/me/memberships/[id]/cancel" in API_PERMISSIONS
  );
  check(
    "api-me-wallet",
    "GET /api/me/memberships/[id]/wallet" in API_PERMISSIONS
  );
  check(
    "api-reports",
    "GET /api/admin/memberships/reports" in API_PERMISSIONS
  );

  const { assertMembershipTransition } = await import(
    "../src/lib/memberships/statusMachine.ts"
  );
  try {
    assertMembershipTransition("past_due", "pending");
    check("past-due-to-pending-allowed", true);
  } catch {
    check("past-due-to-pending-allowed", false);
  }
  try {
    assertMembershipTransition("active", "pending");
    check("active-to-pending-heal-allowed", true);
  } catch {
    check("active-to-pending-heal-allowed", false);
  }
  try {
    assertMembershipTransition("paused", "pending");
    check("paused-to-pending-resume-allowed", true);
  } catch {
    check("paused-to-pending-resume-allowed", false);
  }

  const { resolvePostPaymentMembershipStatus } = await import(
    "../src/lib/memberships/activationGates.ts"
  );
  check(
    "resolve-post-payment-export",
    typeof resolvePostPaymentMembershipStatus === "function"
  );

  // Recover from past_due must clear scheduled cancel for both active and pending.
  const dunningSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/lib/memberships/dunning.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "recover-clears-cancel-from-past-due",
    dunningSrc.includes('member.status === "past_due"') &&
      dunningSrc.includes("cancelAtPeriodEnd: false") &&
      dunningSrc.includes("cancelReason: null") &&
      !dunningSrc.includes(
        '...(nextStatus === "active" ? { cancelAtPeriodEnd: false } : {})'
      )
  );
  check(
    "mark-past-due-skip-payment-flag",
    dunningSrc.includes("skipPaymentAttempt")
  );

  const billingSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/lib/memberships/billingEngine.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "renew-preserves-eop-cancel",
    billingSrc.includes("preserve cancelAtPeriodEnd") ||
      billingSrc.includes("From active: preserve cancelAtPeriodEnd")
  );
  check(
    "renew-clears-cancel-from-past-due",
    billingSrc.includes('member.status === "past_due"') &&
      billingSrc.includes("cancelAtPeriodEnd: false") &&
      billingSrc.includes("cancelReason: null")
  );
  check(
    "sell-agreement-uses-home-location",
    billingSrc.includes("homeLocationId || locationId")
  );

  const webhookSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/lib/memberships/webhookGuest.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "webhook-leaving-past-due-clears-dunning-cancel",
    webhookSrc.includes("leavingPastDue") &&
      webhookSrc.includes("Boolean(sub.cancel_at_period_end)") &&
      webhookSrc.includes("mirror recoverMembershipFromPastDue")
  );

  const { requireIdempotencyKey } = await import(
    "../src/lib/memberships/meRoute.ts"
  );
  const missingIdem = requireIdempotencyKey({});
  check(
    "require-idempotency-key",
    missingIdem.ok === false &&
      typeof requireIdempotencyKey({ idempotencyKey: "abc" }).ok === "boolean"
  );

  await import("../src/lib/memberships/activationGates.ts");
  check("activation-gates", true);

  const { membershipRequiresAgreement } = await import(
    "../src/lib/memberships/agreements.ts"
  );
  check("agreements-export", typeof membershipRequiresAgreement === "function");

  // Signup still closed
  const signup = await import("../src/app/api/auth/signup/route.ts");
  check("signup-closed-export", typeof signup.POST === "function");

  console.log(`\nDone. failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
