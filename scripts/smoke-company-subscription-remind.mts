/**
 * Step 3 — remind windows + invite TTL smoke.
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
process.env.COMPANY_BILLING_NOTICE_ENABLED = "true";

function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const prisma = (await import("../src/lib/prisma.ts")).default;
  const stamp = Date.now();
  const { runCompanySubscriptionReminders } = await import(
    "../src/lib/companySubscriptionRemind.ts"
  );
  const {
    expireOverdueMembershipInvites,
    membershipInviteExpiresAt,
    isMembershipInviteExpired,
    MEMBERSHIP_INVITE_EXPIRED_MESSAGE,
  } = await import("../src/lib/membershipInvites.ts");
  const { getPlanUsageSnapshot } = await import("../src/lib/planLimits.ts");

  const endsIn7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const org = await prisma.organization.create({
    data: {
      name: `Remind Co ${stamp}`,
      slug: `remind-co-${stamp}`,
      status: "active",
      isDefault: false,
      subscriptionStatus: "active",
      subscriptionPlan: "starter",
      subscriptionEndsAt: endsIn7d,
      stripeSubscriptionId: `sub_remind_${stamp}`,
    },
  });

  const inviteUser = await prisma.user.create({
    data: {
      email: `invite-ttl-${stamp}@test.local`,
      password: "x",
      role: "client",
      username: `invite_ttl_${stamp}`,
    },
  });

  const invited = await prisma.membership.create({
    data: {
      userId: inviteUser.id,
      orgId: org.id,
      rolePreset: "catalog_editor",
      status: "invited",
      inviteExpiresAt: new Date(Date.now() - 60_000),
    },
  });

  try {
    check(
      "invite-expired-helper",
      isMembershipInviteExpired({
        status: "invited",
        inviteExpiresAt: invited.inviteExpiresAt,
      })
    );
    check(
      "legacy-invite-null-fresh-not-expired",
      isMembershipInviteExpired({
        status: "invited",
        inviteExpiresAt: null,
        createdAt: new Date(),
      }) === false
    );
    check(
      "legacy-invite-null-old-expired",
      isMembershipInviteExpired({
        status: "invited",
        inviteExpiresAt: null,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      }) === true
    );

    const beforeSnap = await getPlanUsageSnapshot(org.id);
    const membersBefore =
      beforeSnap.meters.find((m) => m.resource === "members")?.used ?? 0;

    const { expired } = await expireOverdueMembershipInvites({
      orgId: org.id,
    });
    check("expire-overdue-invites", expired >= 1);

    const afterInvite = await prisma.membership.findUnique({
      where: { id: invited.id },
    });
    check("invite-revoked", afterInvite?.status === "revoked");

    const afterSnap = await getPlanUsageSnapshot(org.id);
    const membersAfter =
      afterSnap.meters.find((m) => m.resource === "members")?.used ?? 0;
    check(
      "invite-ttl-frees-seat",
      membersAfter === membersBefore - 1,
      `before=${membersBefore} after=${membersAfter}`
    );
    check(
      "usage-has-overLimitResources",
      Array.isArray(afterSnap.overLimitResources)
    );

    const future = membershipInviteExpiresAt();
    check("invite-ttl-future", future.getTime() > Date.now());

    const summary = await runCompanySubscriptionReminders();
    check(
      "remind-ran",
      summary.scanned >= 0 && summary.errors === 0,
      JSON.stringify(summary)
    );

    // Second run should watermark-skip the 7d for this org if it matched.
    const again = await runCompanySubscriptionReminders();
    check("remind-idempotent-no-errors", again.errors === 0);

    check(
      "invite-expired-message",
      MEMBERSHIP_INVITE_EXPIRED_MESSAGE.includes("expired")
    );
  } finally {
    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: inviteUser.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  if (process.exitCode) {
    console.error("company-subscription-remind smoke failed");
    process.exit(1);
  }
  console.log("\nAll company-subscription-remind smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
