/**
 * Step 3 — company subscription notices SSOT smoke.
 * Disables real SMTP via COMPANY_BILLING_NOTICE_ENABLED=true but mailer may no-op on missing SMTP.
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
  const {
    clearCompanySubscriptionNoticeWatermarks,
    notifyCompanyPastDue,
    notifyCompanyExpired,
    notifyCompanyExpiringSoon,
    resolveCompanyBillingRecipients,
    companyBillingNoticesEnabled,
  } = await import("../src/lib/companySubscriptionNotices.ts");

  check("notices-enabled", companyBillingNoticesEnabled() === true);

  const user = await prisma.user.create({
    data: {
      email: `notice-admin-${stamp}@test.local`,
      password: "x",
      role: "admin",
      username: `notice_admin_${stamp}`,
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: `Notice Co ${stamp}`,
      slug: `notice-co-${stamp}`,
      status: "active",
      isDefault: false,
      subscriptionStatus: "past_due",
      subscriptionPlan: "starter",
      subscriptionEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.membership.create({
    data: {
      userId: user.id,
      orgId: org.id,
      rolePreset: "platform_admin",
      status: "active",
      companyWideView: true,
    },
  });

  try {
    const recipients = await resolveCompanyBillingRecipients(org.id);
    check(
      "recipients-platform-admin",
      recipients.length === 1 && recipients[0]!.email === user.email
    );

    const firstPastDue = await notifyCompanyPastDue(org.id);
    check("past-due-notice-first", firstPastDue === true);
    const againPastDue = await notifyCompanyPastDue(org.id);
    check("past-due-notice-watermarked", againPastDue === false);

    const graceNotif = await prisma.notification.findFirst({
      where: { userId: user.id, type: "alert" },
      orderBy: { createdAt: "desc" },
    });
    const graceMeta = graceNotif?.metadata as { href?: string; event?: string } | null;
    check(
      "past-due-grace-href-billing",
      graceMeta?.event === "past_due" && graceMeta?.href === "/admin/billing",
      graceMeta?.href || ""
    );

    const orgAfter = await prisma.organization.findUnique({
      where: { id: org.id },
    });
    check(
      "past-due-watermark-set",
      orgAfter?.subscriptionNoticePastDueAt != null
    );

    await clearCompanySubscriptionNoticeWatermarks(org.id);
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: "past_due",
        subscriptionEndsAt: null,
        subscriptionNoticePastDueAt: null,
      },
    });
    const softHoldPastDue = await notifyCompanyPastDue(org.id);
    check("past-due-soft-hold-notice", softHoldPastDue === true);
    const softNotif = await prisma.notification.findFirst({
      where: { userId: user.id, type: "alert" },
      orderBy: { createdAt: "desc" },
    });
    const softMeta = softNotif?.metadata as { href?: string } | null;
    check(
      "past-due-soft-hold-href-pending",
      softMeta?.href === "/company-pending",
      softMeta?.href || ""
    );

    await clearCompanySubscriptionNoticeWatermarks(org.id);
    const cleared = await prisma.organization.findUnique({
      where: { id: org.id },
    });
    check(
      "watermarks-cleared",
      cleared?.subscriptionNoticePastDueAt == null &&
        cleared?.subscriptionNoticeRemind7dAt == null
    );

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        status: "suspended",
        subscriptionStatus: "expired",
        subscriptionNoticeExpiredAt: null,
      },
    });
    const expiredSent = await notifyCompanyExpired(org.id);
    check("expired-notice-first", expiredSent === true);
    const expiredAgain = await notifyCompanyExpired(org.id);
    check("expired-notice-watermarked", expiredAgain === false);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        status: "active",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        subscriptionNoticeRemind7dAt: null,
        subscriptionNoticeExpiredAt: null,
      },
    });
    const remind = await notifyCompanyExpiringSoon(
      org.id,
      7,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    );
    check("expiring-7d-notice", remind === true);

    const notif = await prisma.notification.findFirst({
      where: { userId: user.id, type: "alert" },
      orderBy: { createdAt: "desc" },
    });
    const meta = notif?.metadata as { kind?: string; href?: string } | null;
    check(
      "in-app-notification-created",
      Boolean(notif) && meta?.kind === "company_billing",
      notif?.title || ""
    );
    check(
      "in-app-notification-href-is-path",
      typeof meta?.href === "string" &&
        meta.href.startsWith("/") &&
        !/^https?:\/\//i.test(meta.href),
      meta?.href || ""
    );
  } finally {
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  if (process.exitCode) {
    console.error("company-subscription-notices smoke failed");
    process.exit(1);
  }
  console.log("\nAll company-subscription-notices smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
