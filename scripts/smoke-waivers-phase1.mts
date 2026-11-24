/**
 * Phase 1 Digital Waivers smoke:
 * Growth publish + sha256, Starter/Demo/storefront deny, cross-tenant deny,
 * settings uniqueness, evaluate missing, signup still closed, shop Product untouched.
 *
 *   yarn smoke:waivers:p1
 */
import { existsSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

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
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { DEMO_FEATURE_LOCKED_MESSAGE } = await import(
    "../src/lib/demoPlanLock.ts"
  );
  const { assertWaiversEnabled } = await import("../src/lib/waivers/assert.ts");
  const { planAllowsModule, SHIPPED_MODULE_HINT_IDS } = await import(
    "../src/lib/subscriptionPlans.ts"
  );
  const {
    createWaiverTemplate,
    publishWaiverTemplate,
    updateWaiverTemplate,
    requireTemplate,
    listTemplateVersions,
  } = await import("../src/lib/waivers/templates.ts");
  const { createWaiverRequirement } = await import(
    "../src/lib/waivers/requirements.ts"
  );
  const { upsertWaiverSettings, getWaiverSettings } = await import(
    "../src/lib/waivers/settings.ts"
  );
  const { createKioskDevice } = await import("../src/lib/waivers/kiosk.ts");
  const { clearCachedLocationScopesForOrg } = await import(
    "../src/lib/ticketing/staffGateCache.ts"
  );
  const { evaluateGuestWaivers } = await import(
    "../src/lib/waivers/evaluateWaiver.ts"
  );
  const { waiverContentSha256 } = await import("../src/lib/waivers/contentHash.ts");
  const { computeWaiverExpiresAt, isSignedWaiverCurrentlyValid } = await import(
    "../src/lib/waivers/expiry.ts"
  );
  const { sanitizeWaiverHtml } = await import("../src/lib/waivers/sanitizeHtml.ts");
  const { clearCachedStaffGatesForOrg } = await import(
    "../src/lib/ticketing/staffGateCache.ts"
  );
  const { CLIENT_SIGNUP_CLOSED_MESSAGE, POST: signupPost } = await import(
    "../src/app/api/auth/signup/route.ts"
  );

  check(
    "shipped-hints-include-waivers",
    (SHIPPED_MODULE_HINT_IDS as readonly string[]).includes("waivers")
  );
  check("plan-growth-allows-waivers", planAllowsModule("growth", "waivers"));
  check("plan-enterprise-allows-waivers", planAllowsModule("enterprise", "waivers"));
  check("plan-starter-no-waivers", !planAllowsModule("starter", "waivers"));
  check("plan-demo-no-waivers", !planAllowsModule("demo", "waivers"));
  const { adminWarmHrefFromPathname } = await import("../src/lib/adminNav.ts");
  check(
    "waiver template warm href stays on templates",
    adminWarmHrefFromPathname("/admin/waivers/templates/abc") ===
      "/admin/waivers/templates"
  );
  check(
    "membership warm href unchanged",
    adminWarmHrefFromPathname("/admin/memberships/plans") ===
      "/admin/memberships/plans"
  );
  check(
    "ticketing product warm href unchanged",
    adminWarmHrefFromPathname("/admin/ticketing/products/abc") ===
      "/admin/ticketing"
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-wav-${stamp}@test.local`,
      password: "x",
      username: `smokewav${stamp}`,
      firstName: "Wav",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Waivers Co ${stamp}`,
    slug: `smoke-wav-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };

  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-wav-other-${stamp}@test.local`,
      password: "x",
      username: `smokewavo${stamp}`,
      firstName: "Other",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke Wav Other ${stamp}`,
    slug: `smoke-wav-other-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = otherOrg.organization.id;

  try {
    let unpaidDenied = false;
    try {
      await assertWaiversEnabled(orgId);
    } catch (err) {
      unpaidDenied = err instanceof ForbiddenError;
    }
    check("unpaid org deny waivers", unpaidDenied);

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
    await assertWaiversEnabled(orgId);
    check("growth entitled allow", true);

    await prisma.organization.update({
      where: { id: otherOrgId },
      data: {
        status: "active",
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    clearCachedStaffGatesForOrg(otherOrgId);
    const otherActor = { orgId: otherOrgId, sub: otherUser.id };

    const venue = await createVenueLocation(actor, {
      name: `Wav Park ${stamp}`,
      slug: `wav-park-${stamp}`,
      timezone: "America/New_York",
    });

    const dirty = `<script>alert(1)</script><p>I agree.</p>`;
    const template = await createWaiverTemplate(actor, {
      name: `Liability ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: `Liability ${stamp}`,
      bodyHtml: dirty,
      localeDefault: "en",
      locales: [
        {
          locale: "es",
          title: "Exencion",
          bodyHtml: "<p>Acepto.</p>",
        },
      ],
    });
    check("create template", Boolean(template.id));

    let orgFieldDenied = false;
    try {
      await createWaiverTemplate(actor, {
        orgId: otherOrgId,
        name: `Nope ${stamp}`,
        kind: "liability_waiver",
        title: "Nope",
        bodyHtml: "<p>No</p>",
        localeDefault: "en",
      });
    } catch (err) {
      orgFieldDenied = err instanceof ForbiddenError;
    }
    check("client orgId rejected", orgFieldDenied);

    let slugDenied = false;
    try {
      await createWaiverTemplate(actor, {
        name: `Dup ${stamp}`,
        slug: template.slug,
        kind: "liability_waiver",
        title: "Dup",
        bodyHtml: "<p>Dup</p>",
        localeDefault: "en",
      });
    } catch (err) {
      slugDenied =
        err instanceof Error && err.message.toLowerCase().includes("slug");
    }
    check("duplicate slug rejected", slugDenied);

    const published = await publishWaiverTemplate(actor, template.id, {});
    check("publish template", published.status === "published");
    const versions = await listTemplateVersions(actor, template.id);
    const live = versions.find((v) => v.status === "published");
    check(
      "sha256 set",
      Boolean(live?.contentSha256 && live.contentSha256.length === 64)
    );
    check(
      "html sanitized",
      Boolean(live && !live.bodyHtml.toLowerCase().includes("<script") && live.bodyHtml.includes("I agree"))
    );
    check(
      "locale stored",
      Boolean(live?.locales.some((l) => l.locale === "es"))
    );

    let publishedEditDenied = false;
    try {
      await updateWaiverTemplate(actor, template.id, {
        draft: { title: "Nope", bodyHtml: "<p>Changed</p>", localeDefault: "en" },
      });
    } catch (err) {
      publishedEditDenied =
        err instanceof Error && err.message.includes("new draft version");
    }
    check("published body immutable", publishedEditDenied);
    const after = await listTemplateVersions(actor, template.id);
    check(
      "published html unchanged",
      after.find((v) => v.id === live?.id)?.bodyHtml === live?.bodyHtml
    );

    const form = await createWaiverTemplate(actor, {
      name: `Form ${stamp}`,
      kind: "custom_form",
      locationId: venue.id,
      title: `Form ${stamp}`,
      bodyHtml: "<p>Notes</p>",
      localeDefault: "en",
      fieldsJson: [
        { id: "notes", type: "textarea", label: "Notes", required: false, options: [] },
      ],
    });
    await updateWaiverTemplate(actor, form.id, {
      draft: {
        title: `Form ${stamp}`,
        bodyHtml: "<p>Notes</p>",
        localeDefault: "en",
      },
    });
    const formVersions = await listTemplateVersions(actor, form.id);
    const formDraft = formVersions.find((v) => v.status === "draft");
    const localeFields = formDraft?.locales.find((l) => l.locale === "en")?.fieldsJson;
    const storedFields = Array.isArray(formDraft?.fieldsJson)
      ? (formDraft.fieldsJson as { id?: string; type?: string; label?: string }[])
      : [];
    const storedLocale = Array.isArray(localeFields)
      ? (localeFields as { id?: string }[])
      : [];
    check(
      "draft save keeps form fields",
      storedFields.length === 1 &&
        storedFields[0]?.id === "notes" &&
        storedFields[0]?.type === "textarea" &&
        storedFields[0]?.label === "Notes" &&
        storedLocale.length === 1 &&
        storedLocale[0]?.id === "notes"
    );
    const recomputed = formDraft
      ? waiverContentSha256({
          kind: "custom_form",
          bodyHtml: formDraft.bodyHtml,
          fieldsJson: formDraft.fieldsJson,
          locales: formDraft.locales.map((row) => ({
            locale: row.locale,
            title: row.title,
            bodyHtml: row.bodyHtml,
            fieldsJson: row.fieldsJson,
          })),
        })
      : "";
    check(
      "content hash matches stored fields",
      Boolean(formDraft?.contentSha256) && recomputed === formDraft?.contentSha256
    );

    let daysDenied = false;
    try {
      await updateWaiverTemplate(actor, template.id, { defaultExpiryRule: "days" });
    } catch (err) {
      daysDenied =
        err instanceof Error && err.message.includes("defaultExpiryDays");
    }
    check("days rule requires a day count", daysDenied);

    const venueB = await createVenueLocation(actor, {
      name: `Wav Park B ${stamp}`,
      slug: `wav-park-b-${stamp}`,
      timezone: "America/Chicago",
    });
    let crossReq = false;
    try {
      await createWaiverRequirement(actor, {
        templateId: template.id,
        locationId: venueB.id,
        targetType: "all_admissions",
      });
    } catch (err) {
      crossReq = err instanceof Error && err.message.includes("same venue");
    }
    check("requirement stays on the template venue", crossReq);

    await createWaiverRequirement(actor, {
      templateId: template.id,
      locationId: venue.id,
      targetType: "all_admissions",
    });
    let dupReq = false;
    try {
      await createWaiverRequirement(actor, {
        templateId: template.id,
        locationId: venue.id,
        targetType: "all_admissions",
      });
    } catch (err) {
      dupReq = err instanceof Error && err.message.includes("already exists");
    }
    check("duplicate requirement rejected", dupReq);

    let crossKiosk = false;
    try {
      await createKioskDevice(actor, {
        name: "Other desk",
        locationId: venueB.id,
        templateIds: [template.id],
      });
    } catch (err) {
      crossKiosk =
        err instanceof Error && err.message.includes("own venue");
    }
    check("kiosk cannot take another venue template", crossKiosk);

    const kiosk = await createKioskDevice(actor, {
      name: "Front desk",
      locationId: venue.id,
      templateIds: [template.id, template.id],
    });
    check(
      "kiosk stores the published template once",
      kiosk.templateIds.length === 1 && kiosk.templateIds[0] === template.id
    );

    await updateWaiverTemplate(actor, template.id, { status: "archived" });
    const archivedDevice = await prisma.waiverKioskDevice.findFirst({
      where: { id: kiosk.id },
      select: { templateIds: true },
    });
    const detached = Array.isArray(archivedDevice?.templateIds)
      ? archivedDevice.templateIds
      : [];
    check("archive detaches kiosk template", !detached.includes(template.id));

    const safe = sanitizeWaiverHtml(dirty);
    check("sanitizer strips script", !safe.toLowerCase().includes("script"));

    await upsertWaiverSettings(actor, {
      locationId: null,
      jurisdictionCode: "US-FL",
      ageOfMajorityYears: 18,
      expiryRule: "calendar_year",
    });
    await upsertWaiverSettings(actor, {
      locationId: null,
      jurisdictionCode: "US-TX",
      ageOfMajorityYears: 18,
      expiryRule: "days",
      expiryDays: 30,
    });
    const settingsCount = await prisma.waiverSettings.count({
      where: { orgId, locationId: null },
    });
    const settings = await getWaiverSettings(actor, null);
    check("settings unique org default", settingsCount === 1 && settings.jurisdictionCode === "US-TX");
    const partial = await upsertWaiverSettings(actor, {
      locationId: null,
      jurisdictionCode: "US-CA",
    });
    check(
      "partial settings keep expiry",
      partial.jurisdictionCode === "US-CA" &&
        partial.expiryRule === "days" &&
        partial.expiryDays === 30 &&
        partial.allowTypedSignature === true
    );

    let ageDenied = false;
    try {
      await upsertWaiverSettings(actor, {
        locationId: null,
        ageOfMajorityYears: 0,
        jurisdictionCode: "US-FL",
        expiryRule: "never",
      });
    } catch (err) {
      ageDenied = err instanceof Error && err.message.includes("ageOfMajorityYears");
    }
    check("age of majority range", ageDenied);

    const guest = await prisma.guestProfile.create({
      data: {
        orgId,
        locationId: venue.id,
        firstName: "Ada",
        lastName: "Guest",
        email: `ada-wav-${stamp}@test.local`,
      },
    });
    const evaluated = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: guest.id,
    });
    check("evaluate no records missing", evaluated.status === "missing" && evaluated.records.length === 0);
    check(
      "archived requirement does not block",
      !evaluated.missingRequirements.some((row) => row.templateId === template.id)
    );

    let missingVenue = false;
    try {
      await evaluateGuestWaivers({
        orgId,
        locationId: `c${"a".repeat(24)}`,
        guestProfileId: guest.id,
      });
    } catch (err) {
      missingVenue =
        err instanceof Error && err.message.includes("Venue location not found");
    }
    check("missing venue is rejected", missingVenue);

    let missingGuest = false;
    try {
      await evaluateGuestWaivers({
        orgId,
        locationId: venue.id,
        guestProfileId: `c${"b".repeat(24)}`,
      });
    } catch (err) {
      missingGuest = err instanceof Error && err.message.includes("Guest not found");
    }
    check("missing guest is rejected", missingGuest);

    await prisma.venueLocation.update({
      where: { id: venue.id },
      data: { timezone: "Not/AZone" },
    });
    let badZoneOk = false;
    try {
      await evaluateGuestWaivers({
        orgId,
        locationId: venue.id,
        guestProfileId: guest.id,
      });
      badZoneOk = true;
    } catch {
      badZoneOk = false;
    }
    check("invalid venue timezone does not crash evaluation", badZoneOk);
    await prisma.venueLocation.update({
      where: { id: venue.id },
      data: { timezone: "America/New_York" },
    });

    const publishedForm = await publishWaiverTemplate(actor, form.id, {});
    check("publish form", publishedForm.status === "published");
    let badTarget = false;
    try {
      await createWaiverRequirement(actor, {
        templateId: form.id,
        locationId: venue.id,
        targetType: "admission_product",
        targetId: "not-an-id",
      });
    } catch (err) {
      badTarget = err instanceof Error && err.message.includes("targetId");
    }
    check("invalid requirement target is rejected", badTarget);
    const { listAttachableForms, DEFAULT_ATTACHABLE_FORMS } = await import(
      "../src/lib/memberships/attachableForms.ts"
    );
    const attachable = await listAttachableForms(actor);
    const attachableIds = new Set(attachable.map((row) => row.id));
    check(
      "membership form picker keeps starter forms and adds published waiver forms",
      DEFAULT_ATTACHABLE_FORMS.every((row) => attachableIds.has(row.id)) &&
        attachableIds.has(form.id) &&
        !attachableIds.has(template.id)
    );
    await createWaiverRequirement(actor, {
      templateId: form.id,
      locationId: venue.id,
      targetType: "all_admissions",
    });
    const formVersionsLive = await listTemplateVersions(actor, form.id);
    const formLive = formVersionsLive.find((v) => v.id === publishedForm.currentPublishedVersionId);
    await prisma.waiverRecord.create({
      data: {
        orgId,
        locationId: venue.id,
        guestProfileId: guest.id,
        templateId: form.id,
        templateVersionId: formLive!.id,
        status: "signed",
        signerRole: "adult_self",
        channel: "onsite",
        locale: "en",
        signedAt: new Date(),
        publicRef: `wf-${stamp}`,
      },
    });
    const pass = await prisma.admissionProduct.create({
      data: {
        orgId,
        locationId: venue.id,
        type: "day_pass",
        name: `Waiver pass ${stamp}`,
        waiverRequired: true,
      },
    });
    const admissionEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: guest.id,
      productTargets: [{ targetType: "admission_product", targetId: pass.id }],
    });
    check(
      "unconfigured product waiver stays missing",
      admissionEval.status === "missing" &&
        admissionEval.missingRequirements.some((row) => row.targetId === pass.id)
    );
    const membershipEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: guest.id,
      productTargets: [{ targetType: "membership_plan", targetId: `plan-${stamp}` }],
    });
    check(
      "all-admissions rule stays off a membership check",
      !membershipEval.missingRequirements.some((row) => row.targetType === "all_admissions")
    );

    const expiryTemplate = await createWaiverTemplate(actor, {
      name: `Expiry ${stamp}`,
      kind: "liability_waiver",
      locationId: venue.id,
      title: `Expiry ${stamp}`,
      bodyHtml: "<p>Expires with company settings.</p>",
      localeDefault: "en",
    });
    await updateWaiverTemplate(actor, expiryTemplate.id, { defaultExpiryDays: 1 });
    const publishedExpiry = await publishWaiverTemplate(actor, expiryTemplate.id, {});
    const expiryVersions = await listTemplateVersions(actor, expiryTemplate.id);
    const expiryLive = expiryVersions.find(
      (v) => v.id === publishedExpiry.currentPublishedVersionId
    );
    await prisma.waiverRecord.create({
      data: {
        orgId,
        locationId: venue.id,
        guestProfileId: guest.id,
        templateId: expiryTemplate.id,
        templateVersionId: expiryLive!.id,
        status: "signed",
        signerRole: "adult_self",
        channel: "onsite",
        locale: "en",
        signedAt: new Date(Date.now() - 10 * 86_400_000),
        publicRef: `ex-${stamp}`,
      },
    });
    const expiryEval = await evaluateGuestWaivers({
      orgId,
      locationId: venue.id,
      guestProfileId: guest.id,
    });
    check(
      "company day count is used when the template did not choose days",
      expiryEval.records.find((row) => row.templateId === expiryTemplate.id)?.validity ===
        "valid"
    );

    const signedAt = new Date("2026-06-15T16:00:00.000Z");
    check(
      "expiry never",
      computeWaiverExpiresAt({
        rule: "never",
        signedAt,
        timeZone: "America/New_York",
      }) === null
    );
    const daysEnd = computeWaiverExpiresAt({
      rule: "days",
      signedAt,
      expiryDays: 10,
      timeZone: "America/New_York",
    });
    check(
      "expiry days",
      daysEnd != null && daysEnd.getTime() - signedAt.getTime() === 10 * 86_400_000
    );
    const yearEnd = computeWaiverExpiresAt({
      rule: "calendar_year",
      signedAt,
      timeZone: "America/New_York",
    });
    check("expiry calendar year", yearEnd != null && yearEnd.getUTCFullYear() >= 2026);
    const until = new Date("2026-12-31T23:59:59.000Z");
    const untilEnd = computeWaiverExpiresAt({
      rule: "until_date",
      signedAt,
      untilDate: until,
      timeZone: "America/New_York",
    });
    check("expiry until_date", untilEnd != null && untilEnd.getTime() === until.getTime());
    check(
      "until_date still valid",
      isSignedWaiverCurrentlyValid({
        rule: "until_date",
        signedAt,
        expiresAt: until,
        now: signedAt,
        timeZone: "America/New_York",
      })
    );
    check(
      "until_date past",
      !isSignedWaiverCurrentlyValid({
        rule: "until_date",
        signedAt,
        expiresAt: signedAt,
        now: new Date(signedAt.getTime() + 1000),
        timeZone: "America/New_York",
      })
    );
    check(
      "expiry visit same day",
      isSignedWaiverCurrentlyValid({
        rule: "visit",
        signedAt,
        expiresAt: null,
        now: signedAt,
        timeZone: "America/New_York",
      })
    );
    check(
      "expiry visit next day",
      !isSignedWaiverCurrentlyValid({
        rule: "visit",
        signedAt,
        expiresAt: null,
        now: new Date(signedAt.getTime() + 2 * 86_400_000),
        timeZone: "America/New_York",
      })
    );

    let crossDenied = false;
    try {
      await requireTemplate(otherActor, template.id);
    } catch (err) {
      crossDenied = err instanceof ForbiddenError;
    }
    check("cross-tenant template deny", crossDenied);

    await prisma.venueLocation.update({
      where: { id: venue.id },
      data: { status: "archived", archivedAt: new Date() },
    });
    let archivedKiosk = false;
    try {
      await createKioskDevice(actor, { name: "Desk", locationId: venue.id });
    } catch (err) {
      archivedKiosk = err instanceof ForbiddenError;
    }
    check("archived venue kiosk deny", archivedKiosk);
    await prisma.venueLocation.update({
      where: { id: venue.id },
      data: { status: "active", archivedAt: null },
    });

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, orgId },
    });
    check("staff membership exists", Boolean(membership?.id));
    if (membership) {
      await prisma.membership.update({
        where: { id: membership.id },
        data: { rolePreset: "ops_manager", companyWideView: false },
      });
      await prisma.membershipVenueAssignment.create({
        data: { membershipId: membership.id, orgId, locationId: venue.id },
      });
      clearCachedLocationScopesForOrg(orgId);
      let parkDefaultDenied = false;
      try {
        await upsertWaiverSettings(actor, {
          locationId: null,
          jurisdictionCode: "US-FL",
          ageOfMajorityYears: 18,
          expiryRule: "never",
        });
      } catch (err) {
        parkDefaultDenied = err instanceof ForbiddenError;
      }
      check("park-locked cannot write company-wide settings", parkDefaultDenied);
      const parkSettings = await upsertWaiverSettings(actor, {
        locationId: venue.id,
        jurisdictionCode: "US-FL",
        ageOfMajorityYears: 18,
        expiryRule: "visit",
      });
      check("park-locked can write assigned venue settings", parkSettings.locationId === venue.id);
    }

    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "starter" },
    });
    clearCachedStaffGatesForOrg(orgId);
    let starterDenied = false;
    try {
      await assertWaiversEnabled(orgId);
    } catch (err) {
      starterDenied = err instanceof ForbiddenError;
    }
    check("starter 403", starterDenied);

    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "demo", subscriptionStatus: "active" },
    });
    clearCachedStaffGatesForOrg(orgId);
    let demoDenied = false;
    try {
      await assertWaiversEnabled(orgId);
    } catch (err) {
      demoDenied =
        err instanceof ForbiddenError && err.message === DEMO_FEATURE_LOCKED_MESSAGE;
    }
    check("demo 403", demoDenied);

    const storefrontId = await getStorefrontOrgId();
    clearCachedStaffGatesForOrg(storefrontId);
    let storefrontDenied = false;
    try {
      await assertWaiversEnabled(storefrontId);
    } catch (err) {
      storefrontDenied = err instanceof ForbiddenError;
    }
    check("storefront 403", storefrontDenied);

    const signupRes = await signupPost(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    const signupJson = (await signupRes.json()) as { message?: string };
    check(
      "signup still closed",
      signupRes.status === 410 && signupJson.message === CLIENT_SIGNUP_CLOSED_MESSAGE
    );

    check(
      "public sign page is token scoped",
      existsSync("src/app/sign/[token]/page.tsx") &&
        existsSync("src/app/kiosk/waivers/[deviceToken]/page.tsx")
    );

    const product = await prisma.product.findFirst({
      select: { id: true, name: true },
    });
    check(
      "fashion product model unchanged",
      product == null || typeof product.name === "string"
    );
  } finally {
    try {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll Digital Waivers Phase 1 smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
