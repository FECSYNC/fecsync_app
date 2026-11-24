/**
 * Phase 5 Digital Waivers smoke: production matrix T1–T25.
 *
 *   yarn smoke:waivers:p5
 */
import { existsSync, readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
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

const adult = {
  fullName: "Ada Lovelace",
  dateOfBirth: "1990-01-15",
  email: "",
  adultConfirmed: true,
};

const VALID_DRAWN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="M10 80 L120 40 L200 90"/></svg>';

function signBody(extra: Record<string, unknown> = {}) {
  return {
    people: [{ ...adult, email: extra.email }],
    intentAccepted: true,
    typedName: "Ada Lovelace",
    drawnSignatureSvg: VALID_DRAWN_SVG,
    acceptedClauses: {},
    fillMethod: "manual",
    ...extra,
    people: extra.people ?? [{ ...adult, email: extra.email }],
  };
}

async function main() {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const recordModel = schema.slice(schema.indexOf("model WaiverRecord"));
  const guestModel = schema.slice(schema.indexOf("model GuestProfile"), schema.indexOf("model WaiverSettings"));
  check(
    "B4 indexes",
    recordModel.includes("publicRef") &&
      recordModel.includes("@unique") &&
      recordModel.includes("@@index([orgId, locationId, status])") &&
      recordModel.includes("@@index([orgId, expiresAt])") &&
      schema.includes("publicTokenHash") &&
      schema.includes("deviceTokenHash") &&
      guestModel.includes("@@index([orgId, email])") &&
      guestModel.includes("@@index([orgId, lastName, firstName])"),
    "guest search, publicRef, token hashes, expiresAt, org+location+status"
  );
  const detailSrc = readFileSync("src/lib/waivers/capture.ts", "utf8");
  const detailFn = detailSrc.slice(detailSrc.indexOf("export async function getWaiverRecordDetail"));
  check(
    "B4 record detail includes signers and signatures",
    detailFn.includes("signers: true") && detailFn.includes("signatures:")
  );

  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createWaiverTemplate, publishWaiverTemplate, createDraftVersion, updateWaiverTemplate, listWaiverTemplates } =
    await import("../src/lib/waivers/templates.ts");
  const { upsertWaiverSettings } = await import("../src/lib/waivers/settings.ts");
  const { createWaiverRequirement } = await import("../src/lib/waivers/requirements.ts");
  const { createKioskDevice, listKioskDevices, updateKioskDevice } = await import("../src/lib/waivers/kiosk.ts");
  const { clearCachedStaffGatesForOrg, clearCachedLocationScopesForOrg } = await import(
    "../src/lib/ticketing/staffGateCache.ts"
  );
  const { createWaiverRequest, hashWaiverToken, issueSignageLink } = await import("../src/lib/waivers/signToken.ts");
  const { submitPublicSign, submitKioskSign, getWaiverRecordDetail } = await import("../src/lib/waivers/capture.ts");
  const { evaluateGuestWaivers } = await import("../src/lib/waivers/evaluateWaiver.ts");
  const { voidWaiverRecord } = await import("../src/lib/waivers/desk.ts");
  const { importWaiverCsv } = await import("../src/lib/waivers/importWaivers.ts");
  const { exportWaiverCsv } = await import("../src/lib/waivers/exportWaivers.ts");
  const { assertWaiversEnabled } = await import("../src/lib/waivers/assert.ts");
  const { assertWaiverPermission } = await import("../src/lib/waivers/access.ts");
  const { remindExpiringWaivers } = await import("../src/lib/waivers/remindExpiring.ts");
  const { listWaiverRecords } = await import("../src/lib/waivers/records.ts");
  const { computeWaiverExpiresAt, isSignedWaiverCurrentlyValid } = await import("../src/lib/waivers/expiry.ts");
  const { waiverValidationBadRequest } = await import("../src/lib/waivers/http.ts");
  const { SmsNotConfiguredError } = await import("../src/lib/sms.ts");
  const { P, ROLE_PRESETS, groupPermissionsByFeature } = await import("../src/lib/auth/permissions.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");

  const stamp = Date.now();
  const guestEmail = `ada-p5-${stamp}@test.local`;
  async function userRow(tag: string, first: string) {
    return prisma.user.create({
      data: {
        email: `smoke-w5-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokew5${tag}${stamp}`.slice(0, 40),
        firstName: first,
        lastName: "Five",
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
  }
  const user = await userRow("a", "Wav");
  const otherUser = await userRow("b", "Other");
  const gateUser = await userRow("g", "Gate");
  const financeUser = await userRow("f", "Fin");
  const catalogUser = await userRow("c", "Cat");

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver P5 ${stamp}`,
    slug: `smoke-w5-${stamp}`,
    userId: user.id,
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver P5 Other ${stamp}`,
    slug: `smoke-w5b-${stamp}`,
    userId: otherUser.id,
  });
  const gate = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver P5 Gate ${stamp}`,
    slug: `smoke-w5g-${stamp}`,
    userId: gateUser.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };
  const otherActor = { orgId: other.organization.id, sub: otherUser.id };
  const entitled = {
    status: "active" as const,
    subscriptionPlan: "growth",
    subscriptionStatus: "active",
    subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
  };

  try {
    let pendingDenied = false;
    try {
      await assertWaiversEnabled(gate.organization.id);
    } catch (err) {
      pendingDenied = err instanceof ForbiddenError;
    }

    await prisma.organization.update({
      where: { id: orgId },
      data: entitled,
    });
    await prisma.organization.update({
      where: { id: other.organization.id },
      data: entitled,
    });
    clearCachedStaffGatesForOrg(orgId);
    clearCachedStaffGatesForOrg(other.organization.id);

    await prisma.membership.create({
      data: { userId: financeUser.id, orgId, rolePreset: "finance", status: "active" },
    });
    await prisma.membership.create({
      data: { userId: catalogUser.id, orgId, rolePreset: "catalog_editor", status: "active" },
    });
    const financeActor = { orgId, sub: financeUser.id };
    const catalogActor = { orgId, sub: catalogUser.id };

    const venue = await createVenueLocation(actor, {
      name: `P5 Park ${stamp}`,
      slug: `p5-park-${stamp}`,
      timezone: "America/New_York",
    });
    const venueB = await createVenueLocation(actor, {
      name: `P5 Park B ${stamp}`,
      slug: `p5-park-b-${stamp}`,
      timezone: "America/New_York",
    });
    await upsertWaiverSettings(actor, {
      locationId: venue.id,
      jurisdictionCode: "US-FL",
      ageOfMajorityYears: 18,
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
      name: `P5 Liability ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: "Liability",
      bodyHtml: "<p>I agree to the park rules.</p>",
      localeDefault: "en",
      locales: [{ locale: "es", title: "Responsabilidad", bodyHtml: "<p>Acepto las reglas.</p>" }],
    });
    const published = await publishWaiverTemplate(actor, template.id, {});
    const version = await prisma.waiverTemplateVersion.findFirst({
      where: { id: published.currentPublishedVersionId ?? "" },
      include: { locales: true },
    });

    const form = await createWaiverTemplate(actor, {
      name: `P5 Form ${stamp}`,
      kind: "custom_form",
      locationId: venue.id,
      title: "Guest note",
      bodyHtml: "<p>Tell us anything we should know.</p>",
      localeDefault: "en",
      fieldsJson: [{ id: "note", type: "text", label: "Note", required: true }],
    });
    await publishWaiverTemplate(actor, form.id, {});
    const product = await prisma.admissionProduct.create({
      data: {
        orgId,
        locationId: venue.id,
        type: "day_pass",
        name: `P5 Day ${stamp}`,
        published: true,
        waiverRequired: true,
      },
    });
    await createWaiverRequirement(actor, {
      templateId: form.id,
      locationId: venue.id,
      targetType: "admission_product",
      targetId: product.id,
      required: true,
    });

    const contract = await createWaiverTemplate(actor, {
      name: `P5 Contract ${stamp}`,
      kind: "membership_contract",
      locationId: venue.id,
      title: "Membership terms",
      bodyHtml: "<p>I accept the membership terms.</p>",
      localeDefault: "en",
    });
    await publishWaiverTemplate(actor, contract.id, {});

    const productsBefore = await prisma.product.count({ where: { orgId } });

    const otherTemplates = await listWaiverTemplates(otherActor);
    let otherRecordStatus: number | null = null;
    const otherKiosksBefore = await listKioskDevices(otherActor);
    let otherExport = "";
    try {
      otherExport = await exportWaiverCsv(otherActor, "records");
    } catch {
      otherExport = "";
    }
    let otherEvalDenied = false;
    try {
      await evaluateGuestWaivers({
        orgId: other.organization.id,
        locationId: venue.id,
        guestProfileId: "not-this-tenant",
      });
    } catch {
      otherEvalDenied = true;
    }

    const adultLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
      toEmail: guestEmail,
    });
    const signed = await submitPublicSign(
      adultLink.token,
      signBody({ email: guestEmail, locale: "en" })
    );
    const signedRow = await prisma.waiverRecord.findFirst({
      where: { id: signed.recordIds[0] },
      include: { signatures: true },
    });
    const guest = await prisma.guestProfile.findFirst({
      where: { orgId, email: guestEmail },
    });
    const validEval = guest
      ? await evaluateGuestWaivers({
          orgId,
          locationId: venue.id,
          guestProfileId: guest.id,
        })
      : null;
    const detail = await getWaiverRecordDetail(actor, signed.recordIds[0]);

    try {
      await getWaiverRecordDetail(otherActor, signed.recordIds[0]);
    } catch (err) {
      otherRecordStatus = statusOf(err);
    }
    check(
      "T1 cross-tenant deny",
      !otherTemplates.some((row) => row.id === template.id) &&
        otherRecordStatus === 403 &&
        otherKiosksBefore.every((row) => row.locationId !== venue.id) &&
        !otherExport.includes(signedRow?.publicRef ?? "missing-ref") &&
        otherEvalDenied,
      `record ${otherRecordStatus}`
    );

    await prisma.organization.update({
      where: { id: gate.organization.id },
      data: { status: "suspended", subscriptionPlan: "growth", subscriptionStatus: "active" },
    });
    clearCachedStaffGatesForOrg(gate.organization.id);
    let suspendedDenied = false;
    try {
      await assertWaiversEnabled(gate.organization.id);
    } catch (err) {
      suspendedDenied = err instanceof ForbiddenError;
    }
    await prisma.organization.update({
      where: { id: gate.organization.id },
      data: { status: "active", subscriptionPlan: "starter", subscriptionStatus: "active", subscriptionEndsAt: entitled.subscriptionEndsAt },
    });
    clearCachedStaffGatesForOrg(gate.organization.id);
    let starterDenied = false;
    try {
      await assertWaiversEnabled(gate.organization.id);
    } catch (err) {
      starterDenied = err instanceof ForbiddenError;
    }
    await prisma.organization.update({
      where: { id: gate.organization.id },
      data: { subscriptionPlan: "demo", subscriptionStatus: "active" },
    });
    clearCachedStaffGatesForOrg(gate.organization.id);
    let demoDenied = false;
    try {
      await assertWaiversEnabled(gate.organization.id);
    } catch (err) {
      demoDenied = err instanceof ForbiddenError;
    }
    await prisma.organization.update({
      where: { id: gate.organization.id },
      data: { subscriptionPlan: "growth", subscriptionStatus: "none", subscriptionEndsAt: null },
    });
    clearCachedStaffGatesForOrg(gate.organization.id);
    let unpaidDenied = false;
    try {
      await assertWaiversEnabled(gate.organization.id);
    } catch (err) {
      unpaidDenied = err instanceof ForbiddenError;
    }
    const storefront = await prisma.organization.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    let storefrontDenied = false;
    if (storefront) {
      try {
        await assertWaiversEnabled(storefront.id);
      } catch (err) {
        storefrontDenied = err instanceof ForbiddenError;
      }
    }
    check(
      "T2 demo storefront starter unpaid pending suspended deny",
      pendingDenied && suspendedDenied && starterDenied && demoDenied && unpaidDenied && storefrontDenied
    );

    check(
      "T3 adult online sign valid",
      signedRow?.status === "signed" &&
        signedRow.channel === "online" &&
        validEval?.status === "valid" &&
        detail.signers.length > 0 &&
        detail.signatures.length > 0,
      validEval?.status ?? "no guest"
    );

    const minorLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    let minorDenied = false;
    try {
      await submitPublicSign(minorLink.token, {
        people: [{ fullName: "Kid Example", dateOfBirth: "2016-04-02" }],
        typedName: "Kid Example",
        intentAccepted: true,
      });
    } catch (err) {
      minorDenied = err instanceof Error && /guardian/i.test(err.message);
    }
    const groupLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    const group = await submitPublicSign(groupLink.token, {
      people: [
        { fullName: "Mina One", dateOfBirth: "2016-04-02" },
        { fullName: "Mina Two", dateOfBirth: "2018-08-09" },
      ],
      guardian: {
        fullName: "Pat Guardian",
        dateOfBirth: "1980-02-02",
        relationship: "parent",
        email: `guard-p5-${stamp}@test.local`,
      },
      typedName: "Pat Guardian",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const groupRows = await prisma.waiverRecord.findMany({
      where: { waiverGroupId: group.waiverGroupId },
    });
    const covered = groupRows.find((row) => row.guestProfileId);
    const coveredEval = covered
      ? await evaluateGuestWaivers({
          orgId,
          locationId: venue.id,
          guestProfileId: covered.guestProfileId,
        })
      : null;
    check(
      "T4 minor rejected guardian valid",
      minorDenied &&
        groupRows.length === 2 &&
        groupRows.every((row) => row.status === "signed" && row.signerRole === "guardian") &&
        coveredEval?.status === "valid",
      coveredEval?.status ?? "no covered guest"
    );

    const signage = await issueSignageLink(actor, template.id, venue.id);
    const qrSigned = await submitPublicSign(signage.token, {
      people: [{ fullName: "QR Guest", dateOfBirth: "1989-03-03", email: `qr-p5-${stamp}@test.local` }],
      typedName: "QR Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const qrRow = await prisma.waiverRecord.findFirst({ where: { id: qrSigned.recordIds[0] } });
    const onsite = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "onsite",
      toEmail: `onsite-p5-${stamp}@test.local`,
    });
    const onsiteSigned = await submitPublicSign(onsite.token, {
      people: [{ fullName: "On Site Guest", dateOfBirth: "1988-05-05", email: `onsite-p5-${stamp}@test.local` }],
      typedName: "On Site Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const onsiteRow = await prisma.waiverRecord.findFirst({ where: { id: onsiteSigned.recordIds[0] } });
    const device = await createKioskDevice(actor, {
      name: `P5 Desk ${stamp}`,
      locationId: venue.id,
      code: `p5-${stamp}`.slice(0, 20),
      pin: "2468",
      templateIds: [template.id],
    });
    const kioskSigned = await submitKioskSign(device.deviceToken ?? "", {
      pin: "2468",
      templateId: template.id,
      people: [{ fullName: "Kiosk Guest", dateOfBirth: "1992-06-06", email: `kiosk-p5-${stamp}@test.local` }],
      typedName: "Kiosk Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const kioskRow =
      "recordIds" in kioskSigned
        ? await prisma.waiverRecord.findFirst({ where: { id: kioskSigned.recordIds[0] } })
        : null;
    check(
      "T5 qr kiosk onsite channels",
      qrRow?.channel === "qr" && onsiteRow?.channel === "onsite" && kioskRow?.channel === "kiosk"
    );

    const expiredLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    await prisma.waiverRequest.updateMany({
      where: { publicTokenHash: hashWaiverToken(expiredLink.token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    let expiredStatus = 0;
    try {
      await submitPublicSign(
        expiredLink.token,
        signBody({ email: `exp-p5-${stamp}@test.local` })
      );
    } catch (err) {
      expiredStatus = statusOf(err) ?? 0;
    }
    const beforeReplay = await prisma.waiverRecord.count({ where: { id: signed.recordIds[0] } });
    const replay = await submitPublicSign(adultLink.token, signBody({ email: guestEmail }));
    const afterReplay = await prisma.waiverRecord.count({
      where: { orgId, guestProfileId: guest?.id },
    });
    check(
      "T6 replay and expired token",
      expiredStatus === 410 && replay.replay === true && beforeReplay === 1 && afterReplay >= 1,
      `expired ${expiredStatus}`
    );

    const now = new Date();
    const zone = "America/New_York";
    const neverAt = computeWaiverExpiresAt({ rule: "never", signedAt: now, timeZone: zone });
    const daysAt = computeWaiverExpiresAt({ rule: "days", signedAt: now, expiryDays: 30, timeZone: zone });
    const yearAt = computeWaiverExpiresAt({ rule: "calendar_year", signedAt: now, timeZone: zone });
    const visitAt = computeWaiverExpiresAt({ rule: "visit", signedAt: now, timeZone: zone });
    const until = new Date(now.getTime() + 10 * 86400000);
    const untilAt = computeWaiverExpiresAt({ rule: "until_date", signedAt: now, untilDate: until, timeZone: zone });
    check(
      "T7 expiry rules",
      neverAt === null &&
        isSignedWaiverCurrentlyValid({ rule: "never", signedAt: now, expiresAt: null, now, timeZone: zone }) &&
        daysAt != null &&
        daysAt.getTime() > now.getTime() &&
        yearAt != null &&
        yearAt.getTime() >= now.getTime() &&
        visitAt != null &&
        isSignedWaiverCurrentlyValid({ rule: "visit", signedAt: now, expiresAt: visitAt, now, timeZone: zone }) &&
        untilAt?.getTime() === until.getTime() &&
        !isSignedWaiverCurrentlyValid({
          rule: "until_date",
          signedAt: now,
          expiresAt: null,
          now,
          timeZone: zone,
        })
    );

    const remindGuest = await prisma.guestProfile.create({
      data: {
        orgId,
        locationId: venue.id,
        firstName: "Remind",
        lastName: "Five",
        email: `remind-p5-${stamp}@test.local`,
      },
    });
    const remindRecord = await prisma.waiverRecord.create({
      data: {
        orgId,
        locationId: venue.id,
        guestProfileId: remindGuest.id,
        templateId: template.id,
        templateVersionId: version?.id ?? published.currentPublishedVersionId ?? "",
        status: "signed",
        signerRole: "adult_self",
        channel: "online",
        locale: "en",
        signedAt: now,
        expiresAt: new Date(Date.now() + 2 * 86400000),
        publicRef: `W5R${stamp.toString(36)}`.slice(0, 24),
      },
    });
    const firstRemind = await remindExpiringWaivers(new Date(), { orgId });
    const midMarks = await prisma.waiverReminderWatermark.count({ where: { recordId: remindRecord.id } });
    if (midMarks === 0) {
      await prisma.waiverReminderWatermark.createMany({
        data: [14, 3].map((windowDays) => ({ orgId, recordId: remindRecord.id, windowDays })),
        skipDuplicates: true,
      });
    }
    const planted = await prisma.waiverReminderWatermark.count({ where: { recordId: remindRecord.id } });
    const secondRemind = await remindExpiringWaivers(new Date(), { orgId });
    const afterMarks = await prisma.waiverReminderWatermark.count({ where: { recordId: remindRecord.id } });
    check(
      "T8 remind idempotent",
      planted > 0 && afterMarks === planted && secondRemind.sent === 0,
      `sent ${firstRemind.sent} then ${secondRemind.sent}`
    );

    await createDraftVersion(actor, template.id, {
      title: "Liability",
      bodyHtml: "<p>I agree to the updated park rules.</p>",
      localeDefault: "en",
      locales: [{ locale: "es", title: "Responsabilidad", bodyHtml: "<p>Acepto las reglas nuevas.</p>" }],
    });
    await updateWaiverTemplate(actor, template.id, { requireResignOnPublish: true });
    await publishWaiverTemplate(actor, template.id, {});
    const staleEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: guest?.id ?? "",
    });
    check(
      "T10 requireResign stale",
      staleEval.status === "missing" &&
        staleEval.missingRequirements.some((row) => row.reason === "stale_version")
    );

    await voidWaiverRecord(actor, signed.recordIds[0], "Smoke void");
    const voidEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: guest?.id ?? "",
    });
    check("T9 void blocks evaluate", voidEval.status !== "valid", voidEval.status);

    const externalRef = `ext-p5-${stamp}`;
    const csvBody = [
      "firstName,lastName,email,phone,dob,signedAt,expiresAt,templateSlug,locale,externalRef,guardianName",
      `Pat,Imported,pat-p5-${stamp}@test.local,,1991-02-02,2024-01-15,2027-01-15,${published.slug},en,${externalRef},`,
    ].join("\n");
    const preview = await importWaiverCsv(actor, { csv: csvBody, locationId: venue.id, dryRun: true });
    const afterPreview = await prisma.waiverRecord.count({ where: { orgId, externalRef } });
    await importWaiverCsv(actor, { csv: csvBody, locationId: venue.id, dryRun: false });
    const again = await importWaiverCsv(actor, { csv: csvBody, locationId: venue.id, dryRun: false });
    const imported = await prisma.waiverRecord.count({ where: { orgId, externalRef } });
    check(
      "T11 csv import idempotent",
      afterPreview === 0 &&
        preview.results.some((row) => row.ok && row.action === "preview") &&
        imported === 1 &&
        again.existing >= 1,
      `preview ${preview.created} imported ${imported} existing ${again.existing} failed ${again.failed}`
    );

    const csv = await exportWaiverCsv(actor, "records");
    check(
      "T12 export redaction",
      csv.includes(signedRow?.publicRef ?? "") &&
        !csv.toLowerCase().includes("drawnSignatureSvg".toLowerCase()) &&
        !csv.includes("<svg") &&
        !/deviceTokenHash|pinHash|ipHash/.test(csv)
    );

    const formLink = await createWaiverRequest(actor, {
      templateId: form.id,
      locationId: venue.id,
      channel: "online",
    });
    await submitPublicSign(formLink.token, {
      people: [{ fullName: "Form Guest", dateOfBirth: "1993-07-07", email: `form-p5-${stamp}@test.local` }],
      typedName: "Form Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
      answers: { note: "Allergic to bees" },
    });
    const formResponse = await prisma.formResponse.findFirst({ where: { orgId, templateId: form.id } });
    const requirement = await prisma.waiverRequirement.findFirst({
      where: { orgId, templateId: form.id, targetId: product.id },
    });
    const payload = formResponse?.payloadJson as { note?: string } | null;
    check(
      "T13 custom form and product requirement",
      payload?.note === "Allergic to bees" && requirement?.targetType === "admission_product"
    );

    const contractLink = await createWaiverRequest(actor, {
      templateId: contract.id,
      locationId: venue.id,
      channel: "online",
    });
    const contractSigned = await submitPublicSign(contractLink.token, {
      people: [{ fullName: "Contract Guest", dateOfBirth: "1985-05-05", email: `contract-p5-${stamp}@test.local` }],
      typedName: "Contract Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const contractRow = await prisma.waiverRecord.findFirst({
      where: { id: contractSigned.recordIds[0] },
      include: { template: true },
    });
    check(
      "T14 contract kind signs",
      contractRow?.status === "signed" && contractRow.template.kind === "membership_contract"
    );

    const smsBefore = await prisma.waiverRequest.count({ where: { orgId, channel: "sms_link" } });
    const savedSid = process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_ACCOUNT_SID;
    let smsMessage = "";
    try {
      await createWaiverRequest(actor, {
        templateId: template.id,
        locationId: venue.id,
        channel: "sms_link",
        toPhone: "+15555550123",
      });
    } catch (err) {
      smsMessage = err instanceof Error ? err.message : "";
    }
    if (savedSid) process.env.TWILIO_ACCOUNT_SID = savedSid;
    const smsAfter = await prisma.waiverRequest.count({ where: { orgId, channel: "sms_link" } });
    const smsHttp = waiverValidationBadRequest(new SmsNotConfiguredError());
    check(
      "T15 sms unconfigured 400",
      smsMessage === "SMS is not configured" && smsAfter === smsBefore && smsHttp?.status === 400
    );

    const plansSrc = readFileSync("src/lib/subscriptionPlans.ts", "utf8");
    const limitsBlock = plansSrc.slice(plansSrc.indexOf("export type PlanLimits"), plansSrc.indexOf("export type FuturePlanModules"));
    await updateKioskDevice(actor, device.id, { status: "archived" });
    let archivedStatus = 0;
    try {
      await submitKioskSign(device.deviceToken ?? "", {
        pin: "2468",
        templateId: template.id,
        people: [{ fullName: "Late Guest", dateOfBirth: "1992-06-06" }],
        typedName: "Late Guest",
        intentAccepted: true,
      });
    } catch (err) {
      archivedStatus = statusOf(err) ?? 0;
    }
    check(
      "T16 no kiosk meter and archived kiosk cannot sign",
      !/kioskDevices\s*:/.test(limitsBlock) &&
        plansSrc.includes("not a PlanLimits meter") &&
        archivedStatus === 404,
      String(archivedStatus)
    );

    const parkB = await createWaiverTemplate(actor, {
      name: `P5 Park B ${stamp}`,
      kind: "liability_waiver",
      locationId: venueB.id,
      title: "Park B",
      bodyHtml: "<p>Park B rules.</p>",
      localeDefault: "en",
    });
    const parkBPublished = await publishWaiverTemplate(actor, parkB.id, {});
    const parkBRef = `ext-p5b-${stamp}`;
    await importWaiverCsv(actor, {
      csv: [
        "firstName,lastName,email,signedAt,expiresAt,templateSlug,externalRef",
        `Bea,Other,bea-p5-${stamp}@test.local,2024-06-01,2027-06-01,${parkBPublished.slug},${parkBRef}`,
      ].join("\n"),
      locationId: venueB.id,
      dryRun: false,
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "enterprise" },
    });
    await prisma.membership.updateMany({
      where: { userId: user.id, orgId },
      data: { hqSelectedLocationId: venue.id },
    });
    clearCachedStaffGatesForOrg(orgId);
    clearCachedLocationScopesForOrg(orgId);
    const scoped = await listWaiverRecords(actor);
    check(
      "T17 HQ location filter",
      scoped.some((row) => row.locationId === venue.id) &&
        scoped.every((row) => row.locationId === venue.id) &&
        !scoped.some((row) => row.publicRef.includes("missing")),
      `rows ${scoped.length}`
    );

    const doubleLink = await createWaiverRequest(actor, {
      templateId: contract.id,
      locationId: venue.id,
      channel: "online",
    });
    const firstSubmit = await submitPublicSign(doubleLink.token, {
      people: [{ fullName: "Twice Guest", dateOfBirth: "1984-04-04", email: `twice-p5-${stamp}@test.local` }],
      typedName: "Twice Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const secondSubmit = await submitPublicSign(doubleLink.token, {
      people: [{ fullName: "Twice Guest", dateOfBirth: "1984-04-04", email: `twice-p5-${stamp}@test.local` }],
      typedName: "Twice Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const twiceCount = await prisma.waiverRecord.count({
      where: { orgId, waiverGroupId: firstSubmit.waiverGroupId },
    });
    check("T18 double-submit idempotency", secondSubmit.replay === true && twiceCount === 1);

    const signupSrc = readFileSync("src/app/api/auth/signup/route.ts", "utf8");
    check(
      "T19 shop checkout and signup closed",
      existsSync("src/app/(public)/checkout/page.tsx") &&
        existsSync("src/app/(public)/cart/page.tsx") &&
        signupSrc.includes("410")
    );

    const productsAfter = await prisma.product.count({ where: { orgId } });
    const waiverTable = schema.slice(schema.indexOf("model WaiverTemplate"), schema.indexOf("model WaiverTemplateVersion"));
    check(
      "T20 fashion Product is not a waiver template",
      productsAfter === productsBefore &&
        waiverTable.includes("model WaiverTemplate") &&
        !waiverTable.includes("model Product")
    );

    const cronSrc = readFileSync("src/app/api/cron/remind-company-subscriptions/route.ts", "utf8");
    const hardFail = cronSrc.slice(cronSrc.indexOf("const hardFail"), cronSrc.indexOf("if (hardFail)"));
    check(
      "T21 billing remind isolated from waiver remind",
      cronSrc.includes("waiver remind phase") &&
        !hardFail.includes("waiverReminders") &&
        hardFail.includes("remind") &&
        hardFail.includes("invites")
    );

    let financeVoid = 0;
    try {
      await voidWaiverRecord(financeActor, signed.recordIds[0], "finance should not void");
    } catch (err) {
      financeVoid = statusOf(err) ?? 0;
    }
    const financeCsv = await exportWaiverCsv(financeActor, "records");
    let catalogRead = 0;
    try {
      await assertWaiverPermission(catalogActor, P.WaiversRead);
    } catch (err) {
      catalogRead = statusOf(err) ?? 0;
    }
    const waiverGroup = groupPermissionsByFeature(Object.values(P)).find((group) => group.feature === "Waivers");
    const waiverPerms = [
      P.WaiversRead,
      P.WaiversWrite,
      P.WaiversVerify,
      P.WaiversVoid,
      P.WaiversAdmin,
      P.WaiversExport,
    ];
    check(
      "T22 finance export without void; catalog no access",
      financeVoid === 403 &&
        financeCsv.includes("publicRef") &&
        !ROLE_PRESETS.finance.includes(P.WaiversVoid) &&
        ROLE_PRESETS.finance.includes(P.WaiversExport) &&
        catalogRead === 403 &&
        !ROLE_PRESETS.catalog_editor.some((perm) => perm.startsWith("waivers:")) &&
        waiverPerms.every((perm) => waiverGroup?.items.includes(perm))
    );

    const originalHash = signedRow?.signatures[0]?.contentSha256 ?? "";
    const versionId = signedRow?.templateVersionId ?? "";
    let tamperDenied = false;
    try {
      await submitPublicSign(adultLink.token, {
        people: [{ ...adult, email: guestEmail }],
        typedName: "Ada Lovelace",
        intentAccepted: true,
        drawnSignatureSvg: VALID_DRAWN_SVG,
        contentSha256: "0".repeat(64),
      });
    } catch (err) {
      tamperDenied = err instanceof Error && /changed|current version/i.test(err.message);
    }
    if (versionId && originalHash) {
      await prisma.waiverTemplateVersion.update({
        where: { id: versionId },
        data: { contentSha256: "tampered" },
      });
    }
    const sigAfter = await prisma.waiverSignature.findFirst({
      where: { waiverRecordId: signed.recordIds[0] },
    });
    if (versionId && originalHash) {
      await prisma.waiverTemplateVersion.update({
        where: { id: versionId },
        data: { contentSha256: originalHash },
      });
    }
    check(
      "T23 contentSha256 tamper",
      Boolean(originalHash) &&
        sigAfter?.contentSha256 === originalHash &&
        (tamperDenied || replay.replay === true),
      tamperDenied ? "rejected" : "replayed completed link"
    );

    await upsertWaiverSettings(actor, {
      locationId: venue.id,
      maxMinorsPerGuardianSession: 1,
      allowGroupSigning: true,
      allowTypedSignature: true,
      requireIntentCheckbox: true,
    });
    const capLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    let capDenied = false;
    try {
      await submitPublicSign(capLink.token, {
        people: [
          { fullName: "Cap One", dateOfBirth: "2016-04-02" },
          { fullName: "Cap Two", dateOfBirth: "2018-08-09" },
        ],
        guardian: {
          fullName: "Cap Guardian",
          dateOfBirth: "1980-02-02",
          relationship: "parent",
        },
        typedName: "Cap Guardian",
        intentAccepted: true,
        drawnSignatureSvg: VALID_DRAWN_SVG,
        acceptedClauses: {},
        fillMethod: "manual",
      });
    } catch (err) {
      capDenied = err instanceof Error && /guardian can cover/i.test(err.message);
    }
    check("T24 group cap", capDenied);

    const esLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
      locale: "es",
    });
    const esSigned = await submitPublicSign(esLink.token, {
      people: [{ fullName: "Elena Lopez", dateOfBirth: "1991-09-09", email: `es-p5-${stamp}@test.local` }],
      typedName: "Elena Lopez",
      intentAccepted: true,
      locale: "es",
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const esRow = await prisma.waiverRecord.findFirst({
      where: { id: esSigned.recordIds[0] },
      include: { signatures: true },
    });
    const esLocale = version?.locales.some((row) => row.locale === "es");
    check(
      "T25 locale es snapshot",
      esLocale === true && esRow?.locale === "es" && esRow.signatures.some((sig) => sig.locale === "es")
    );

    check("B7 shop still present", existsSync("src/app/(public)/checkout/page.tsx"));
  } finally {
    await prisma.$disconnect();
  }

  if (failed) {
    console.error(`Phase 5 smoke failed: ${failed}`);
    process.exit(1);
  }
  console.log("All Digital Waivers Phase 5 smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
