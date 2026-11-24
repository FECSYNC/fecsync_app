/**
 * Phase 2 Digital Waivers smoke: public sign, guardian, replay, kiosk, SMS honesty.
 *
 *   yarn smoke:waivers:p2
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
  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createWaiverTemplate, publishWaiverTemplate } = await import(
    "../src/lib/waivers/templates.ts"
  );
  const { upsertWaiverSettings } = await import("../src/lib/waivers/settings.ts");
  const { createKioskDevice, listKioskDevices } = await import(
    "../src/lib/waivers/kiosk.ts"
  );
  const { clearCachedStaffGatesForOrg } = await import(
    "../src/lib/ticketing/staffGateCache.ts"
  );
  const { createWaiverRequest, hashWaiverToken, issueSignageLink } = await import(
    "../src/lib/waivers/signToken.ts"
  );
  const { WaiverLinkError } = await import("../src/lib/waivers/signToken.ts");
  const { loadPublicSign, submitPublicSign, submitKioskSign } = await import(
    "../src/lib/waivers/capture.ts"
  );
  const { publicWaiverRateLimit } = await import("../src/lib/waivers/publicHttp.ts");
  const { buildCompanyWorkspaceExport } = await import("../src/lib/companyExport.ts");

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-w2-${stamp}@test.local`,
      password: "x",
      username: `smokew2${stamp}`,
      firstName: "Wav",
      lastName: "Two",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver Sign ${stamp}`,
    slug: `smoke-w2-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };
  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-w2b-${stamp}@test.local`,
      password: "x",
      username: `smokew2b${stamp}`,
      firstName: "Other",
      lastName: "Two",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waiver Other ${stamp}`,
    slug: `smoke-w2b-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = other.organization.id;

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
    clearCachedStaffGatesForOrg(orgId);
    clearCachedStaffGatesForOrg(otherOrgId);

    const venue = await createVenueLocation(actor, {
      name: `Sign Park ${stamp}`,
      slug: `sign-park-${stamp}`,
      timezone: "America/New_York",
    });
    const otherActor = { orgId: otherOrgId, sub: otherUser.id };
    const otherVenue = await createVenueLocation(otherActor, {
      name: `Other Park ${stamp}`,
      slug: `other-park-${stamp}`,
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
    });

    const template = await createWaiverTemplate(actor, {
      name: `Sign Liability ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: "Liability",
      bodyHtml: "<p>I agree to the park rules.</p>",
      localeDefault: "en",
    });
    await publishWaiverTemplate(actor, template.id, {});

    const form = await createWaiverTemplate(actor, {
      name: `Guest note ${stamp}`,
      kind: "custom_form",
      locationId: venue.id,
      title: "Guest note",
      bodyHtml: "<p>Tell us anything we should know.</p>",
      localeDefault: "en",
      fieldsJson: [{ id: "note", type: "text", label: "Note", required: true }],
    });
    await publishWaiverTemplate(actor, form.id, {});

    const otherTemplate = await createWaiverTemplate(otherActor, {
      name: `Other liability ${stamp}`,
      kind: "liability_waiver",
      locationId: otherVenue.id,
      title: "Other",
      bodyHtml: "<p>Other park.</p>",
      localeDefault: "en",
    });
    await publishWaiverTemplate(otherActor, otherTemplate.id, {});

    const guestEmail = `signer-${stamp}@test.local`;
    const usersBefore = await prisma.user.count({ where: { email: guestEmail } });

    const link = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });

    let intentDenied = false;
    try {
      await submitPublicSign(link.token, {
        people: [{ ...adult, email: guestEmail }],
        typedName: "Ada Lovelace",
        intentAccepted: false,
      });
    } catch (err) {
      intentDenied = err instanceof Error && /intend/i.test(err.message);
    }
    check("T13 intent checkbox enforced", intentDenied);

    const signed = await submitPublicSign(
      link.token,
      signBody({
        email: guestEmail,
        intentAccepted: true,
        locale: "en",
      }),
      { ip: "203.0.113.10", userAgent: "smoke-agent", locale: "en" }
    );
    const record = await prisma.waiverRecord.findFirst({
      where: { id: signed.recordIds[0] },
      include: { signatures: true },
    });
    const version = await prisma.waiverTemplateVersion.findFirst({
      where: { id: record?.templateVersionId },
    });
    const sig = record?.signatures[0];
    const usersAfter = await prisma.user.count({ where: { email: guestEmail } });
    const guest = await prisma.guestProfile.findFirst({
      where: { orgId, email: guestEmail },
    });
    check(
      "T1 adult sign sets expiry",
      signed.status === "signed" &&
        Boolean(record?.expiresAt && record.expiresAt.getTime() > Date.now()) &&
        record?.status === "signed" &&
        usersBefore === usersAfter &&
        guest?.userId == null
    );
    check(
      "audit stores intent, name, hash, time, ip hash, agent, locale",
      sig?.intentAccepted === true &&
        sig.typedName === "Ada Lovelace" &&
        sig.contentSha256 === version?.contentSha256 &&
        sig.templateVersionId === version?.id &&
        Boolean(sig.signedAt) &&
        Boolean(sig.timezone) &&
        Boolean(sig.ipHash) &&
        sig.ipHash !== "203.0.113.10" &&
        sig.userAgent === "smoke-agent" &&
        sig.locale === "en" &&
        record?.locale === "en"
    );

    const minorLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    let minorDenied = false;
    try {
      await submitPublicSign(minorLink.token, {
        people: [{ fullName: "Kid Example", dateOfBirth: "2016-04-02", email: "" }],
        typedName: "Kid Example",
        intentAccepted: true,
      });
    } catch (err) {
      minorDenied = err instanceof Error && /guardian/i.test(err.message);
    }
    check("T2 minor without guardian rejected", minorDenied);

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
        email: `guard-${stamp}@test.local`,
      },
      typedName: "Pat Guardian",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const groupRows = await prisma.waiverRecord.findMany({
      where: { waiverGroupId: group.waiverGroupId },
      include: { signers: true },
    });
    check(
      "T3 guardian covers two minors",
      groupRows.length === 2 &&
        groupRows.every(
          (row) =>
            row.status === "signed" &&
            row.signerRole === "guardian" &&
            row.signers.some((signer) => signer.role === "minor") &&
            row.signers.some((signer) => signer.role === "guardian")
        )
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
      await submitPublicSign(expiredLink.token, signBody());
    } catch (err) {
      expiredStatus = statusOf(err) ?? 0;
    }
    check("T4 expired token 410", expiredStatus === 410);

    const beforeReplay = await prisma.waiverRecord.count({
      where: { orgId, waiverGroupId: signed.waiverGroupId },
    });
    const replay = await submitPublicSign(link.token, signBody({ email: guestEmail }));
    const afterReplay = await prisma.waiverRecord.count({
      where: { orgId, waiverGroupId: signed.waiverGroupId },
    });
    check(
      "T5 replay does not double-sign",
      replay.replay === true && beforeReplay === afterReplay && afterReplay === 1
    );

    await prisma.waiverRecord.update({
      where: { id: signed.recordIds[0] },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const resigned = await submitPublicSign(link.token, signBody({ email: guestEmail }));
    check(
      "expired waiver signs a new record",
      resigned.replay === false &&
        resigned.waiverGroupId !== signed.waiverGroupId &&
        resigned.recordIds[0] !== signed.recordIds[0]
    );

    const cross = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    const crossSigned = await submitPublicSign(cross.token, {
      orgId: otherOrgId,
      templateId: otherTemplate.id,
      locationId: otherVenue.id,
      people: [{ fullName: "Cross Guest", dateOfBirth: "1991-03-03", email: `cross-${stamp}@test.local` }],
      typedName: "Cross Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const crossRow = await prisma.waiverRecord.findFirst({
      where: { id: crossSigned.recordIds[0] },
    });
    const otherCount = await prisma.waiverRecord.count({ where: { orgId: otherOrgId } });
    let slugStatus = 0;
    try {
      await loadPublicSign(cross.token, {
        orgSlug: `smoke-w2b-${stamp}`,
        venueSlug: `other-park-${stamp}`,
      });
    } catch (err) {
      slugStatus = err instanceof WaiverLinkError ? err.status : 0;
    }
    check(
      "T6 token cannot sign another org",
      crossRow?.orgId === orgId &&
        crossRow.locationId === venue.id &&
        crossRow.templateId === template.id &&
        otherCount === 0 &&
        slugStatus === 404
    );

    const onsite = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "onsite",
    });
    const onsiteSigned = await submitPublicSign(onsite.token, {
      people: [{ fullName: "On Site Guest", dateOfBirth: "1988-05-05", email: `onsite-${stamp}@test.local` }],
      typedName: "On Site Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const onsiteRow = await prisma.waiverRecord.findFirst({
      where: { id: onsiteSigned.recordIds[0] },
    });
    const onsiteReq = await prisma.waiverRequest.findFirst({
      where: { publicTokenHash: hashWaiverToken(onsite.token) },
    });
    check(
      "T7 staff-assisted onsite",
      onsite.channel === "onsite" &&
        onsiteRow?.channel === "onsite" &&
        onsiteReq?.createdById === user.id &&
        onsiteRow?.signerRole === "adult_self"
    );

    const device = await createKioskDevice(actor, {
      name: `Desk ${stamp}`,
      locationId: venue.id,
      pin: "2468",
      templateIds: [template.id],
    });
    const kioskSigned = await submitKioskSign(
      device.deviceToken ?? "",
      {
        pin: "2468",
        templateId: template.id,
        people: [{ fullName: "Kiosk Guest", dateOfBirth: "1992-06-06" }],
        typedName: "Kiosk Guest",
        intentAccepted: true,
        drawnSignatureSvg: VALID_DRAWN_SVG,
        acceptedClauses: {},
        fillMethod: "manual",
      },
      {}
    );
    const kioskRow =
      "recordIds" in kioskSigned
        ? await prisma.waiverRecord.findFirst({ where: { id: kioskSigned.recordIds[0] } })
        : null;
    const deviceRow = await prisma.waiverKioskDevice.findFirst({ where: { id: device.id } });
    check(
      "T8 kiosk submit",
      kioskRow?.channel === "kiosk" &&
        kioskRow.status === "signed" &&
        deviceRow?.lastSeenAt != null
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
    check(
      "T9 SMS without provider is 400",
      smsMessage === "SMS is not configured" && smsAfter === smsBefore
    );

    const emailed = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      toEmail: `request-${stamp}@test.local`,
      channel: "email_link",
    });
    const emailedRow = await prisma.waiverRequest.findFirst({
      where: { id: emailed.requestId },
    });
    check(
      "T10 email request stores token hash",
      Boolean(emailed.token) &&
        emailed.token !== emailedRow?.publicTokenHash &&
        emailedRow?.publicTokenHash === hashWaiverToken(emailed.token) &&
        (emailed.status === "sent" || emailed.status === "failed")
    );

    const formLink = await createWaiverRequest(actor, {
      templateId: form.id,
      locationId: venue.id,
      channel: "online",
    });
    const formSigned = await submitPublicSign(formLink.token, {
      people: [{ fullName: "Form Guest", dateOfBirth: "1993-07-07", email: `form-${stamp}@test.local` }],
      typedName: "Form Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
      answers: { note: "Allergic to bees" },
    });
    const formResponse = await prisma.formResponse.findFirst({
      where: { orgId, templateId: form.id },
    });
    const payload = formResponse?.payloadJson as { note?: string } | null;
    check(
      "T11 custom form response stored",
      formSigned.recordIds.length === 1 && payload?.note === "Allergic to bees"
    );

    await upsertWaiverSettings(actor, {
      locationId: venue.id,
      allowTypedSignature: false,
      allowDrawnSignature: true,
      requireIntentCheckbox: true,
    });
    const drawnLink = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    let drawnDenied = false;
    try {
      await submitPublicSign(drawnLink.token, {
        people: [{ fullName: "Draw Guest", dateOfBirth: "1994-01-01" }],
        typedName: "Draw Guest",
        intentAccepted: true,
      });
    } catch (err) {
      drawnDenied = err instanceof Error && /drawn/i.test(err.message);
    }
    const drawn = await submitPublicSign(drawnLink.token, {
      people: [{ fullName: "Draw Guest", dateOfBirth: "1994-01-01" }],
      intentAccepted: true,
      drawnSignatureSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="M10 10l40 8"/></svg>',
    });
    const drawnSig = await prisma.waiverSignature.findFirst({
      where: { waiverRecordId: drawn.recordIds[0] },
    });
    check(
      "T12 drawn signature required",
      drawnDenied && Boolean(drawnSig?.drawnSignatureSvg?.includes("<path"))
    );
    await upsertWaiverSettings(actor, {
      locationId: venue.id,
      allowTypedSignature: true,
      allowDrawnSignature: true,
    });

    const tamper = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    let tamperDenied = false;
    try {
      await submitPublicSign(tamper.token, {
        people: [{ fullName: "Tamper Guest", dateOfBirth: "1995-01-01" }],
        typedName: "Tamper Guest",
        intentAccepted: true,
        drawnSignatureSvg: VALID_DRAWN_SVG,
        templateVersionId: "not-the-published-version",
      });
    } catch (err) {
      tamperDenied = err instanceof Error && /version/i.test(err.message);
    }
    let hashDenied = false;
    try {
      await submitPublicSign(tamper.token, {
        people: [{ fullName: "Tamper Guest", dateOfBirth: "1995-01-01" }],
        typedName: "Tamper Guest",
        intentAccepted: true,
        drawnSignatureSvg: VALID_DRAWN_SVG,
        contentSha256: "0".repeat(64),
      });
    } catch (err) {
      hashDenied = err instanceof Error && /changed|version/i.test(err.message);
    }
    check("T14 tampered version rejected", tamperDenied && hashDenied);

    const qr = await issueSignageLink(actor, template.id, venue.id);
    const qrSigned = await submitPublicSign(qr.token, {
      people: [{ fullName: "QR Guest", dateOfBirth: "1996-01-01" }],
      typedName: "QR Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const qrRow = await prisma.waiverRecord.findFirst({
      where: { id: qrSigned.recordIds[0] },
    });
    check("standing QR signs a guest", qrRow?.channel === "qr" && qrRow.orgId === orgId);
    const signageRow = await prisma.waiverSignageToken.findFirst({
      where: { orgId, templateId: template.id, locationId: venue.id },
    });
    check(
      "signage token is stored as a hash",
      Boolean(qr.token) &&
        signageRow?.tokenHash === hashWaiverToken(qr.token) &&
        signageRow.tokenHash !== qr.token
    );

    const listed = await listKioskDevices(actor);
    const listedDevice = listed.find((row) => row.id === device.id);
    check(
      "kiosk list does not re-expose pin or device token",
      Boolean(listedDevice) &&
        !("pinHash" in (listedDevice ?? {})) &&
        !("deviceToken" in (listedDevice ?? {})) &&
        !("deviceTokenHash" in (listedDevice ?? {}))
    );

    const bilingual = await createWaiverTemplate(actor, {
      name: `Bilingual ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: "Liability",
      bodyHtml: "<p>I agree to the park rules.</p>",
      localeDefault: "en",
      locales: [
        { locale: "es", title: "Responsabilidad", bodyHtml: "<p>Acepto las reglas.</p>" },
      ],
    });
    await publishWaiverTemplate(actor, bilingual.id, {});
    const esLink = await createWaiverRequest(actor, {
      templateId: bilingual.id,
      locationId: venue.id,
      channel: "online",
      locale: "es",
    });
    const esSigned = await submitPublicSign(esLink.token, {
      people: [{ fullName: "Elena Guest", dateOfBirth: "1991-02-02" }],
      typedName: "Elena Guest",
      intentAccepted: true,
      locale: "es",
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const esRecord = await prisma.waiverRecord.findFirst({
      where: { id: esSigned.recordIds[0] },
      include: { signatures: true },
    });
    const esVersion = await prisma.waiverTemplateVersion.findFirst({
      where: { id: esRecord?.templateVersionId },
    });
    const esLocale = await prisma.waiverTemplateLocale.findFirst({
      where: { versionId: esVersion?.id ?? "", locale: "es" },
    });
    check(
      "signed snapshot uses the chosen locale",
      esRecord?.locale === "es" &&
        esRecord.signatures[0]?.locale === "es" &&
        esRecord.signatures[0]?.contentSha256 === esVersion?.contentSha256 &&
        Boolean(esLocale?.bodyHtml.includes("Acepto"))
    );

    const contract = await createWaiverTemplate(actor, {
      name: `Membership ${stamp}`,
      kind: "membership_contract",
      locationId: venue.id,
      title: "Membership agreement",
      bodyHtml: "<p>I agree to the membership terms.</p>",
      localeDefault: "en",
    });
    await publishWaiverTemplate(actor, contract.id, {});
    const contractLink = await createWaiverRequest(actor, {
      templateId: contract.id,
      locationId: venue.id,
      channel: "online",
    });
    const contractSigned = await submitPublicSign(contractLink.token, {
      people: [{ fullName: "Member Guest", dateOfBirth: "1985-03-03" }],
      typedName: "Member Guest",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN_SVG,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    const contractRow = await prisma.waiverRecord.findFirst({
      where: { id: contractSigned.recordIds[0] },
      include: { signatures: true },
    });
    check(
      "membership contract uses the signing engine",
      contractRow?.status === "signed" &&
        contractRow.templateId === contract.id &&
        Boolean(contractRow.signatures[0]?.contentSha256)
    );

    const inquiry = await createWaiverTemplate(actor, {
      name: `Inquiry ${stamp}`,
      kind: "inquiry",
      locationId: venue.id,
      title: "Ask us",
      bodyHtml: "<p>How can we help?</p>",
      localeDefault: "en",
      fieldsJson: [{ id: "question", type: "text", label: "Question", required: true }],
    });
    await publishWaiverTemplate(actor, inquiry.id, {});
    const inquiryLink = await createWaiverRequest(actor, {
      templateId: inquiry.id,
      locationId: venue.id,
      channel: "online",
    });
    const inquiryBody = {
      people: [{ fullName: "Ask Guest", email: `ask-${stamp}@test.local` }],
      answers: { question: "What time do you open?" },
    };
    await submitPublicSign(inquiryLink.token, inquiryBody);
    const inquiryCount = await prisma.formResponse.count({
      where: { orgId, templateId: inquiry.id },
    });
    const inquiryReplay = await submitPublicSign(inquiryLink.token, inquiryBody);
    const inquiryCountAfter = await prisma.formResponse.count({
      where: { orgId, templateId: inquiry.id },
    });
    const inquiryRecords = await prisma.waiverRecord.count({
      where: { orgId, templateId: inquiry.id },
    });
    check(
      "inquiry is stored once without a signature record",
      inquiryCount === 1 &&
        inquiryCountAfter === 1 &&
        inquiryReplay.replay === true &&
        inquiryRecords === 0
    );

    const hold = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: "suspended" },
    });
    clearCachedStaffGatesForOrg(orgId);
    let suspendedStatus = 0;
    try {
      await submitPublicSign(hold.token, signBody());
    } catch (err) {
      suspendedStatus = statusOf(err) ?? 0;
    }
    check("T15 suspended org cannot public-sign", suspendedStatus === 403);
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: "active" },
    });
    clearCachedStaffGatesForOrg(orgId);

    const gated = await createWaiverRequest(actor, {
      templateId: template.id,
      locationId: venue.id,
      channel: "online",
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "demo" },
    });
    clearCachedStaffGatesForOrg(orgId);
    let demoStatus = 0;
    try {
      await submitPublicSign(gated.token, signBody());
    } catch (err) {
      demoStatus = statusOf(err) ?? 0;
    }
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "growth", subscriptionStatus: "canceled" },
    });
    clearCachedStaffGatesForOrg(orgId);
    let unpaidStatus = 0;
    try {
      await submitPublicSign(gated.token, signBody());
    } catch (err) {
      unpaidStatus = statusOf(err) ?? 0;
    }
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "growth", subscriptionStatus: "active" },
    });
    clearCachedStaffGatesForOrg(orgId);
    check("demo org cannot collect a signature", demoStatus === 403);
    check("unpaid org cannot collect a signature", unpaidStatus === 403);

    const rateIp = `198.51.100.${stamp % 200}`;
    let blocked: { status?: number } | null = null;
    for (let i = 0; i < 41; i += 1) {
      const res = publicWaiverRateLimit(
        new Request("http://localhost/api/public/waivers/sign/x", {
          headers: { "x-forwarded-for": rateIp },
        }) as never
      );
      if (res) blocked = res;
    }
    check("public sign rate limit returns 429", blocked?.status === 429);

    const exported = JSON.stringify(await buildCompanyWorkspaceExport(orgId));
    check(
      "company export omits signature media and token hashes",
      !exported.includes("drawnSignature") &&
        !exported.includes("<svg") &&
        !exported.includes("pinHash") &&
        !exported.includes("deviceTokenHash") &&
        !exported.includes("publicTokenHash")
    );

    const kioskSrc = readFileSync("src/components/waivers/KioskWaiverScreen.tsx", "utf8");
    const kioskPage = readFileSync("src/app/kiosk/waivers/[deviceToken]/page.tsx", "utf8");
    check(
      "waiver kiosk is signing-only",
      !/cart|checkout|addToCart/i.test(kioskSrc) &&
        !/cart|checkout/i.test(kioskPage) &&
        !existsSync("src/app/api/check-in") &&
        !existsSync("src/app/(admin)/admin/check-in")
    );
    const product = await prisma.product.findFirst({ select: { name: true } });
    check(
      "T16 shop checkout still present",
      existsSync("src/app/(public)/checkout/page.tsx") &&
        (product == null || typeof product.name === "string")
    );

    const svgLog = await prisma.activityLog.findFirst({
      where: {
        orgId,
        action: "waiver.sign.complete",
        description: { contains: signed.publicRefs[0] ?? "___" },
      },
    });
    const meta = JSON.stringify(svgLog?.metadata ?? {});
    check("activity log omits signature SVG", !meta.includes("<svg") && !meta.includes("drawnSignature"));
  } finally {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll Digital Waivers Phase 2 smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
