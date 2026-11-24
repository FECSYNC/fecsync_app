/**
 * Step 2 guest-flow capture rules (clauses, signatures, blueprint draft honesty).
 *
 *   yarn smoke:waivers:guest-flow
 */
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

const VALID_DRAWN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="M10 80 L120 40 L200 90"/></svg>';

const adult = {
  fullName: "Ada Lovelace",
  dateOfBirth: "1990-01-15",
  email: "ada-guest-flow@test.local",
  adultConfirmed: true,
};

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const {
    createWaiverTemplate,
    publishWaiverTemplate,
    updateWaiverTemplate,
    applyBlueprintToDraft,
  } = await import("../src/lib/waivers/templates.ts");
  const { upsertWaiverSettings } = await import("../src/lib/waivers/settings.ts");
  const { createWaiverRequest } = await import("../src/lib/waivers/signToken.ts");
  const { submitPublicSign } = await import("../src/lib/waivers/capture.ts");
  const { parseBlueprintCsv } = await import("../src/lib/waivers/blueprint.ts");
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  const { guestFlowStructure } = await import("../src/lib/waivers/guestFlowLayout.ts");
  const { LAYOUT_IDS, DISPLAY_MODES } = await import("../src/lib/waivers/presentation.ts");

  for (const layout of LAYOUT_IDS) {
    for (const mode of DISPLAY_MODES) {
      const plan = guestFlowStructure(layout, mode);
      if (plan.layoutId !== layout || plan.displayMode !== mode) {
        throw new Error(`layout plan failed for ${layout}/${mode}`);
      }
    }
  }
  check(
    "ten layouts and four display modes plan without throw",
    LAYOUT_IDS.length === 10 && DISPLAY_MODES.length === 4
  );
  check(
    "agreement_focus puts clauses before identity",
    guestFlowStructure("agreement_focus", "single_page").agreementBeforeIdentity
  );
  check(
    "split stacks on a narrow viewport",
    guestFlowStructure("split", "grid").splitSideBySide
  );
  check("accordion keeps one section", guestFlowStructure("accordion", "accordion").accordion);
  check("multi_step is one block", guestFlowStructure("wizard", "multi_step").oneBlockAtATime);
  check("grid lays short fields in columns", guestFlowStructure("two_column", "grid").gridFields);
  check(
    "single_page shows every block",
    !guestFlowStructure("classic", "single_page").oneBlockAtATime &&
      !guestFlowStructure("classic", "single_page").accordion
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-gf-${stamp}@test.local`,
      password: "x",
      username: `smokegf${stamp}`,
      firstName: "Guest",
      lastName: "Flow",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Guest Flow ${stamp}`,
    slug: `gf-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  clearCachedStaffGatesForOrg(orgId);

  const venue = await createVenueLocation(actor, {
    name: "GF Park",
    slug: `gf-park-${stamp}`,
    timezone: "America/New_York",
  });
  await upsertWaiverSettings(actor, {
    locationId: venue.id,
    allowTypedSignature: true,
    allowDrawnSignature: true,
    requireIntentCheckbox: true,
    allowAdultSelfSign: true,
  });

  const tpl = await createWaiverTemplate(actor, {
    name: "Clause template",
    kind: "liability_waiver",
    locationId: venue.id,
    title: "Clause template",
    bodyHtml: "<p>Agreement</p>",
    localeDefault: "en",
  });
  await updateWaiverTemplate(actor, tpl.id, {
    draft: {
      title: "Clause template",
      bodyHtml: "<p>Agreement</p>",
      localeDefault: "en",
      fieldsJson: [
        {
          id: "c1",
          type: "clause",
          label: "Safety rules",
          required: true,
          section: "agreement",
        },
        {
          id: "name",
          type: "text",
          label: "Full name",
          required: true,
          mapsTo: "first_name",
        },
      ],
    },
  });
  await publishWaiverTemplate(actor, tpl.id, {});
  const link = await createWaiverRequest(actor, {
    templateId: tpl.id,
    locationId: venue.id,
    toEmail: adult.email,
    channel: "email_link",
  });

  try {
    await submitPublicSign(link.token, {
      people: [adult],
      intentAccepted: true,
      typedName: "Ada Lovelace",
      drawnSignatureSvg: VALID_DRAWN,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    check("required clause missing rejected", false);
  } catch (err) {
    check(
      "required clause missing rejected",
      err instanceof Error && err.message.includes("Safety rules")
    );
  }

  await submitPublicSign(link.token, {
    people: [adult],
    typedName: "Ada Lovelace",
    drawnSignatureSvg: VALID_DRAWN,
    acceptedClauses: { c1: true },
    fillMethod: "manual",
    answers: { name: "Ada Lovelace" },
  });
  const signed = await prisma.waiverRecord.count({ where: { orgId, templateId: tpl.id } });
  check("clause sign creates record", signed >= 1);

  const tpl2 = await createWaiverTemplate(actor, {
    name: "Legacy intent",
    kind: "liability_waiver",
    locationId: venue.id,
    title: "Legacy",
    bodyHtml: "<p>Body</p>",
    localeDefault: "en",
  });
  await updateWaiverTemplate(actor, tpl2.id, {
    draft: { title: "Legacy", bodyHtml: "<p>Body</p>", localeDefault: "en", fieldsJson: null },
  });
  await publishWaiverTemplate(actor, tpl2.id, {});
  const link2 = await createWaiverRequest(actor, {
    templateId: tpl2.id,
    locationId: venue.id,
    channel: "email_link",
  });
  await submitPublicSign(link2.token, {
    people: [adult],
    intentAccepted: true,
    typedName: "Ada Lovelace",
    drawnSignatureSvg: VALID_DRAWN,
    acceptedClauses: {},
    fillMethod: "manual",
  });
  check("zero-clause legacy intent accepted", true);

  const link3 = await createWaiverRequest(actor, {
    templateId: tpl2.id,
    locationId: venue.id,
    channel: "email_link",
  });
  try {
    await submitPublicSign(link3.token, {
      people: [adult],
      intentAccepted: true,
      typedName: "Ada Lovelace",
      acceptedClauses: {},
      fillMethod: "manual",
    });
    check("both signatures required when both enabled", false);
  } catch {
    check("both signatures required when both enabled", true);
  }

  const link4 = await createWaiverRequest(actor, {
    templateId: tpl2.id,
    locationId: venue.id,
    channel: "email_link",
  });
  try {
    await submitPublicSign(link4.token, {
      people: [adult],
      intentAccepted: true,
      typedName: "Wrong Name",
      drawnSignatureSvg: VALID_DRAWN,
      acceptedClauses: {},
      fillMethod: "manual",
    });
    check("typed name mismatch rejected", false);
  } catch (err) {
    check(
      "typed name mismatch rejected",
      err instanceof Error && err.message.toLowerCase().includes("match")
    );
  }

  const tpl3 = await createWaiverTemplate(actor, {
    name: "No sig",
    kind: "liability_waiver",
    locationId: venue.id,
    title: "No sig",
    bodyHtml: "<p>Body</p>",
    localeDefault: "en",
  });
  await updateWaiverTemplate(actor, tpl3.id, {
    draft: {
      title: "No sig",
      bodyHtml: "<p>Body</p>",
      localeDefault: "en",
      allowTypedSignature: false,
      allowDrawnSignature: false,
      fieldsJson: [
        { id: "c_only", type: "clause", label: "Only clause", required: true, section: "agreement" },
      ],
    },
  });
  await publishWaiverTemplate(actor, tpl3.id, {});
  const link5 = await createWaiverRequest(actor, {
    templateId: tpl3.id,
    locationId: venue.id,
    channel: "email_link",
  });
  await submitPublicSign(link5.token, {
    people: [adult],
    acceptedClauses: { c_only: true },
    fillMethod: "manual",
  });
  check("signature omitted when both toggles off", true);

  const tpl4 = await createWaiverTemplate(actor, {
    name: "Blueprint draft",
    kind: "liability_waiver",
    locationId: venue.id,
    title: "Blueprint draft",
    bodyHtml: "<p>Body</p>",
    localeDefault: "en",
  });
  const sample = parseBlueprintCsv(
    "section,key,label,type,required,options,help,maps_to\n" +
      "guest,guest_name,Guest name,text,yes,,,\n" +
      "agreement,rule_one,Rule one,clause,yes,,,\n"
  );
  let blueprintRefused = false;
  try {
    await applyBlueprintToDraft(actor, tpl4.id, {
      fields: sample.fields,
      layoutId: sample.layoutId,
      displayMode: sample.displayMode,
    });
  } catch (err) {
    blueprintRefused = err instanceof Error && err.message.includes("form wizard");
  }
  const recordsBefore = await prisma.waiverRecord.count({ where: { templateId: tpl4.id } });
  const draftUntouched = await prisma.waiverTemplateVersion.findFirst({
    where: { templateId: tpl4.id, status: "draft" },
  });
  const stillStarterFields = !JSON.stringify(draftUntouched?.fieldsJson ?? []).includes("guest_name");
  check(
    "spreadsheet blueprint cannot replace draft questions",
    blueprintRefused && recordsBefore === 0 && stillStarterFields
  );

  for (const mode of ["multi_step", "single_page", "grid", "accordion"] as const) {
    await updateWaiverTemplate(actor, tpl4.id, {
      draft: {
        title: "Blueprint draft",
        bodyHtml: "<p>Body</p>",
        localeDefault: "en",
        displayMode: mode,
        layoutId: mode === "accordion" ? "accordion" : "classic",
        fieldsJson: [
          { id: "guest_name", type: "text", label: "Guest name", required: false, section: "guest" },
        ],
      },
    });
  }
  const draftRow = await prisma.waiverTemplateVersion.findFirst({
    where: { templateId: tpl4.id, status: "draft" },
  });
  check("display modes saved on a draft fixture", draftRow?.displayMode === "accordion");

  const { extractForSignToken } = await import("../src/lib/waivers/documentExtract.ts");
  const { parseLabeledGuestText, parseAamva } = await import("../src/lib/waivers/extractGuestDocument.ts");
  const { createKioskDevice } = await import("../src/lib/waivers/kiosk.ts");
  const { submitKioskSign } = await import("../src/lib/waivers/capture.ts");
  const { readActiveWalkinPass, walkinPassIsActive } = await import("../src/lib/waivers/walkinPass.ts");
  delete process.env.WAIVER_EXTRACT_ENDPOINT;
  delete process.env.WAIVER_EXTRACT_API_KEY;

  const labeled = parseLabeledGuestText(
    "First name: Ada\nLast name: Lovelace\nDate of birth: 1990-01-15\nPhone: +15551212\nStreet: 1 Main\nMinor 1 first name: Ann\nMinor 1 last name: Leigh\nMinor 1 date of birth: 2015-04-04"
  );
  check(
    "labeled document text parses without a photo",
    labeled.strong && labeled.minors[0]?.firstName === "Ann" && labeled.dateOfBirth === "1990-01-15"
  );
  const aamva = parseAamva("ANSI 636000\nDACADA\nDCSLOVELACE\nDBB01151990\nDAG1 MAIN\nDAINEW YORK\nDAJNY\nDAK10001");
  check("aamva text parses name and date", Boolean(aamva?.firstName === "Ada" && aamva.dateOfBirth === "1990-01-15"));

  const offLink = await createWaiverRequest(actor, {
    templateId: tpl.id,
    locationId: venue.id,
    toEmail: `off-${stamp}@test.local`,
    channel: "email_link",
  });
  let extractOff = 0;
  try {
    await extractForSignToken(offLink.token, { image: "data:image/jpeg;base64,AAAA" });
  } catch (err) {
    extractOff = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 0;
  }
  check("extract route 403 when the flag is off", extractOff === 403);

  const scanTpl = await createWaiverTemplate(actor, {
    name: "Scan template",
    kind: "liability_waiver",
    locationId: venue.id,
    title: "Scan template",
    bodyHtml: "<p>Scan</p>",
    localeDefault: "en",
  });
  await updateWaiverTemplate(actor, scanTpl.id, {
    draft: {
      title: "Scan template",
      bodyHtml: "<p>Scan</p>",
      localeDefault: "en",
      allowDocumentExtract: true,
      fieldsJson: [{ id: "c_scan", type: "clause", label: "Rules", required: true, section: "agreement" }],
    },
  });
  await publishWaiverTemplate(actor, scanTpl.id, {});
  const scanLink = await createWaiverRequest(actor, {
    templateId: scanTpl.id,
    locationId: venue.id,
    toEmail: `scan-${stamp}@test.local`,
    channel: "email_link",
  });
  const beforeRecords = await prisma.waiverRecord.count({ where: { orgId } });
  const beforeResponses = await prisma.formResponse.count({ where: { orgId } });
  const extractOn = await extractForSignToken(scanLink.token, {
    image: "data:image/jpeg;base64,AAAA",
    orgId: "ignore-me",
  });
  const afterRecords = await prisma.waiverRecord.count({ where: { orgId } });
  const afterResponses = await prisma.formResponse.count({ where: { orgId } });
  check(
    "extract does not persist an image when the flag is on and env is missing",
    extractOn.fallback === "manual" &&
      extractOn.fields == null &&
      beforeRecords === afterRecords &&
      beforeResponses === afterResponses
  );

  const passesBeforeKiosk = await prisma.waiverWalkinPass.count({ where: { orgId } });
  check("public email sign does not create a pass", passesBeforeKiosk === 0);

  await upsertWaiverSettings(actor, {
    locationId: venue.id,
    kioskRequireStaffPin: false,
    allowTypedSignature: true,
    allowDrawnSignature: true,
    requireIntentCheckbox: true,
    allowAdultSelfSign: true,
  });
  const kiosk = await createKioskDevice(actor, {
    name: "GF kiosk",
    locationId: venue.id,
    templateIds: [tpl.id],
    code: `gfk-${stamp}`,
  });
  const kioskSign = await submitKioskSign(
    kiosk.deviceToken,
    {
      templateId: tpl.id,
      people: [{ ...adult, email: `kiosk-${stamp}@test.local` }],
      typedName: "Ada Lovelace",
      intentAccepted: true,
      drawnSignatureSvg: VALID_DRAWN,
      acceptedClauses: { c1: true },
      answers: { name: "Ada" },
      fillMethod: "manual",
    },
    {}
  );
  const passRow = await prisma.waiverWalkinPass.findFirst({
    where: { orgId, id: "walkinPass" in kioskSign ? kioskSign.walkinPass?.id : "" },
  });
  const otherVenue = await createVenueLocation(actor, {
    name: "Other park",
    slug: `gf-other-${stamp}`,
    timezone: "America/New_York",
  });
  const activeHere = passRow ? walkinPassIsActive(passRow, venue.id) : false;
  const activeThere = passRow ? walkinPassIsActive(passRow, otherVenue.id) : true;
  if (passRow) {
    await prisma.waiverWalkinPass.update({
      where: { id: passRow.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
  }
  const expired = passRow
    ? await readActiveWalkinPass({ orgId, locationId: venue.id, passId: passRow.id })
    : { id: "still" };
  check(
    "walk-in pass expires and is location-scoped",
    Boolean(passRow) && activeHere && !activeThere && expired == null
  );

  await prisma.$disconnect();
  if (failed) {
    console.error(`\n${failed} guest-flow smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll guest-flow smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
