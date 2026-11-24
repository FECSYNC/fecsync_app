/**
 * Step 4 — company SaaS hardening smoke (control-plane final).
 *
 * Covers: notice watermarks, remind skips storefront+none, venue cap,
 * invite expiry frees seats, roleTemplates cap, cross-tenant venue deny,
 * export redaction, offboard audit stamp.
 *
 *   yarn smoke:company-saas-hardening
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
process.env.COMPANY_BILLING_NOTICE_ENABLED = "true";

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
  const prisma = (await import("../src/lib/prisma.ts")).default;
  const stamp = Date.now();

  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { CROSS_TENANT_MESSAGE, assertActorOrgMatch } = await import(
    "../src/lib/staffOrg.ts"
  );
  const {
    assertWithinPlanLimit,
    countPlanResource,
    planLimitReachedMessage,
  } = await import("../src/lib/planLimits.ts");
  const { getPlanLimits } = await import("../src/lib/subscriptionPlans.ts");
  const { createVenueLocation, listVenueLocations } = await import(
    "../src/lib/venueLocations.ts"
  );
  const {
    clearCompanySubscriptionNoticeWatermarks,
    notifyCompanyPastDue,
    notifyCompanyOffboardRequested,
  } = await import("../src/lib/companySubscriptionNotices.ts");
  const { runCompanySubscriptionReminders } = await import(
    "../src/lib/companySubscriptionRemind.ts"
  );
  const { expireOverdueMembershipInvites } = await import(
    "../src/lib/membershipInvites.ts"
  );
  const {
    buildCompanyWorkspaceExport,
    requestCompanyOffboard,
  } = await import("../src/lib/companyExport.ts");
  const {
    clearRegisteredCompanyOffboard,
    approveRegisteredCompany,
  } = await import("../src/lib/companyApproval.ts");
  const {
    assertOrganizationActive,
    assertOrganizationAllowsWorkspaceLifecycle,
  } = await import("../src/lib/org.ts");
  const { sanitizeAuthReturnTo } = await import("../src/utils/authRedirect.ts");
  const { logPlatformActionOnCompany } = await import(
    "../src/lib/platformCompanyAudit.ts"
  );
  const { logActivityEntryAsync } = await import(
    "../src/lib/audit/activityLog.ts"
  );

  const storefrontOrgId = await getStorefrontOrgId();

  const userA = await prisma.user.create({
    data: {
      email: `saas4-a-${stamp}@test.local`,
      password: "x",
      role: "client",
      isVerified: true,
      username: `saas4a${stamp}`,
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `saas4-b-${stamp}@test.local`,
      password: "x",
      role: "client",
      isVerified: true,
      username: `saas4b${stamp}`,
    },
  });
  const invitee = await prisma.user.create({
    data: {
      email: `saas4-inv-${stamp}@test.local`,
      password: "x",
      role: "client",
      isVerified: true,
      username: `saas4inv${stamp}`,
    },
  });

  const regA = await createOrganizationWithPlatformAdmin({
    name: `SaaS4 Co A ${stamp}`,
    slug: `saas4-a-${stamp}`,
    userId: userA.id,
  });
  const regB = await createOrganizationWithPlatformAdmin({
    name: `SaaS4 Co B ${stamp}`,
    slug: `saas4-b-${stamp}`,
    userId: userB.id,
  });
  const orgA = regA.organization.id;
  const orgB = regB.organization.id;

  const cleanupIds = [orgA, orgB];

  try {
    // Entitled company A for venue / export / limits.
    await prisma.organization.update({
      where: { id: orgA },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        stripeCustomerId: `cus_smoke_${stamp}`,
        stripeSubscriptionId: `sub_smoke_${stamp}`,
      },
    });
    await prisma.organization.update({
      where: { id: orgB },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
      },
    });

    // --- Notice watermarks ---
    await prisma.organization.update({
      where: { id: orgA },
      data: {
        subscriptionStatus: "past_due",
        subscriptionNoticePastDueAt: null,
      },
    });
    const past1 = await notifyCompanyPastDue(orgA);
    const past2 = await notifyCompanyPastDue(orgA);
    check("notices-watermarks-past-due-once", past1 === true && past2 === false);
    await clearCompanySubscriptionNoticeWatermarks(orgA);
    await prisma.organization.update({
      where: { id: orgA },
      data: { subscriptionStatus: "active" },
    });

    // --- Remind skips storefront + none ---
    const endsIn7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.organization.update({
      where: { id: storefrontOrgId },
      data: {
        subscriptionEndsAt: endsIn7d,
        subscriptionStatus: "active",
        subscriptionPlan: "growth",
      },
    });
    const noneOrg = await prisma.organization.create({
      data: {
        name: `SaaS4 None ${stamp}`,
        slug: `saas4-none-${stamp}`,
        status: "active",
        isDefault: false,
        subscriptionStatus: "none",
        subscriptionEndsAt: endsIn7d,
        subscriptionPlan: "starter",
      },
    });
    cleanupIds.push(noneOrg.id);

    const remind = await runCompanySubscriptionReminders(new Date());
    const storefrontTouched = await prisma.organization.findUnique({
      where: { id: storefrontOrgId },
      select: {
        subscriptionNoticeRemind7dAt: true,
        opsGrantNoticeRemind7dAt: true,
      },
    });
    const noneTouched = await prisma.organization.findUnique({
      where: { id: noneOrg.id },
      select: {
        subscriptionNoticeRemind7dAt: true,
        opsGrantNoticeRemind7dAt: true,
      },
    });
    check(
      "remind-skips-storefront",
      storefrontTouched?.subscriptionNoticeRemind7dAt == null &&
        storefrontTouched?.opsGrantNoticeRemind7dAt == null,
      `scanned=${remind.scanned}`
    );
    check(
      "remind-skips-subscriptionStatus-none",
      noneTouched?.subscriptionNoticeRemind7dAt == null &&
        noneTouched?.opsGrantNoticeRemind7dAt == null
    );

    // Restore storefront billing columns (defensive — storefront should stay none).
    await prisma.organization.update({
      where: { id: storefrontOrgId },
      data: {
        subscriptionEndsAt: null,
        subscriptionStatus: "none",
        subscriptionPlan: null,
        subscriptionNoticeRemind7dAt: null,
        opsGrantNoticeRemind7dAt: null,
      },
    });

    // --- Venue cap (starter = 1) ---
    const starterVenues = getPlanLimits("starter").venues;
    check("venue-cap-ssot-starter-1", starterVenues === 1);
    const actorA = { orgId: orgA, sub: userA.id };
    const venueA = await createVenueLocation(actorA, {
      name: `Park A ${stamp}`,
      slug: `park-a-${stamp}`,
    });
    check("venue-first-created", Boolean(venueA.id));
    let venueAtCap = false;
    try {
      await createVenueLocation(actorA, {
        name: `Park A2 ${stamp}`,
        slug: `park-a2-${stamp}`,
      });
    } catch (err) {
      venueAtCap =
        err instanceof Error &&
        err.message === planLimitReachedMessage("venues", "starter");
    }
    check("venue-cap-blocks-second", venueAtCap);
    check(
      "venue-count-1",
      (await countPlanResource(orgA, "venues")) === 1
    );

    // --- Invite expiry frees seats ---
    await prisma.membership.create({
      data: {
        userId: invitee.id,
        orgId: orgA,
        rolePreset: "catalog_editor",
        status: "invited",
        inviteExpiresAt: new Date(Date.now() - 60_000),
        companyWideView: false,
      },
    });
    const beforeExpire = await countPlanResource(orgA, "members");
    const { expired } = await expireOverdueMembershipInvites({ orgId: orgA });
    const afterExpire = await countPlanResource(orgA, "members");
    check("invite-expiry-revokes", expired >= 1);
    check(
      "invite-expiry-frees-seat",
      afterExpire === beforeExpire - 1,
      `before=${beforeExpire} after=${afterExpire}`
    );

    // --- roleTemplates cap ---
    const roleCap = getPlanLimits("starter").roleTemplates;
    check("roleTemplates-cap-ssot-5", roleCap === 5);
    for (let i = 0; i < roleCap; i++) {
      await prisma.roleTemplate.create({
        data: {
          orgId: orgA,
          name: `RT ${i} ${stamp}`,
          permissions: ["products:read"],
          createdById: userA.id,
        },
      });
    }
    let roleBlocked = false;
    try {
      await assertWithinPlanLimit(orgA, "roleTemplates");
    } catch (err) {
      roleBlocked =
        err instanceof Error &&
        err.message === planLimitReachedMessage("roleTemplates", "starter");
    }
    check("roleTemplates-cap-blocks", roleBlocked);

    // --- Cross-tenant venue deny ---
    const actorB = { orgId: orgB, sub: userB.id };
    const venuesForB = await listVenueLocations(actorB);
    check(
      "cross-tenant-venue-list-empty",
      venuesForB.every((v) => v.orgId === orgB) &&
        !venuesForB.some((v) => v.id === venueA.id)
    );
    try {
      assertActorOrgMatch(orgB, venueA.orgId);
      check("cross-tenant-venue-assert-throws", false);
    } catch (err) {
      check(
        "cross-tenant-venue-assert-throws",
        err instanceof ForbiddenError && err.message === CROSS_TENANT_MESSAGE
      );
    }
    // B cannot write into A's org by spoofing actor.orgId — create stamps actor org.
    const venueB = await createVenueLocation(actorB, {
      name: `Park B ${stamp}`,
      slug: `park-b-${stamp}`,
    });
    check(
      "cross-tenant-venue-create-stays-on-actor-org",
      venueB.orgId === orgB && venueB.orgId !== orgA
    );

    // Catalog product cross-tenant deny (Step 4 expand + phase2 parity).
    const catA = await prisma.productCategory.create({
      data: {
        orgId: orgA,
        name: `Cat A ${stamp}`,
        legacyStringId: `cat-a-${stamp}`,
        createdById: userA.id,
        createdByName: "A",
      },
    });
    const fabricA = await prisma.fabric.create({
      data: {
        orgId: orgA,
        name: `Fabric A ${stamp}`,
        image: "https://example.com/f.jpg",
        type: "cotton",
        color: "blue",
        createdById: userA.id,
        createdByName: "A",
      },
    });
    const productA = await prisma.product.create({
      data: {
        orgId: orgA,
        name: `Prod A ${stamp}`,
        description: "smoke",
        location: "HQ",
        price: 10,
        quantity: 1,
        images: ["https://example.com/p.jpg"],
        gender: "female",
        categoryId: catA.id,
        fabricTypeId: fabricA.id,
        createdById: userA.id,
        createdByName: "A",
      },
    });
    try {
      assertActorOrgMatch(orgB, productA.orgId);
      check("cross-tenant-product-assert-throws", false);
    } catch (err) {
      check(
        "cross-tenant-product-assert-throws",
        err instanceof ForbiddenError && err.message === CROSS_TENANT_MESSAGE
      );
    }
    try {
      assertActorOrgMatch(orgB, fabricA.orgId);
      check("cross-tenant-fabric-assert-throws", false);
    } catch (err) {
      check(
        "cross-tenant-fabric-assert-throws",
        err instanceof ForbiddenError && err.message === CROSS_TENANT_MESSAGE
      );
    }

    // --- Export redaction ---
    await prisma.companyProfile.upsert({
      where: { orgId: orgA },
      create: {
        orgId: orgA,
        legalName: `Legal A ${stamp}`,
        bankName: "Test Bank",
        bankAccountLast4: "4242",
        bankRoutingOrIban: "GB82WEST12345698765432",
        bankAccountCiphertext: "cipher-should-never-export",
      },
      update: {
        bankRoutingOrIban: "GB82WEST12345698765432",
        bankAccountCiphertext: "cipher-should-never-export",
        bankAccountLast4: "4242",
      },
    });

    const exported = await buildCompanyWorkspaceExport(orgA);
    const json = JSON.stringify(exported);
    check(
      "export-redacts-stripe-ids",
      !json.includes(`cus_smoke_${stamp}`) &&
        !json.includes(`sub_smoke_${stamp}`) &&
        exported.organization.hasStripeCustomer === true &&
        exported.organization.hasStripeSubscription === true
    );
    check(
      "export-redacts-bank-secrets",
      !json.includes("cipher-should-never-export") &&
        !json.includes("GB82WEST12345698765432") &&
        exported.companyProfile?.bank?.routingOrIbanRedacted === "[redacted]" &&
        exported.companyProfile?.bank?.accountLast4 === "4242"
    );
    check(
      "export-includes-venues",
      Array.isArray(exported.venues) &&
        exported.venues.some((v: { id?: string }) => v.id === venueA.id)
    );
    const usageMeters = (
      exported.usage as { meters?: Array<{ resource?: string; used?: number }> }
    )?.meters;
    const venuesMeterUsed = Array.isArray(usageMeters)
      ? usageMeters.find((m) => m.resource === "venues")?.used
      : undefined;
    check(
      "export-venuesActive-matches-plan-meter",
      exported.resourceCounts.venuesActive === venuesMeterUsed &&
        exported.resourceCounts.venuesActive === 1
    );
    check(
      "export-no-passwords",
      !json.toLowerCase().includes('"password"')
    );

    let storefrontExportDenied = false;
    try {
      await buildCompanyWorkspaceExport(storefrontOrgId);
    } catch (err) {
      storefrontExportDenied = err instanceof ForbiddenError;
    }
    check("export-storefront-denied", storefrontExportDenied);

    // Soft-hold: Active Fresh denies; workspace lifecycle still allows.
    await prisma.organization.update({
      where: { id: orgA },
      data: {
        status: "active",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() - 60_000),
      },
    });
    let softHoldActiveDenied = false;
    try {
      await assertOrganizationActive(orgA);
    } catch (err) {
      softHoldActiveDenied = err instanceof ForbiddenError;
    }
    let softHoldLifecycleOk = false;
    try {
      await assertOrganizationAllowsWorkspaceLifecycle(orgA);
      softHoldLifecycleOk = true;
    } catch {
      softHoldLifecycleOk = false;
    }
    check("soft-hold-active-fresh-denies", softHoldActiveDenied);
    check("soft-hold-lifecycle-allows", softHoldLifecycleOk);

    const softHoldReturnTo = sanitizeAuthReturnTo("/admin/billing", {
      role: "admin",
      preset: "platform_admin",
      membershipRole: "platform_admin",
      permissions: ["settings:manage"],
      orgStatus: "active",
      billingSoftHold: true,
    });
    check("soft-hold-returnTo-blocks-admin", softHoldReturnTo === null);

    // Restore entitled window for offboard / approve smokes.
    await prisma.organization.update({
      where: { id: orgA },
      data: {
        subscriptionEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });

    // --- Offboard audit ---
    const offboard = await requestCompanyOffboard({
      orgId: orgA,
      actorSub: userA.id,
      reason: "smoke offboard",
    });
    const orgAfterOffboard = await prisma.organization.findUnique({
      where: { id: orgA },
      select: { offboardRequestedAt: true, offboardedAt: true },
    });
    check(
      "offboard-stamps-requestedAt",
      Boolean(offboard.offboardRequestedAt) &&
        orgAfterOffboard?.offboardRequestedAt != null &&
        orgAfterOffboard.offboardedAt == null
    );

    await notifyCompanyOffboardRequested(orgA, "smoke offboard");
    const offboardNotif = await prisma.notification.findFirst({
      where: { userId: userA.id },
      orderBy: { createdAt: "desc" },
    });
    const offMeta = offboardNotif?.metadata as {
      event?: string;
      kind?: string;
      href?: string;
    } | null;
    check(
      "offboard-notice-in-app",
      offMeta?.event === "offboard_requested" &&
        offMeta?.kind === "company_billing" &&
        offMeta?.href === "/admin/company-profile"
    );

    // Idempotent offboard — second request must not re-stamp as created.
    const offboardAgain = await requestCompanyOffboard({
      orgId: orgA,
      actorSub: userA.id,
      reason: "smoke offboard again",
    });
    check(
      "offboard-idempotent",
      offboardAgain.created === false &&
        offboardAgain.offboardRequestedAt === offboard.offboardRequestedAt
    );

    const cleared = await clearRegisteredCompanyOffboard({
      orgId: orgA,
      actor: {
        sub: userA.id,
        orgId: storefrontOrgId,
        preset: "platform_admin",
        membershipRole: "platform_admin",
        permissions: [],
        role: "client",
        companyWideView: true,
        cwv: true,
      } as Parameters<typeof clearRegisteredCompanyOffboard>[0]["actor"],
    });
    const orgAfterClear = await prisma.organization.findUnique({
      where: { id: orgA },
      select: { offboardRequestedAt: true, offboardedAt: true },
    });
    check(
      "offboard-ops-clear",
      cleared.cleared === true &&
        orgAfterClear?.offboardRequestedAt == null &&
        orgAfterClear?.offboardedAt == null
    );

    // Approve clears offboard only after successful unlock (no Stripe trail).
    await requestCompanyOffboard({
      orgId: orgA,
      actorSub: userA.id,
      reason: "smoke approve-clear",
    });
    await prisma.organization.update({
      where: { id: orgA },
      data: {
        status: "active",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() - 60_000),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      },
    });
    const prevStripeKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const storefrontActor = {
      sub: userA.id,
      orgId: storefrontOrgId,
      preset: "platform_admin" as const,
      membershipRole: "platform_admin" as const,
      permissions: [] as string[],
      role: "client" as const,
      companyWideView: true,
      cwv: true,
    } as Parameters<typeof approveRegisteredCompany>[0]["actor"];
    try {
      await approveRegisteredCompany({
        orgId: orgA,
        actor: storefrontActor,
        subscriptionPlan: "starter",
      });
    } finally {
      if (prevStripeKey !== undefined) {
        process.env.STRIPE_SECRET_KEY = prevStripeKey;
      } else {
        delete process.env.STRIPE_SECRET_KEY;
      }
    }
    const afterApproveClear = await prisma.organization.findUnique({
      where: { id: orgA },
      select: {
        status: true,
        offboardRequestedAt: true,
        offboardedAt: true,
      },
    });
    check(
      "approve-clears-offboard-after-success",
      afterApproveClear?.status === "active" &&
        afterApproveClear.offboardRequestedAt == null &&
        afterApproveClear.offboardedAt == null
    );

    // Platform ops audit helper (storefront actor + targetOrgId).
    logPlatformActionOnCompany(
      { sub: userA.id, orgId: storefrontOrgId },
      {
        action: "Company Approved",
        targetOrgId: orgA,
        description: `Smoke platform audit ${stamp}`,
        metadata: { opsKind: "company-approval", smoke: true },
      }
    );
    // Fire-and-forget — await a direct write to assert shape in smoke.
    await logActivityEntryAsync({
      actorSub: userA.id,
      orgId: storefrontOrgId,
      action: "Company Approved",
      entityType: "Settings",
      entityId: orgA,
      description: `Smoke platform audit await ${stamp}`,
      metadata: {
        domain: "platform-ops",
        targetOrgId: orgA,
        opsKind: "company-approval",
        smoke: true,
      },
    });
    const platformAudit = await prisma.activityLog.findFirst({
      where: {
        orgId: storefrontOrgId,
        entityId: orgA,
        action: "Company Approved",
      },
      orderBy: { createdAt: "desc" },
    });
    const auditMeta = platformAudit?.metadata as {
      targetOrgId?: string;
      domain?: string;
      opsKind?: string;
    } | null;
    check(
      "platform-audit-targetOrgId",
      auditMeta?.targetOrgId === orgA &&
        auditMeta?.domain === "platform-ops" &&
        auditMeta?.opsKind === "company-approval"
    );

    let storefrontOffboardDenied = false;
    try {
      await requestCompanyOffboard({
        orgId: storefrontOrgId,
        actorSub: userA.id,
      });
    } catch (err) {
      storefrontOffboardDenied = err instanceof ForbiddenError;
    }
    check("offboard-storefront-denied", storefrontOffboardDenied);
  } finally {
    for (const oid of cleanupIds) {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { metadata: { path: ["orgId"], equals: oid } },
          ],
        },
      }).catch(() => {});
      await prisma.activityLog.deleteMany({ where: { entityId: oid } }).catch(
        () => {}
      );
      await prisma.activityLog
        .deleteMany({ where: { orgId: oid } })
        .catch(() => {});
      await prisma.venueLocation.deleteMany({ where: { orgId: oid } }).catch(
        () => {}
      );
      await prisma.product.deleteMany({ where: { orgId: oid } }).catch(() => {});
      await prisma.fabric.deleteMany({ where: { orgId: oid } }).catch(() => {});
      await prisma.productCategory
        .deleteMany({ where: { orgId: oid } })
        .catch(() => {});
      await prisma.roleTemplate.deleteMany({ where: { orgId: oid } }).catch(
        () => {}
      );
      await prisma.companyProfile.deleteMany({ where: { orgId: oid } }).catch(
        () => {}
      );
      await prisma.membership.deleteMany({ where: { orgId: oid } }).catch(
        () => {}
      );
      await prisma.organization.delete({ where: { id: oid } }).catch(() => {});
    }
    await prisma.notification
      .deleteMany({ where: { userId: { in: [userA.id, userB.id] } } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: invitee.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
  }
}

main()
  .then(() => {
    if (failed > 0 || process.exitCode === 1) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll company-saas-hardening smoke checks passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
