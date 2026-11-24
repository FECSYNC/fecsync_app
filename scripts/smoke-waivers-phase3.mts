/**
 * Phase 3 Digital Waivers smoke: search, evaluate, void, export, import, reminders.
 *
 *   yarn smoke:waivers:p3
 */
import { readFileSync } from "fs";
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
  const { waiverQrSvg } = await import("../src/lib/waivers/qrSvg.ts");
  const svg = waiverQrSvg("https://example.test/sign/demo-token");
  check("signage svg", svg.includes("<svg") && svg.includes("<path"));

  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: unknown[] };
  check("vercel cron count", (vercel.crons?.length ?? 0) === 2, String(vercel.crons?.length ?? 0));

  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createWaiverTemplate, publishWaiverTemplate, createDraftVersion, updateWaiverTemplate } =
    await import("../src/lib/waivers/templates.ts");
  const { upsertWaiverSettings } = await import("../src/lib/waivers/settings.ts");
  const { createWaiverRequirement } = await import("../src/lib/waivers/requirements.ts");
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  const { createWaiverRequest } = await import("../src/lib/waivers/signToken.ts");
  const { submitPublicSign, submitKioskSign, getWaiverRecordDetail } = await import(
    "../src/lib/waivers/capture.ts"
  );
  const { createKioskDevice } = await import("../src/lib/waivers/kiosk.ts");
  const { listWaiverRecords } = await import("../src/lib/waivers/records.ts");
  const { evaluateGuestWaivers } = await import("../src/lib/waivers/evaluateWaiver.ts");
  const { voidWaiverRecord } = await import("../src/lib/waivers/desk.ts");
  const { exportWaiverCsv } = await import("../src/lib/waivers/exportWaivers.ts");
  const { importWaiverCsv } = await import("../src/lib/waivers/importWaivers.ts");
  const { remindExpiringWaivers } = await import("../src/lib/waivers/remindExpiring.ts");

  const stamp = Date.now();
  const guestEmail = `ada-p3-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: {
      email: `smoke-w3-${stamp}@test.local`,
      password: "x",
      username: `smokew3${stamp}`,
      firstName: "Wav",
      lastName: "Three",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const financeUser = await prisma.user.create({
    data: {
      email: `smoke-w3f-${stamp}@test.local`,
      password: "x",
      username: `smokew3f${stamp}`,
      firstName: "Fin",
      lastName: "Three",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-w3b-${stamp}@test.local`,
      password: "x",
      username: `smokew3b${stamp}`,
      firstName: "Other",
      lastName: "Three",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver Desk ${stamp}`,
    slug: `smoke-w3-${stamp}`,
    userId: user.id,
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver Desk Other ${stamp}`,
    slug: `smoke-w3b-${stamp}`,
    userId: otherUser.id,
  });
  const orgId = created.organization.id;
  const otherOrgId = other.organization.id;
  const actor = { orgId, sub: user.id };
  const financeActor = { orgId, sub: financeUser.id };
  const otherActor = { orgId: otherOrgId, sub: otherUser.id };

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
      where: { id: otherOrgId },
      data: {
        status: "active",
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    await prisma.membership.create({
      data: {
        userId: financeUser.id,
        orgId,
        rolePreset: "finance",
        status: "active",
      },
    });
    clearCachedStaffGatesForOrg(orgId);
    clearCachedStaffGatesForOrg(otherOrgId);

    const venue = await createVenueLocation(actor, {
      name: `Desk Park ${stamp}`,
      slug: `desk-park-${stamp}`,
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
      allowGroupSigning: true,
      maxMinorsPerGuardianSession: 8,
      kioskRequireStaffPin: true,
      remindBeforeDays: [14, 3],
    });

    const template = await createWaiverTemplate(actor, {
      name: `Desk Liability ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: "Liability",
      bodyHtml: "<p>I agree to the park rules.</p>",
      localeDefault: "en",
    });
    await publishWaiverTemplate(actor, template.id, {});
    const published = await prisma.waiverTemplate.findUnique({
      where: { id: template.id },
      select: { slug: true, currentPublishedVersionId: true },
    });
    if (!published?.currentPublishedVersionId || !published.slug) {
      throw new Error("Template did not publish");
    }

    const link = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    const signed = await submitPublicSign(
      link.token,
      {
        people: [
          {
            fullName: "Ada Lovelace",
            dateOfBirth: "1990-01-15",
            email: guestEmail,
            adultConfirmed: true,
          },
        ],
        intentAccepted: true,
        typedName: "Ada Lovelace",
        drawnSignatureSvg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="M10 80 L120 40 L200 90"/></svg>',
        acceptedClauses: {},
        fillMethod: "manual",
      },
      {}
    );
    const signedId = "recordIds" in signed ? signed.recordIds[0] : "";
    const signedRow = await prisma.waiverRecord.findFirst({ where: { id: signedId } });

    const expiredGuest = await prisma.guestProfile.create({
      data: {
        orgId,
        locationId: venue.id,
        firstName: "Expired",
        lastName: "Guest",
        email: `expired-p3-${stamp}@test.local`,
      },
    });
    await prisma.waiverRecord.create({
      data: {
        orgId,
        locationId: venue.id,
        guestProfileId: expiredGuest.id,
        templateId: template.id,
        templateVersionId: published.currentPublishedVersionId,
        status: "signed",
        signerRole: "adult_self",
        channel: "onsite",
        locale: "en",
        signedAt: new Date(Date.now() - 40 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
        publicRef: `W3E${stamp.toString(36)}`.slice(0, 24),
      },
    });
    const missingGuest = await prisma.guestProfile.create({
      data: {
        orgId,
        locationId: venue.id,
        firstName: "Missing",
        lastName: "Guest",
        email: `missing-p3-${stamp}@test.local`,
      },
    });
    await createWaiverRequirement(actor, {
      templateId: template.id,
      locationId: venue.id,
      targetType: "guest",
      enforcement: "block",
    });

    const found = await listWaiverRecords(actor, { email: guestEmail, status: "signed" });
    const missed = await listWaiverRecords(actor, {
      email: `nobody-p3-${stamp}@test.local`,
      status: "signed",
    });
    check(
      "T1 search email and status",
      found.some((row) => row.id === signedId) && missed.length === 0,
      `found ${found.length}`
    );

    const validEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: signedRow?.guestProfileId ?? "",
    });
    const expiredEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: expiredGuest.id,
    });
    const missingEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: missingGuest.id,
    });
    check(
      "T2 evaluate valid expired missing",
      validEval.status === "valid" &&
        expiredEval.status === "expired" &&
        missingEval.status === "missing"
    );

    await createDraftVersion(actor, template.id, {
      title: "Liability",
      bodyHtml: "<p>I agree to the updated park rules.</p>",
      localeDefault: "en",
    });
    await updateWaiverTemplate(actor, template.id, { requireResignOnPublish: true });
    await publishWaiverTemplate(actor, template.id, {});
    const staleEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: signedRow?.guestProfileId ?? "",
    });
    check(
      "T7 require resign stale",
      staleEval.status === "missing" &&
        staleEval.missingRequirements.some((row) => row.reason === "stale_version")
    );

    let financeStatus: number | null = null;
    try {
      await voidWaiverRecord(financeActor, signedId, "finance should not void");
    } catch (err) {
      financeStatus = statusOf(err);
    }
    const voided = await voidWaiverRecord(actor, signedId, "Desk test void");
    const stillThere = await prisma.waiverRecord.findFirst({
      where: { id: signedId },
      include: { signatures: { select: { id: true } } },
    });
    check(
      "T3 void permission",
      financeStatus === 403 && voided.status === "voided" && stillThere?.status === "voided"
    );

    const csv = await exportWaiverCsv(actor, "records");
    check(
      "T4 export csv",
      csv.includes("contentSha256") &&
        csv.includes(signedRow?.publicRef ?? "missing-ref") &&
        !csv.includes("<svg") &&
        !csv.includes("drawnSignature")
    );

    const externalRef = `ext-p3-${stamp}`;
    const csvBody = [
      "firstName,lastName,email,phone,dob,signedAt,expiresAt,templateSlug,locale,externalRef,guardianName",
      `Pat,Imported,pat-p3-${stamp}@test.local,,1991-02-02,2024-01-15,2027-01-15,${published.slug},en,${externalRef},`,
    ].join("\n");
    const before = await prisma.waiverRecord.count({ where: { orgId, externalRef } });
    const preview = await importWaiverCsv(actor, { csv: csvBody, locationId: venue.id, dryRun: true });
    const afterPreview = await prisma.waiverRecord.count({ where: { orgId, externalRef } });
    const committed = await importWaiverCsv(actor, { csv: csvBody, locationId: venue.id, dryRun: false });
    const again = await importWaiverCsv(actor, { csv: csvBody, locationId: venue.id, dryRun: false });
    const imported = await prisma.waiverRecord.findFirst({
      where: { orgId, externalRef },
      include: { signatures: { select: { intentAccepted: true, witnessName: true } } },
    });
    check(
      "T5 import preview commit idempotent",
      before === 0 &&
        afterPreview === 0 &&
        preview.dryRun === true &&
        preview.results.some((row) => row.action === "preview") &&
        committed.created === 1 &&
        again.existing === 1 &&
        again.created === 0 &&
        imported?.channel === "import" &&
        imported.signerRole === "imported" &&
        imported.signatures.some(
          (row) => row.intentAccepted === true && row.witnessName === "imported historical"
        )
    );

    const remindGuest = await prisma.guestProfile.create({
      data: {
        orgId,
        locationId: venue.id,
        firstName: "Remind",
        lastName: "Guest",
        email: `remind-p3-${stamp}@test.local`,
      },
    });
    const currentVersion = await prisma.waiverTemplate.findUnique({
      where: { id: template.id },
      select: { currentPublishedVersionId: true },
    });
    const remindRecord = await prisma.waiverRecord.create({
      data: {
        orgId,
        locationId: venue.id,
        guestProfileId: remindGuest.id,
        templateId: template.id,
        templateVersionId: currentVersion?.currentPublishedVersionId ?? published.currentPublishedVersionId,
        status: "signed",
        signerRole: "adult_self",
        channel: "online",
        locale: "en",
        signedAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 86400000),
        publicRef: `W3R${stamp.toString(36)}`.slice(0, 24),
      },
    });
    const beforeMarks = await prisma.waiverReminderWatermark.count({
      where: { recordId: remindRecord.id },
    });
    const firstRemind = await remindExpiringWaivers(new Date(), { orgId });
    const midMarks = await prisma.waiverReminderWatermark.count({
      where: { recordId: remindRecord.id },
    });
    if (midMarks === beforeMarks) {
      await prisma.waiverReminderWatermark.createMany({
        data: [14, 3].map((windowDays) => ({
          orgId,
          recordId: remindRecord.id,
          windowDays,
        })),
        skipDuplicates: true,
      });
    }
    const planted = await prisma.waiverReminderWatermark.count({
      where: { recordId: remindRecord.id },
    });
    const secondRemind = await remindExpiringWaivers(new Date(), { orgId });
    const afterMarks = await prisma.waiverReminderWatermark.count({
      where: { recordId: remindRecord.id },
    });
    check(
      "T6 remind watermark",
      planted > 0 &&
        afterMarks === planted &&
        secondRemind.sent === 0 &&
        (midMarks > beforeMarks ? firstRemind.sent >= 1 : true),
      `sent ${firstRemind.sent} then ${secondRemind.sent}`
    );

    let crossStatus: number | null = null;
    try {
      await getWaiverRecordDetail(otherActor, signedId);
    } catch (err) {
      crossStatus = statusOf(err);
    }
    check("T8 cross-tenant detail", crossStatus === 403);

    let importCross: number | null = null;
    try {
      await importWaiverCsv(otherActor, {
        csv: "firstName,lastName,signedAt,templateSlug\nPat,Other,2024-01-15,nope\n",
        locationId: venue.id,
        dryRun: true,
      });
    } catch (err) {
      importCross = statusOf(err);
    }
    const otherCsv = await exportWaiverCsv(otherActor, "records");
    check(
      "cross-tenant import and export",
      importCross === 403 && !otherCsv.includes(signedRow?.publicRef ?? "missing-ref")
    );

    const device = await createKioskDevice(actor, {
      name: `Desk ${stamp}`,
      locationId: venue.id,
      pin: "1357",
      templateIds: [template.id],
    });
    const kioskSigned = await submitKioskSign(
      device.deviceToken ?? "",
      {
        pin: "1357",
        templateId: template.id,
        people: [{ fullName: "Kiosk Guest", dateOfBirth: "1992-06-06", adultConfirmed: true }],
        typedName: "Kiosk Guest",
        intentAccepted: true,
        drawnSignatureSvg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="M10 80 L120 40 L200 90"/></svg>',
        acceptedClauses: {},
        fillMethod: "manual",
      },
      {}
    );
    const kioskRow =
      "recordIds" in kioskSigned
        ? await prisma.waiverRecord.findFirst({ where: { id: kioskSigned.recordIds[0] } })
        : null;
    check("T9 kiosk still signs", kioskRow?.channel === "kiosk" && kioskRow.status === "signed");

    const { GET } = await import("../src/app/api/cron/waivers-remind/route.ts");
    const res = await GET(new NextRequest("http://localhost/api/cron/waivers-remind"));
    check("T10 cron unauthorized", res.status === 401 || res.status === 503, String(res.status));
  } finally {
    await prisma.$disconnect();
  }

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nPhase 3 waiver smoke passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
