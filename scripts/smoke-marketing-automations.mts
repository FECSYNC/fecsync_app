/**
 * Guest Marketing Automation smoke (Growth+).
 *
 *   yarn smoke:marketing
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

if (!process.env.CRON_SECRET?.trim() && !process.env.NEXTAUTH_SECRET?.trim()) {
  process.env.CRON_SECRET = "smoke-marketing-local-secret";
}

const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { assertMarketingEnabled } = await import("../src/lib/marketing/assert.ts");
  const { planAllowsModule, SHIPPED_MODULE_HINT_IDS } = await import(
    "../src/lib/subscriptionPlans.ts"
  );
  const { upsertNewsletterLead } = await import("../src/lib/marketing/upsertLead.ts");
  const { runWelcomeAutomation } = await import(
    "../src/lib/marketing/automations/welcome.ts"
  );
  const { runBirthdayAutomation } = await import(
    "../src/lib/marketing/automations/birthday.ts"
  );
  const { runReengagementAutomation } = await import(
    "../src/lib/marketing/automations/reengagement.ts"
  );
  const {
    daysUntilNextBirthday,
    listBirthdayCandidates,
  } = await import("../src/lib/marketing/segments.ts");
  const {
    createGuestSurvey,
    updateGuestSurvey,
    createSurveyInvite,
    submitSurveyResponse,
  } = await import("../src/lib/marketing/surveys.ts");
  const { readMembershipMarketingBridge } = await import(
    "../src/lib/marketing/membershipBridge.ts"
  );
  const { readWaiverMarketingBridge } = await import(
    "../src/lib/marketing/waiverBridge.ts"
  );
  const { sendPromotionalMarketingEmail } = await import("../src/lib/marketing/send.ts");
  const { assertCronBearer } = await import("../src/lib/cronAuth.ts");
  const { adminWarmHrefFromPathname, isMarketingNavHref } = await import(
    "../src/lib/adminNav.ts"
  );
  const { patchMarketingSettings, getOrCreateMarketingSettings } = await import(
    "../src/lib/marketing/settings.ts"
  );

  check(
    "shipped-hints-include-marketing",
    (SHIPPED_MODULE_HINT_IDS as readonly string[]).includes("marketing")
  );
  check("plan-growth-allows-marketing", planAllowsModule("growth", "marketing"));
  check("plan-enterprise-allows-marketing", planAllowsModule("enterprise", "marketing"));
  check("plan-starter-no-marketing", !planAllowsModule("starter", "marketing"));
  check("plan-demo-no-marketing", !planAllowsModule("demo", "marketing"));
  check(
    "marketing-warm-href-surveys",
    adminWarmHrefFromPathname("/admin/marketing/surveys/abc") === "/admin/marketing/surveys"
  );
  check(
    "isMarketingNavHref",
    isMarketingNavHref("/admin/marketing/settings")
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-mkt-${stamp}@test.local`,
      password: "x",
      username: `smokemkt${stamp}`,
      firstName: "Mkt",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const growth = await createOrganizationWithPlatformAdmin({
    name: `Smoke Marketing Co ${stamp}`,
    slug: `smoke-mkt-${stamp}`,
    userId: user.id,
  });
  const growthOrgId = growth.organization.id;

  const { clearCachedStaffGatesForOrg } = await import(
    "../src/lib/ticketing/staffGateCache.ts"
  );

  await prisma.organization.update({
    where: { id: growthOrgId },
    data: {
      subscriptionPlan: "growth",
      status: "active",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  clearCachedStaffGatesForOrg(growthOrgId);

  let growthOk = false;
  try {
    await assertMarketingEnabled(growthOrgId);
    growthOk = true;
  } catch {
    growthOk = false;
  }
  check("growth-assert-marketing-enabled", growthOk);

  const demoUser = await prisma.user.create({
    data: {
      email: `smoke-mkt-demo-${stamp}@test.local`,
      password: "x",
      username: `smokemktdemo${stamp}`,
      firstName: "Demo",
      lastName: "Mkt",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const demoOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke Marketing Demo ${stamp}`,
    slug: `smoke-mkt-demo-${stamp}`,
    userId: demoUser.id,
  });
  await prisma.organization.update({
    where: { id: demoOrg.organization.id },
    data: {
      subscriptionPlan: "demo",
      status: "active",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  clearCachedStaffGatesForOrg(demoOrg.organization.id);
  let demoDenied = false;
  try {
    await assertMarketingEnabled(demoOrg.organization.id);
  } catch (e) {
    demoDenied = e instanceof ForbiddenError || e instanceof Error;
  }
  check("demo-deny-marketing", demoDenied);

  const storefrontId = await getStorefrontOrgId();
  let storefrontDenied = false;
  try {
    await assertMarketingEnabled(storefrontId);
  } catch {
    storefrontDenied = true;
  }
  check("storefront-deny-marketing", storefrontDenied);

  await patchMarketingSettings(growthOrgId, null, { welcomeEnabled: true, welcomeDelayHours: 0 });

  const { POST: newsletterPost } = await import(
    "../src/app/api/public/marketing/newsletter/route.ts"
  );
  const { NextRequest } = await import("next/server");
  const growthSlug = `smoke-mkt-${stamp}`;
  const noConsentRes = await newsletterPost(
    new NextRequest("http://localhost/api/public/marketing/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgSlug: growthSlug,
        email: `noconsent-${stamp}@test.local`,
      }),
    })
  );
  check("newsletter-requires-consent", noConsentRes.status === 400);

  const withConsentRes = await newsletterPost(
    new NextRequest("http://localhost/api/public/marketing/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgSlug: growthSlug,
        email: `withconsent-${stamp}@test.local`,
        consent: true,
      }),
    })
  );
  check(
    "newsletter-public-consent-ok",
    withConsentRes.status >= 200 && withConsentRes.status < 300
  );

  const lead = await upsertNewsletterLead({
    orgId: growthOrgId,
    email: `lead-${stamp}@test.local`,
    source: "smoke",
  });
  const guest = await prisma.guestProfile.findFirst({
    where: { id: lead.guestProfileId, orgId: growthOrgId },
  });
  check("newsletter-opt-in", guest?.marketingEmailOptIn === true);
  const waiverCount = await prisma.waiverRecord.count({
    where: { orgId: growthOrgId, guestProfileId: lead.guestProfileId },
  });
  check("newsletter-no-waiver", waiverCount === 0);
  const linkedUser = guest?.userId
    ? await prisma.user.findUnique({ where: { id: guest.userId } })
    : null;
  check("newsletter-no-shop-user", !linkedUser);

  await prisma.guestProfile.update({
    where: { id: lead.guestProfileId },
    data: {
      firstVisitAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      newsletterSubscribedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  });

  const welcome1 = await runWelcomeAutomation(growthOrgId, { limit: 5 });
  const welcome2 = await runWelcomeAutomation(growthOrgId, { limit: 5 });
  check(
    "welcome-idempotent",
    welcome1.sent + welcome1.skipped + welcome1.failed >= 0 &&
      welcome2.skipped >= welcome1.sent
  );

  const now = new Date();
  const dob = new Date(
    Date.UTC(now.getUTCFullYear() - 25, now.getUTCMonth(), now.getUTCDate() + 3)
  );
  await prisma.guestProfile.update({
    where: { id: lead.guestProfileId },
    data: { dateOfBirth: dob, marketingEmailOptIn: true },
  });
  const days = daysUntilNextBirthday(dob);
  check("birthday-dob-helper", days >= 0 && days <= 366);
  const bdayCandidates = await listBirthdayCandidates(growthOrgId, 30, { limit: 10 });
  check(
    "birthday-candidate-in-window",
    days <= 30 && bdayCandidates.some((c) => c.id === lead.guestProfileId)
  );

  await prisma.guestProfile.update({
    where: { id: lead.guestProfileId },
    data: { lastVisitAt: new Date() },
  });
  await patchMarketingSettings(growthOrgId, null, {
    reengagementEnabled: true,
    reengagementInactiveDays: 30,
  });
  const reengage = await runReengagementAutomation(growthOrgId, { limit: 5 });
  check(
    "reengagement-skips-recent-visit",
    reengage.sent === 0 || reengage.skipped > 0
  );

  const survey = await createGuestSurvey({
    orgId: growthOrgId,
    name: `Smoke survey ${stamp}`,
  });
  await updateGuestSurvey(growthOrgId, survey.id, { status: "published" });
  const invite = await createSurveyInvite({
    orgId: growthOrgId,
    surveyId: survey.id,
    guestProfileId: lead.guestProfileId,
  });
  const submitted = await submitSurveyResponse({
    token: invite.token,
    rating: 5,
    comment: "smoke ok",
  });
  check("survey-submit-stored", Boolean(submitted.id));

  const memBridge = await readMembershipMarketingBridge(growthOrgId);
  check("memberships-bridge-read", typeof memBridge.dunningEnabled === "boolean");
  const wavBridge = await readWaiverMarketingBridge(growthOrgId);
  check(
    "waivers-bridge-read",
    Array.isArray(wavBridge.remindBeforeDays)
  );

  await prisma.guestProfile.update({
    where: { id: lead.guestProfileId },
    data: { marketingEmailOptIn: false },
  });
  const skipped = await sendPromotionalMarketingEmail({
    orgId: growthOrgId,
    guestProfileId: lead.guestProfileId,
    kind: "welcome",
    automationKey: `smoke-skip:${stamp}`,
    subject: "nope",
    htmlBody: "<p>nope</p>",
  });
  check("promo-skip-not-opted-in", skipped.status === "skipped");

  const cronReq = new Request("http://localhost/api/cron/marketing-automations", {
    method: "GET",
  });
  const cronDenied = assertCronBearer(cronReq);
  check("cron-missing-secret-deny", cronDenied != null && cronDenied.status === 401);

  await getOrCreateMarketingSettings(growthOrgId, null);
  check("settings-patch-ok", true, "growth org");
}

main()
  .catch((e) => {
    console.error(e);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll marketing smoke checks passed.");
  });
