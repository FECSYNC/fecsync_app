/**
 * Newsletter campaigns smoke (Growth+): composer render, audience, schedule math,
 * one-off + monthly delivery, double-send guard, park scope, Demo lock.
 *
 *   yarn smoke:marketing:campaigns
 *
 * SMTP env is cleared so no real email leaves the machine — deliveries are
 * recorded as failed(mail_transport), which still exercises the full pipeline.
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
delete process.env.NOTIFICATION_EMAIL_USER;
delete process.env.TEAM_EMAIL_USER;
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

async function expectThrow(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const cleanupOrgIds: string[] = [];
const cleanupUserIds: string[] = [];

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  const { nextMonthlyRun, zonedTimeToUtc } = await import(
    "../src/lib/marketing/campaigns/schedule.ts"
  );
  const { normalizeCampaignBlocks, renderCampaignBodyHtml, safeCampaignUrl } = await import(
    "../src/lib/marketing/campaigns/blocks.ts"
  );
  const {
    createMarketingCampaign,
    updateMarketingCampaign,
    applyMarketingCampaignAction,
    previewMarketingCampaign,
    getMarketingCampaign,
    listMarketingCampaigns,
    assertCampaignLocationAllowed,
    planNextMonthlyAfter,
  } = await import("../src/lib/marketing/campaigns/campaigns.ts");
  const { runDueMarketingCampaigns } = await import("../src/lib/marketing/campaigns/runner.ts");
  const { starterMonthlyBlocks } = await import("../src/lib/marketing/campaigns/types.ts");
  const { assertCronBearer } = await import("../src/lib/cronAuth.ts");

  // ── Pure: schedule math ────────────────────────────────────────────────────
  const lagos = nextMonthlyRun({
    after: new Date("2026-11-09T08:00:00Z"),
    dayOfMonth: 1,
    sendHour: 9,
    timezone: "Africa/Lagos",
  });
  check(
    "monthly-next-lagos",
    lagos.runAt.toISOString() === "2026-12-01T08:00:00.000Z" && lagos.windowKey === "2026-12",
    lagos.runAt.toISOString()
  );
  const sameMonth = nextMonthlyRun({
    after: new Date("2026-11-09T08:00:00Z"),
    dayOfMonth: 20,
    sendHour: 9,
    timezone: "UTC",
  });
  check("monthly-later-this-month", sameMonth.windowKey === "2026-11");
  const ny = zonedTimeToUtc(2027, 2, 15, 9, "America/New_York");
  check("dst-new-york-edt", ny.toISOString() === "2027-03-15T13:00:00.000Z", ny.toISOString());
  const decWrap = nextMonthlyRun({
    after: new Date("2026-12-28T12:00:00Z"),
    dayOfMonth: 5,
    sendHour: 9,
    timezone: "UTC",
  });
  check("monthly-year-wrap", decWrap.windowKey === "2027-01");
  const noRepeat = planNextMonthlyAfter(
    { dayOfMonth: 20, sendHour: 9, timezone: "UTC" },
    "2026-11",
    new Date("2026-11-09T10:00:00Z")
  );
  check("monthly-never-repeats-issue", noRepeat.windowKey === "2026-12", noRepeat.windowKey);

  // ── Pure: blocks sanitising ────────────────────────────────────────────────
  const blocks = normalizeCampaignBlocks([
    { type: "heading", text: "<script>alert(1)</script>" },
    { type: "text", text: "Hi {{guestFirstName}} [bad](javascript:alert(1)) [ok](https://x.test/a?b=1&c=2)" },
    { type: "button", label: "Go", url: "javascript:alert(1)" },
    { type: "nope", text: "dropped" },
    "junk",
  ]);
  check("blocks-drop-unknown", blocks.length === 3);
  const html = renderCampaignBodyHtml(blocks, {
    vars: {
      guestFirstName: "<b>Ann</b>",
      orgName: "Park",
      websiteUrl: "https://park.test",
      bookUrl: "https://park.test/book",
      monthName: "November",
    },
    events: [],
    footer: { orgName: "Park", address: "1 Main St", unsubscribeUrl: "https://u.test/x" },
  });
  check("render-escapes-script", !html.includes("<script>") && html.includes("&lt;script&gt;"));
  check("render-escapes-merge-value", !html.includes("<b>Ann</b>"));
  check("render-drops-js-link", !html.includes("javascript:"));
  check("render-keeps-https-link", html.includes('href="https://x.test/a?b=1&amp;c=2"'));
  check("render-footer-unsubscribe", html.includes("https://u.test/x") && html.includes("1 Main St"));
  // ── Rich text (TipTap-style JSON) ──────────────────────────────────────────
  const { sanitizeRichDoc, richDocFromPlainText } = await import(
    "../src/lib/marketing/campaigns/richText.ts"
  );
  const dirty = sanitizeRichDoc({
    type: "doc",
    content: [
      { type: "script", content: [{ type: "text", text: "alert(1)" }] },
      {
        type: "paragraph",
        attrs: { textAlign: "center", onclick: "x" },
        content: [
          { type: "text", text: "Bold", marks: [{ type: "bold" }, { type: "evil" }] },
          { type: "text", text: " red", marks: [{ type: "textStyle", attrs: { color: "red;background:url(x)" } }] },
          { type: "text", text: " gold", marks: [{ type: "textStyle", attrs: { color: "#A6892A" } }] },
          { type: "text", text: " bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
          { type: "mergeTag", attrs: { tag: "guestFirstName" } },
          { type: "mergeTag", attrs: { tag: "password" } },
        ],
      },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }],
      },
    ],
  });
  const dirtyJson = JSON.stringify(dirty);
  check("rich-drops-unknown-nodes", !dirtyJson.includes("script") && !dirtyJson.includes("onclick"));
  check("rich-drops-bad-color", !dirtyJson.includes("url(") && dirtyJson.includes("#a6892a"));
  check("rich-drops-js-link", !dirtyJson.includes("javascript"));
  check("rich-drops-unknown-merge-tag", !dirtyJson.includes("password"));
  const richHtml = renderCampaignBodyHtml([{ id: "r1", type: "text", doc: dirty }], {
    vars: {
      guestFirstName: "Ann",
      orgName: "Park",
      websiteUrl: "https://park.test",
      bookUrl: "https://park.test/book",
      monthName: "November",
    },
    events: [],
    footer: { orgName: "Park", address: null, unsubscribeUrl: "https://u.test/x" },
  });
  check(
    "rich-renders-formatting",
    richHtml.includes("<strong>Bold</strong>") &&
      richHtml.includes("color:#a6892a") &&
      richHtml.includes("text-align:center") &&
      richHtml.includes("<ul") &&
      richHtml.includes("Ann")
  );
  const legacy = normalizeCampaignBlocks([{ id: "old1", type: "text", text: "Hi {{guestFirstName}}\n\n**Big** news" }]);
  check(
    "rich-upgrades-legacy-text",
    legacy[0]?.type === "text" &&
      JSON.stringify(legacy[0].doc).includes('"mergeTag"') &&
      JSON.stringify(legacy[0].doc).includes('"bold"')
  );
  const plain = richDocFromPlainText("[Book](https://x.test) now");
  check("rich-plain-link", JSON.stringify(plain).includes('"href":"https://x.test"'));

  check("safe-url-relative", safeCampaignUrl("/book/x").endsWith("/book/x"));
  check("safe-url-protocol-relative-denied", safeCampaignUrl("//evil.test") === "");

  // ── DB: Growth org + guests ────────────────────────────────────────────────
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-camp-${stamp}@test.local`,
      password: "x",
      username: `smokecamp${stamp}`,
      firstName: "Camp",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  cleanupUserIds.push(user.id);
  const growth = await createOrganizationWithPlatformAdmin({
    name: `Smoke Campaigns Co ${stamp}`,
    slug: `smoke-camp-${stamp}`,
    userId: user.id,
  });
  const orgId = growth.organization.id;
  cleanupOrgIds.push(orgId);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      subscriptionPlan: "growth",
      status: "active",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  clearCachedStaffGatesForOrg(orgId);

  const mkGuest = (i: number, extra: Record<string, unknown>) =>
    prisma.guestProfile.create({
      data: {
        orgId,
        firstName: `Guest${i}`,
        lastName: "Smoke",
        email: `camp-guest-${i}-${stamp}@test.local`,
        ...extra,
      },
    });
  await mkGuest(1, { marketingEmailOptIn: true, newsletterSubscribedAt: new Date() });
  await mkGuest(2, { marketingEmailOptIn: true });
  await mkGuest(3, { marketingEmailOptIn: true, lastVisitAt: new Date() });
  await mkGuest(4, { marketingEmailOptIn: false });
  await mkGuest(5, { marketingEmailOptIn: true, bannedAt: new Date() });

  // ── One-off campaign ───────────────────────────────────────────────────────
  const once = await createMarketingCampaign({
    orgId,
    actorUserId: user.id,
    data: {
      name: "Smoke one-off",
      subject: "Hello {{guestFirstName}}",
      blocks: [{ type: "text", text: "Hi {{guestFirstName}} from {{orgName}}" }],
      scheduleKind: "once",
    },
  });
  check("create-draft", once.status === "draft" && once.timezone.length > 0);

  const preview = await previewMarketingCampaign({
    orgId,
    data: {
      subject: "Hello {{guestFirstName}}",
      blocks: [{ type: "text", text: "Hi {{guestFirstName}}" }],
      audience: { source: "all_opted_in" },
    },
  });
  check("preview-merge", preview.subject === "Hello Alex" && preview.html.includes("Hi Alex"));
  check("preview-audience-consent-only", preview.audienceCount === 3, String(preview.audienceCount));
  const newsletterOnly = await previewMarketingCampaign({
    orgId,
    data: { blocks: [], audience: { source: "newsletter" } },
  });
  check("audience-newsletter-only", newsletterOnly.audienceCount === 1);
  const recent = await previewMarketingCampaign({
    orgId,
    data: { blocks: [], audience: { visitedWithinDays: 30 } },
  });
  check("audience-visited-within", recent.audienceCount === 1);

  const scheduleNoTime = await expectThrow(() =>
    applyMarketingCampaignAction({ orgId, campaignId: once.id, action: "schedule" })
  );
  check("schedule-once-requires-time", Boolean(scheduleNoTime));

  const queued = await applyMarketingCampaignAction({
    orgId,
    campaignId: once.id,
    action: "send_now",
  });
  check("send-now-queues", queued.status === "scheduled" && queued.currentWindowKey === "once");

  const run1 = await runDueMarketingCampaigns({ orgId });
  const attempted = run1.sent + run1.skipped + run1.failed;
  check("run-delivers-to-audience", attempted === 3, JSON.stringify(run1));
  const afterOnce = await getMarketingCampaign(orgId, once.id);
  check("once-marked-sent", afterOnce.status === "sent" && afterOnce.nextRunAt === null);
  check(
    "once-window-stats",
    afterOnce.lastWindow?.windowKey === "once" &&
      (afterOnce.lastWindow.sent + afterOnce.lastWindow.failed + afterOnce.lastWindow.skipped) === 3
  );
  const recipients = await prisma.marketingCampaignRecipient.findMany({
    where: { campaignId: once.id },
    include: { guest: { select: { marketingEmailOptIn: true, bannedAt: true } } },
  });
  check(
    "recipients-only-opted-in",
    recipients.length === 3 &&
      recipients.every((r) => r.guest.marketingEmailOptIn && !r.guest.bannedAt)
  );
  const logs = await prisma.marketingSendLog.count({
    where: { orgId, kind: "newsletter", automationKey: `campaign:${once.id}:once` },
  });
  check("send-log-written", logs === 3);

  const run2 = await runDueMarketingCampaigns({ orgId });
  check("rerun-no-double-send", run2.campaignsProcessed === 0);

  const editSent = await expectThrow(() =>
    updateMarketingCampaign({ orgId, campaignId: once.id, data: { subject: "x" } })
  );
  check("sent-is-read-only", Boolean(editSent));
  const copy = await applyMarketingCampaignAction({
    orgId,
    campaignId: once.id,
    action: "duplicate",
  });
  check("duplicate-is-draft", copy.status === "draft" && copy.id !== once.id);

  // ── Monthly campaign ───────────────────────────────────────────────────────
  const monthly = await createMarketingCampaign({
    orgId,
    actorUserId: user.id,
    data: {
      name: "Smoke monthly",
      subject: "{{monthName}} news",
      blocks: starterMonthlyBlocks(),
      scheduleKind: "monthly",
      dayOfMonth: 1,
      sendHour: 9,
      timezone: "UTC",
      audience: { source: "newsletter" },
    },
  });
  const scheduled = await applyMarketingCampaignAction({
    orgId,
    campaignId: monthly.id,
    action: "schedule",
  });
  check(
    "monthly-scheduled-future",
    scheduled.status === "scheduled" &&
      Boolean(scheduled.nextRunAt) &&
      new Date(scheduled.nextRunAt!).getTime() > Date.now()
  );
  const notDue = await runDueMarketingCampaigns({ orgId });
  check("monthly-not-due-yet", notDue.campaignsProcessed === 0);

  const sendNow = await applyMarketingCampaignAction({
    orgId,
    campaignId: monthly.id,
    action: "send_now",
  });
  const thisMonth = new Date().toISOString().slice(0, 7);
  check("monthly-send-now-current-issue", sendNow.currentWindowKey === thisMonth);
  const run3 = await runDueMarketingCampaigns({ orgId });
  check("monthly-issue-delivered", run3.issuesCompleted === 1 && run3.campaignsProcessed === 1);
  const afterMonthly = await getMarketingCampaign(orgId, monthly.id);
  check(
    "monthly-advances-to-next-issue",
    afterMonthly.status === "scheduled" &&
      Boolean(afterMonthly.currentWindowKey) &&
      afterMonthly.currentWindowKey! > thisMonth &&
      new Date(afterMonthly.nextRunAt!).getTime() > Date.now(),
    `${afterMonthly.currentWindowKey} ${afterMonthly.nextRunAt}`
  );
  const subjectLog = await prisma.marketingSendLog.findFirst({
    where: { orgId, automationKey: `campaign:${monthly.id}:${thisMonth}` },
  });
  check("monthly-send-logged", Boolean(subjectLog));

  const paused = await applyMarketingCampaignAction({
    orgId,
    campaignId: monthly.id,
    action: "pause",
  });
  check("pause", paused.status === "paused");
  const resumed = await applyMarketingCampaignAction({
    orgId,
    campaignId: monthly.id,
    action: "resume",
  });
  check("resume", resumed.status === "scheduled" && resumed.currentWindowKey === afterMonthly.currentWindowKey);

  const list = await listMarketingCampaigns(orgId);
  check("list-includes-campaigns", list.length >= 3);

  // ── Audit regressions ──────────────────────────────────────────────────────
  const nextBefore = resumed.nextRunAt;
  const subjectEdit = await updateMarketingCampaign({
    orgId,
    campaignId: monthly.id,
    data: { subject: "Edited {{monthName}}" },
  });
  check(
    "edit-live-keeps-schedule",
    subjectEdit.nextRunAt === nextBefore && subjectEdit.currentWindowKey === resumed.currentWindowKey
  );
  const clearSubject = await expectThrow(() =>
    updateMarketingCampaign({ orgId, campaignId: monthly.id, data: { subject: "" } })
  );
  check("edit-live-rejects-empty-subject", Boolean(clearSubject));
  const reschedule = await updateMarketingCampaign({
    orgId,
    campaignId: monthly.id,
    data: { dayOfMonth: 28 },
  });
  check(
    "edit-live-never-reopens-sent-issue",
    reschedule.currentWindowKey !== thisMonth,
    String(reschedule.currentWindowKey)
  );

  const past = await createMarketingCampaign({
    orgId,
    data: {
      name: "Past",
      subject: "s",
      blocks: [{ type: "text", text: "x" }],
      scheduleKind: "once",
      sendAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  });
  const pastErr = await expectThrow(() =>
    applyMarketingCampaignAction({ orgId, campaignId: past.id, action: "schedule" })
  );
  check("schedule-rejects-past-time", Boolean(pastErr));

  // Paused one-off started with Send now must resume (no send time required).
  await prisma.guestProfile.createMany({
    data: Array.from({ length: 4 }, (_, i) => ({
      orgId,
      firstName: `Bulk${i}`,
      lastName: "Smoke",
      email: `camp-bulk-${i}-${stamp}@test.local`,
      marketingEmailOptIn: true,
    })),
  });
  await applyMarketingCampaignAction({ orgId, campaignId: past.id, action: "send_now" });
  const partial = await runDueMarketingCampaigns({ orgId, perCampaignLimit: 2 });
  const midway = await getMarketingCampaign(orgId, past.id);
  check(
    "batch-limit-resumable",
    partial.issuesCompleted === 0 && midway.status === "sending",
    JSON.stringify(partial)
  );
  await applyMarketingCampaignAction({ orgId, campaignId: past.id, action: "pause" });
  const resumeOnce = await applyMarketingCampaignAction({
    orgId,
    campaignId: past.id,
    action: "resume",
  });
  check(
    "resume-send-now-once",
    resumeOnce.status === "scheduled" && new Date(resumeOnce.nextRunAt!).getTime() <= Date.now()
  );
  await runDueMarketingCampaigns({ orgId });
  const finished = await getMarketingCampaign(orgId, past.id);
  const pastRecipients = await prisma.marketingCampaignRecipient.count({
    where: { campaignId: past.id },
  });
  check(
    "resumed-issue-completes-without-duplicates",
    finished.status === "sent" && pastRecipients === 7,
    `${finished.status} ${pastRecipients}`
  );

  const missing = await expectThrow(() => getMarketingCampaign(orgId, "cnotarealcampaignid000000"));
  check("not-found-error", missing === "Campaign not found");

  const venue = await prisma.venueLocation.create({
    data: { orgId, name: "Smoke Park", slug: `smoke-park-${stamp}` },
  });
  const parkCreated = await createMarketingCampaign({
    orgId,
    scope: { parkLocked: true, assignedLocationIds: [venue.id] },
    data: { name: "Park newsletter" },
  });
  check("park-locked-create-defaults-to-park", parkCreated.locationId === venue.id);

  const { GET: unsubGet, POST: unsubPost } = await import(
    "../src/app/api/public/marketing/unsubscribe/route.ts"
  );
  const { NextRequest } = await import("next/server");
  const { buildUnsubscribeUrl } = await import("../src/lib/marketing/unsubscribe.ts");
  const optedGuest = await prisma.guestProfile.findFirst({
    where: { orgId, marketingEmailOptIn: true, bannedAt: null },
  });
  const unsubUrl = buildUnsubscribeUrl(orgId, optedGuest!.id);
  const pageRes = await unsubGet(
    new NextRequest(unsubUrl, { headers: { accept: "text/html" } })
  );
  const stillOpted = await prisma.guestProfile.findUnique({ where: { id: optedGuest!.id } });
  check(
    "unsubscribe-get-html-confirms-only",
    pageRes.status === 200 && stillOpted?.marketingEmailOptIn === true
  );
  const oneClick = await unsubPost(
    new NextRequest(unsubUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
  );
  const afterUnsub = await prisma.guestProfile.findUnique({ where: { id: optedGuest!.id } });
  check(
    "unsubscribe-one-click-post",
    oneClick.status === 200 && afterUnsub?.marketingEmailOptIn === false
  );

  // ── Park scope + tenant isolation ──────────────────────────────────────────
  let parkDenied = false;
  try {
    assertCampaignLocationAllowed({ parkLocked: true, assignedLocationIds: ["cabc"] }, null);
  } catch {
    parkDenied = true;
  }
  check("park-locked-cannot-target-company", parkDenied);
  const parkList = await listMarketingCampaigns(orgId, {
    parkLocked: true,
    assignedLocationIds: [],
  });
  check("park-locked-list-hides-company-campaigns", parkList.length === 0);

  const demoUser = await prisma.user.create({
    data: {
      email: `smoke-camp-demo-${stamp}@test.local`,
      password: "x",
      username: `smokecampdemo${stamp}`,
      firstName: "Demo",
      lastName: "Camp",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  cleanupUserIds.push(demoUser.id);
  const demo = await createOrganizationWithPlatformAdmin({
    name: `Smoke Campaigns Demo ${stamp}`,
    slug: `smoke-camp-demo-${stamp}`,
    userId: demoUser.id,
  });
  cleanupOrgIds.push(demo.organization.id);
  await prisma.organization.update({
    where: { id: demo.organization.id },
    data: {
      subscriptionPlan: "demo",
      status: "active",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  clearCachedStaffGatesForOrg(demo.organization.id);
  const demoDenied = await expectThrow(() =>
    createMarketingCampaign({ orgId: demo.organization.id, data: { name: "x" } })
  );
  check("demo-plan-locked", Boolean(demoDenied));
  const crossTenant = await expectThrow(() => getMarketingCampaign(demo.organization.id, once.id));
  check("cross-tenant-denied", Boolean(crossTenant));

  const listRoute = await import("../src/app/api/admin/marketing/campaigns/route.ts");
  const itemRoute = await import("../src/app/api/admin/marketing/campaigns/[id]/route.ts");
  const actionRoute = await import(
    "../src/app/api/admin/marketing/campaigns/[id]/actions/route.ts"
  );
  const testRoute = await import(
    "../src/app/api/admin/marketing/campaigns/[id]/test-send/route.ts"
  );
  const previewRoute = await import("../src/app/api/admin/marketing/campaigns/preview/route.ts");
  const cronRoute = await import("../src/app/api/cron/marketing-campaigns/route.ts");
  const ctx = { params: Promise.resolve({ id: once.id }) };
  const anon = (url: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const statuses = [
    (await listRoute.GET(anon("/api/admin/marketing/campaigns"))).status,
    (await listRoute.POST(anon("/api/admin/marketing/campaigns", "POST", {}))).status,
    (await itemRoute.GET(anon(`/api/admin/marketing/campaigns/${once.id}`), ctx)).status,
    (await itemRoute.PATCH(anon(`/api/admin/marketing/campaigns/${once.id}`, "PATCH", {}), ctx)).status,
    (await itemRoute.DELETE(anon(`/api/admin/marketing/campaigns/${once.id}`, "DELETE"), ctx)).status,
    (await actionRoute.POST(anon(`/api/admin/marketing/campaigns/${once.id}/actions`, "POST", { action: "pause" }), ctx)).status,
    (await testRoute.POST(anon(`/api/admin/marketing/campaigns/${once.id}/test-send`, "POST"), ctx)).status,
    (await previewRoute.POST(anon("/api/admin/marketing/campaigns/preview", "POST", {}))).status,
    (await cronRoute.GET(anon("/api/cron/marketing-campaigns"))).status,
  ];
  check("routes-reject-anonymous", statuses.every((s) => s === 401), statuses.join(","));

  const cronDenied = assertCronBearer(
    new Request("http://localhost/api/cron/marketing-campaigns", { method: "GET" }) as never
  );
  check("cron-requires-bearer", cronDenied != null && cronDenied.status === 401);
}

main()
  .catch((e) => {
    console.error(e);
    failed += 1;
  })
  .finally(async () => {
    try {
      const smokeOrgs = await prisma.organization.findMany({
        where: { OR: [{ id: { in: cleanupOrgIds } }, { slug: { startsWith: "smoke-camp-" } }] },
        select: { id: true },
      });
      const orgIds = smokeOrgs.map((o) => o.id);
      if (orgIds.length) {
        const seats = await prisma.membership.findMany({
          where: { orgId: { in: orgIds } },
          select: { userId: true },
        });
        await prisma.membership.deleteMany({ where: { orgId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
        cleanupUserIds.push(...seats.map((s) => s.userId).filter(Boolean));
      }
      const userIds = [...new Set(cleanupUserIds)];
      if (userIds.length) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds }, email: { startsWith: "smoke-camp-" } },
        });
      }
    } catch (e) {
      console.warn("cleanup warning:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll newsletter campaign smoke checks passed.");
  });
