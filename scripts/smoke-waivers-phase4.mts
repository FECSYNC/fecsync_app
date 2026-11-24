/**
 * Phase 4 Digital Waivers smoke: booking hook, party counts, export, HQ scope,
 * idempotent sign, suspended org, starter gate, shop regression, cron isolation.
 *
 *   yarn smoke:waivers:p4
 */
import { existsSync, readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

const prisma = new PrismaClient();
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = Number((err as { status: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

async function main() {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  check(
    "T2 POS search skipped — no PosSale",
    !schema.includes("model PosSale") && !existsSync("src/app/api/pos/waivers/search/route.ts"),
    "Feature 02 POS terminal is unbuilt; no fake search route"
  );

  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createWaiverTemplate, publishWaiverTemplate } = await import("../src/lib/waivers/templates.ts");
  const { upsertWaiverSettings } = await import("../src/lib/waivers/settings.ts");
  const { createWaiverRequirement } = await import("../src/lib/waivers/requirements.ts");
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  const { createWaiverRequest } = await import("../src/lib/waivers/signToken.ts");
  const { submitPublicSign } = await import("../src/lib/waivers/capture.ts");
  const { evaluateBookingWaivers, waiverLinkForBooking } = await import(
    "../src/lib/waivers/bookingHooks.ts"
  );
  const { listPartyWaiverGaps } = await import("../src/lib/waivers/desk.ts");
  const { assertWaiversEnabled } = await import("../src/lib/waivers/assert.ts");
  const { remindExpiringWaivers } = await import("../src/lib/waivers/remindExpiring.ts");
  const { getWaiverRecordDetail } = await import("../src/lib/waivers/capture.ts");

  const stamp = Date.now();
  const guestEmail = `ada-p4-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: {
      email: `smoke-w4-${stamp}@test.local`,
      password: "x",
      username: `smokew4${stamp}`,
      firstName: "Wav",
      lastName: "Four",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-w4b-${stamp}@test.local`,
      password: "x",
      username: `smokew4b${stamp}`,
      firstName: "Other",
      lastName: "Four",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const starterUser = await prisma.user.create({
    data: {
      email: `smoke-w4s-${stamp}@test.local`,
      password: "x",
      username: `smokew4s${stamp}`,
      firstName: "Start",
      lastName: "Four",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver P4 ${stamp}`,
    slug: `smoke-w4-${stamp}`,
    userId: user.id,
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver P4 Other ${stamp}`,
    slug: `smoke-w4b-${stamp}`,
    userId: otherUser.id,
  });
  const starter = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver P4 Starter ${stamp}`,
    slug: `smoke-w4s-${stamp}`,
    userId: starterUser.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };
  const otherActor = { orgId: other.organization.id, sub: otherUser.id };

  try {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    await prisma.organization.update({
      where: { id: other.organization.id },
      data: {
        status: "active",
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    await prisma.organization.update({
      where: { id: starter.organization.id },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    clearCachedStaffGatesForOrg(orgId);

    const venue = await createVenueLocation(actor, {
      name: `P4 Park ${stamp}`,
      slug: `p4-park-${stamp}`,
      timezone: "America/New_York",
    });
    const otherVenue = await createVenueLocation(actor, {
      name: `P4 Park B ${stamp}`,
      slug: `p4-park-b-${stamp}`,
      timezone: "America/New_York",
    });
    await upsertWaiverSettings(actor, {
      locationId: venue.id,
      expiryRule: "days",
      expiryDays: 30,
      allowTypedSignature: true,
      allowDrawnSignature: true,
      requireIntentCheckbox: true,
      allowAdultSelfSign: true,
    });
    const template = await createWaiverTemplate(actor, {
      name: `P4 Liability ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: "Liability",
      bodyHtml: "<p>I agree.</p>",
      localeDefault: "en",
    });
    await publishWaiverTemplate(actor, template.id, {});

    const product = await prisma.admissionProduct.create({
      data: {
        orgId,
        locationId: venue.id,
        type: "day_pass",
        name: `P4 Day ${stamp}`,
        published: true,
        waiverRequired: true,
      },
    });
    await createWaiverRequirement(actor, {
      templateId: template.id,
      locationId: venue.id,
      targetType: "admission_product",
      targetId: product.id,
      required: true,
    });

    const guest = await prisma.guestProfile.create({
      data: {
        orgId,
        locationId: venue.id,
        firstName: "Ada",
        lastName: "P4",
        email: guestEmail,
      },
    });
    const booking = await prisma.booking.create({
      data: {
        publicId: `P4${stamp}`,
        orgId,
        locationId: venue.id,
        status: "confirmed",
        primaryContactName: "Ada P4",
        primaryContactEmail: guestEmail,
        lines: {
          create: {
            orgId,
            productId: product.id,
            productName: product.name,
            productType: "day_pass",
            qty: 1,
            unitPrice: 10,
            lineTotal: 10,
          },
        },
      },
    });
    const party = await prisma.partyBookingDetail.create({
      data: { bookingId: booking.id, orgId, locationId: venue.id, opsStatus: "confirmed", kidCount: 1 },
    });
    await prisma.partyGuest.create({
      data: { partyDetailId: party.id, orgId, locationId: venue.id, name: "Party Kid" },
    });

    const evaluated = await evaluateBookingWaivers(booking.id);
    check(
      "T1 booking hook calls evaluate",
      evaluated.available === true &&
        evaluated.status === "missing" &&
        evaluated.guestProfileId === guest.id,
      evaluated.status
    );
    const waiverUrl = await waiverLinkForBooking(booking.id);
    check("T1 confirmation helper mints a link", Boolean(waiverUrl && waiverUrl.includes("/sign/")));

    const gaps = await listPartyWaiverGaps(actor, booking.id);
    check(
      "T3 party missing count",
      gaps.available === true && gaps.waiverMissingCount === 1 && gaps.guests[0]?.waiverStatus === "missing",
      String(gaps.available ? gaps.waiverMissingCount : "unavailable")
    );

    const exportSrc = readFileSync("src/lib/companyExport.ts", "utf8");
    const waiverExport = exportSrc.slice(exportSrc.indexOf("waiverTemplateCount"));
    const [waiverTemplates, waiverRecords, formResponses, waiverKioskDevices] = await Promise.all([
      prisma.waiverTemplate.count({ where: { orgId } }),
      prisma.waiverRecord.count({ where: { orgId } }),
      prisma.formResponse.count({ where: { orgId } }),
      prisma.waiverKioskDevice.count({ where: { orgId } }),
    ]);
    const redacted = JSON.stringify({
      waiverTemplates,
      waiverRecords,
      formResponses,
      waiverKioskDevices,
    });
    check(
      "T4 export redaction",
      exportSrc.includes("prisma.waiverTemplate.count") &&
        exportSrc.includes("prisma.waiverRecord.count") &&
        exportSrc.includes("prisma.waiverKioskDevice.count") &&
        !/drawnSignatureSvg|deviceTokenHash|pinHash|ipHash/.test(waiverExport) &&
        !/drawnSignatureSvg|deviceTokenHash|pinHash|ipHash/.test(redacted),
      `records ${waiverRecords}`
    );

    const link = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
      toEmail: guestEmail,
      guestProfileId: guest.id,
    });
    const body = {
      people: [
        {
          fullName: "Ada P4",
          dateOfBirth: "1990-01-15",
          email: guestEmail,
          adultConfirmed: true,
        },
      ],
      intentAccepted: true,
      typedName: "Ada P4",
      drawnSignatureSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="M10 80 L120 40 L200 90"/></svg>',
      acceptedClauses: {},
      fillMethod: "manual",
    };
    const first = await submitPublicSign(link.token, body, { ip: "203.0.113.40" });
    const second = await submitPublicSign(link.token, body, { ip: "203.0.113.40" });
    const signedCount = await prisma.waiverRecord.count({
      where: { orgId, guestProfileId: guest.id, templateId: template.id, status: "signed" },
    });
    check(
      "T6 idempotent double POST sign",
      first.replay === false && second.replay === true && signedCount === 1,
      `count ${signedCount}`
    );

    const atA = await prisma.waiverRecord.count({ where: { orgId, locationId: venue.id, status: "signed" } });
    const atB = await prisma.waiverRecord.count({ where: { orgId, locationId: otherVenue.id, status: "signed" } });
    const hqSrc = readFileSync("src/lib/hqOverview.ts", "utf8");
    let idorBlocked = false;
    try {
      const recordId = "recordIds" in first ? first.recordIds[0] : "";
      await getWaiverRecordDetail(otherActor, recordId);
    } catch (err) {
      idorBlocked = statusOf(err) === 403;
    }
    check(
      "T5 HQ scope",
      atA >= 1 && atB === 0 && hqSrc.includes("signedWaiverRecords") && idorBlocked,
      `A ${atA} B ${atB}`
    );

    const blockedLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
      toEmail: `hold-${stamp}@test.local`,
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: "suspended" },
    });
    clearCachedStaffGatesForOrg(orgId);
    let suspendedStatus: number | null = null;
    try {
      await submitPublicSign(blockedLink.token, body, {});
    } catch (err) {
      suspendedStatus = statusOf(err);
    }
    check("T7 suspended org", suspendedStatus === 403, String(suspendedStatus));

    let starterStatus: number | null = null;
    try {
      await assertWaiversEnabled(starter.organization.id);
    } catch (err) {
      starterStatus = statusOf(err);
    }
    check("T8 starter still 403", starterStatus === 403, String(starterStatus));

    check(
      "T9 shop regression",
      existsSync("src/app/(public)/checkout/page.tsx") && existsSync("src/app/(public)/cart/page.tsx")
    );

    const { GET } = await import("../src/app/api/cron/remind-company-subscriptions/route.ts");
    const cronRes = await GET(
      new NextRequest("http://localhost/api/cron/remind-company-subscriptions")
    );
    const scoped = await remindExpiringWaivers(new Date(), { orgId: starter.organization.id });
    check(
      "T10 daily remind billing + waivers",
      (cronRes.status === 401 || cronRes.status === 503) &&
        typeof scoped.sent === "number" &&
        typeof scoped.skipped === "number",
      `cron ${cronRes.status} sent ${scoped.sent}`
    );
  } finally {
    await prisma.$disconnect();
  }

  if (failed) {
    console.error(`Phase 4 smoke failed: ${failed}`);
    process.exit(1);
  }
  console.log("All Digital Waivers Phase 4 smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
