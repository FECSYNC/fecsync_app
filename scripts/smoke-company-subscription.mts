/**
 * Company subscription smoke: pending checkout denied, apply Stripe-like payload,
 * expiry suspends tenant only, storefront stays active, price→plan mapping.
 *
 *   yarn smoke:company-subscription
 */
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
  process.env.STRIPE_PRICE_STARTER_MONTHLY =
    process.env.STRIPE_PRICE_STARTER_MONTHLY || "price_smoke_starter";
  process.env.STRIPE_PRICE_GROWTH_MONTHLY =
    process.env.STRIPE_PRICE_GROWTH_MONTHLY || "price_smoke_growth";

  const {
    createOrganizationWithPlatformAdmin,
  } = await import("../src/lib/orgRegistration.ts");
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const {
    createCompanySubscriptionCheckout,
    applyStripeSubscriptionToOrg,
    markOrganizationSubscriptionExpired,
    markOrganizationPastDue,
    mapStripePriceIdToPlan,
    expireIfBoundStripeSubscription,
    isLiveStripeSubscriptionStatus,
    tryRefreshBoundSubscriptionIfLive,
  } = await import("../src/lib/companyBilling.ts");
  const { mapStripePriceIdToPlan: mapFromPlans } = await import(
    "../src/lib/subscriptionPlans.ts"
  );

  check(
    "price-map-starter",
    mapStripePriceIdToPlan("price_smoke_starter") === "starter"
  );
  check(
    "price-map-growth",
    mapFromPlans("price_smoke_growth") === "growth"
  );
  check("price-map-unknown", mapStripePriceIdToPlan("price_nope") === null);
  check(
    "live-status-includes-unpaid-paused",
    isLiveStripeSubscriptionStatus("unpaid") &&
      isLiveStripeSubscriptionStatus("paused") &&
      isLiveStripeSubscriptionStatus("past_due") &&
      !isLiveStripeSubscriptionStatus("canceled") &&
      !isLiveStripeSubscriptionStatus("incomplete")
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-sub-${stamp}@test.local`,
      password: "x",
      username: `smokesub${stamp}`,
      firstName: "Sub",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Sub ${stamp}`,
    slug: `smoke-sub-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;

  try {
    let pendingThrew = false;
    try {
      await createCompanySubscriptionCheckout({
        orgId,
        plan: "starter",
        actor: {
          sub: user.id,
          email: user.email,
          preset: "platform_admin",
          membershipRole: "platform_admin",
        },
      });
    } catch {
      pendingThrew = true;
    }
    check("pending-checkout-denied", pendingThrew);

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "none",
        // Customer must be bound before webhook apply (checkout creates it).
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });

    const endsSec = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    let storefrontCheckoutDenied = false;
    try {
      const storefrontIdEarly = await getStorefrontOrgId();
      await createCompanySubscriptionCheckout({
        orgId: storefrontIdEarly,
        plan: "starter",
        actor: {
          sub: user.id,
          email: user.email,
          preset: "platform_admin",
          membershipRole: "platform_admin",
        },
      });
    } catch {
      storefrontCheckoutDenied = true;
    }
    check("storefront-checkout-denied", storefrontCheckoutDenied);

    let spoofApplyDenied = false;
    try {
      await applyStripeSubscriptionToOrg(
        orgId,
        {
          id: `sub_smoke_spoof_${stamp}`,
          status: "active",
          customer: `cus_attacker_${stamp}`,
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: "price_smoke_starter" },
                current_period_end: endsSec,
              },
            ],
          },
          metadata: { orgId, plan: "starter" },
        },
        `evt_smoke_spoof_${stamp}`
      );
    } catch {
      spoofApplyDenied = true;
    }
    check("foreign-customer-apply-denied", spoofApplyDenied);

    await applyStripeSubscriptionToOrg(
      orgId,
      {
        id: `sub_smoke_${stamp}`,
        status: "active",
        customer: `cus_smoke_${stamp}`,
        cancel_at_period_end: false,
        // Stripe API 2025+: period end is on items (legacy top-level omitted).
        items: {
          data: [
            {
              price: { id: "price_smoke_starter" },
              current_period_end: endsSec,
            },
          ],
        },
        metadata: { orgId, plan: "starter" },
      },
      `evt_smoke_${stamp}`
    );

    const after = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    check(
      "apply-sets-plan-status",
      after?.subscriptionPlan === "starter" &&
        after?.subscriptionStatus === "active" &&
        after?.stripeSubscriptionId === `sub_smoke_${stamp}`,
      `plan=${after?.subscriptionPlan} status=${after?.subscriptionStatus}`
    );
    check(
      "apply-writes-subscriptionEndsAt",
      Boolean(after?.subscriptionEndsAt),
      String(after?.subscriptionEndsAt)
    );
    check(
      "apply-preserves-stripe-customer",
      after?.stripeCustomerId === `cus_smoke_${stamp}`
    );

    // Unbound incomplete delete must not suspend an active paying tenant.
    const unbound = await expireIfBoundStripeSubscription(
      orgId,
      `sub_abandoned_${stamp}`,
      "smoke-unbound-delete"
    );
    const stillActive = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { status: true, subscriptionStatus: true, stripeSubscriptionId: true },
    });
    check(
      "unbound-expire-skipped",
      unbound.expired === false &&
        stillActive?.status === "active" &&
        stillActive?.subscriptionStatus === "active" &&
        stillActive?.stripeSubscriptionId === `sub_smoke_${stamp}`
    );

    let secondCheckoutDenied = false;
    try {
      await createCompanySubscriptionCheckout({
        orgId,
        plan: "growth",
        actor: {
          sub: user.id,
          email: user.email,
          preset: "platform_admin",
          membershipRole: "platform_admin",
        },
      });
    } catch {
      secondCheckoutDenied = true;
    }
    check("second-checkout-denied-when-subscribed", secondCheckoutDenied);

    const storefrontId = await getStorefrontOrgId();
    const storefrontBefore = await prisma.organization.findUnique({
      where: { id: storefrontId },
      select: { status: true },
    });

    await markOrganizationSubscriptionExpired(orgId, "smoke-expiry");
    const expired = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    check(
      "expiry-suspends-tenant",
      expired?.status === "suspended" &&
        expired?.subscriptionStatus === "expired"
    );
    // Cleared when Stripe cancel succeeds / sub already gone; retained when
    // cancel fails (incl. Stripe unconfigured) — same retain policy as ops suspend.
    check(
      "expiry-stripe-binding-policy",
      expired?.stripeSubscriptionId == null ||
        expired?.stripeSubscriptionId === `sub_smoke_${stamp}`,
      `subId=${expired?.stripeSubscriptionId}`
    );
    check(
      "expiry-clears-subscription-plan",
      expired?.subscriptionPlan == null,
      `plan=${expired?.subscriptionPlan}`
    );

    // Bound expire via helper (webhook path) after re-binding.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "active",
        stripeSubscriptionId: `sub_bound_${stamp}`,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    const boundExpire = await expireIfBoundStripeSubscription(
      orgId,
      `sub_bound_${stamp}`,
      "smoke-bound-delete"
    );
    check("bound-expire-suspends", boundExpire.expired === true);
    const afterBound = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        status: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });
    check(
      "expiry-keeps-stripe-customer",
      afterBound?.status === "suspended" &&
        afterBound?.stripeCustomerId === `cus_smoke_${stamp}` &&
        (afterBound?.stripeSubscriptionId == null ||
          afterBound?.stripeSubscriptionId === `sub_bound_${stamp}`)
    );

    const storefrontAfter = await prisma.organization.findUnique({
      where: { id: storefrontId },
      select: { status: true },
    });
    check(
      "storefront-untouched",
      storefrontBefore?.status === storefrontAfter?.status &&
        storefrontAfter?.status === "active",
      `status=${storefrontAfter?.status}`
    );

    // Late Stripe apply must not mutate billing columns while suspended.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "suspended",
        subscriptionStatus: "expired",
        stripeCustomerId: `cus_smoke_${stamp}`,
        stripeSubscriptionId: null,
        subscriptionPlan: "starter",
      },
    });
    await applyStripeSubscriptionToOrg(
      orgId,
      {
        id: `sub_smoke_reactivate_${stamp}`,
        status: "active",
        customer: `cus_smoke_${stamp}`,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_smoke_starter" },
              current_period_end: endsSec,
            },
          ],
        },
        metadata: { orgId, plan: "starter" },
      },
      `evt_smoke_nosuspend_${stamp}`
    );
    const stillSuspended = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        status: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
      },
    });
    check(
      "apply-skips-suspended",
      stillSuspended?.status === "suspended" &&
        stillSuspended?.subscriptionStatus === "expired" &&
        stillSuspended?.stripeSubscriptionId === `sub_smoke_reactivate_${stamp}`,
      `status=${stillSuspended?.status} sub=${stillSuspended?.subscriptionStatus} subId=${stillSuspended?.stripeSubscriptionId}`
    );

    // incomplete Checkout must not stamp past_due on an active org.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "none",
        subscriptionPlan: null,
        stripeSubscriptionId: null,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    await applyStripeSubscriptionToOrg(
      orgId,
      {
        id: `sub_smoke_incomplete_${stamp}`,
        status: "incomplete",
        customer: `cus_smoke_${stamp}`,
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: "price_smoke_starter" }, current_period_end: endsSec }],
        },
        metadata: { orgId, plan: "starter" },
      },
      `evt_smoke_incomplete_${stamp}`
    );
    const afterIncomplete = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        subscriptionPlan: true,
      },
    });
    check(
      "incomplete-apply-skipped",
      afterIncomplete?.subscriptionStatus === "none" &&
        afterIncomplete?.stripeSubscriptionId == null &&
        afterIncomplete?.subscriptionPlan == null,
      `sub=${afterIncomplete?.subscriptionStatus}`
    );

    // payment_failed adopt must not bind incomplete Checkout (locks checkout +
    // would later suspend via incomplete_expired expire).
    await markOrganizationPastDue(orgId, {
      adoptSubscriptionId: `sub_smoke_incomplete_adopt_${stamp}`,
      stripeStatus: "incomplete",
    });
    const afterIncompleteAdopt = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        status: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
      },
    });
    check(
      "past-due-skips-incomplete-adopt",
      afterIncompleteAdopt?.status === "active" &&
        afterIncompleteAdopt?.subscriptionStatus === "none" &&
        afterIncompleteAdopt?.stripeSubscriptionId == null,
      `status=${afterIncompleteAdopt?.status} sub=${afterIncompleteAdopt?.subscriptionStatus} subId=${afterIncompleteAdopt?.stripeSubscriptionId}`
    );

    // Unbound past_due is invalid — normalize + billing state must not flag grace.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "past_due",
        stripeSubscriptionId: null,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    const { getCompanyBillingState, normalizeUnboundPastDueGrace } =
      await import("../src/lib/companyBilling.ts");
    const beforeNorm = await getCompanyBillingState(orgId);
    check(
      "unbound-past-due-state-not-grace",
      beforeNorm.pastDue === false && beforeNorm.hasSubscription === false
    );
    await normalizeUnboundPastDueGrace(orgId);
    const afterNorm = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { subscriptionStatus: true },
    });
    check(
      "unbound-past-due-normalized",
      afterNorm?.subscriptionStatus === "none",
      `sub=${afterNorm?.subscriptionStatus}`
    );

    // unpaid is applicable + live: stamps past_due; must not be treated as dead.
    await applyStripeSubscriptionToOrg(
      orgId,
      {
        id: `sub_smoke_unpaid_${stamp}`,
        status: "unpaid",
        customer: `cus_smoke_${stamp}`,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_smoke_starter" },
              current_period_end: endsSec,
            },
          ],
        },
        metadata: { orgId, plan: "starter" },
      },
      `evt_smoke_unpaid_${stamp}`
    );
    const afterUnpaid = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        subscriptionStatus: true,
        subscriptionPlan: true,
        stripeSubscriptionId: true,
      },
    });
    check(
      "unpaid-apply-stamps-past-due",
      afterUnpaid?.subscriptionStatus === "past_due" &&
        afterUnpaid?.subscriptionPlan === "starter" &&
        afterUnpaid?.stripeSubscriptionId === `sub_smoke_unpaid_${stamp}`,
      `sub=${afterUnpaid?.subscriptionStatus} plan=${afterUnpaid?.subscriptionPlan}`
    );

    // Past period end must not stamp live columns (retain binding only).
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "none",
        subscriptionPlan: null,
        subscriptionEndsAt: null,
        stripeSubscriptionId: null,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    const pastEndsSec = Math.floor(Date.now() / 1000) - 3600;
    await applyStripeSubscriptionToOrg(
      orgId,
      {
        id: `sub_smoke_past_end_${stamp}`,
        status: "active",
        customer: `cus_smoke_${stamp}`,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_smoke_starter" },
              current_period_end: pastEndsSec,
            },
          ],
        },
        metadata: { orgId, plan: "starter" },
      },
      `evt_smoke_past_end_${stamp}`
    );
    const afterPastEnd = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        subscriptionStatus: true,
        subscriptionPlan: true,
        subscriptionEndsAt: true,
        stripeSubscriptionId: true,
      },
    });
    check(
      "past-period-end-apply-refused",
      afterPastEnd?.subscriptionPlan == null &&
        afterPastEnd?.subscriptionStatus === "past_due" &&
        afterPastEnd?.subscriptionEndsAt == null &&
        afterPastEnd?.stripeSubscriptionId === `sub_smoke_past_end_${stamp}`,
      `plan=${afterPastEnd?.subscriptionPlan} status=${afterPastEnd?.subscriptionStatus} subId=${afterPastEnd?.stripeSubscriptionId}`
    );

    // past_due + null endsAt must soft-deny Fresh (align with tryRefresh comments).
    const { applyLazySubscriptionExpiryIfNeeded, assertOrganizationActive } =
      await import("../src/lib/org.ts");
    const softPastDue = await applyLazySubscriptionExpiryIfNeeded(
      {
        id: orgId,
        status: "active",
        isDefault: false,
        subscriptionStatus: "past_due",
        subscriptionEndsAt: null,
      },
      "smoke:past-due-null-endsAt"
    );
    check(
      "past-due-null-endsAt-soft-suspend",
      softPastDue.status === "suspended" && softPastDue.didExpire === false
    );
    let freshDenied = false;
    try {
      await assertOrganizationActive(orgId);
    } catch {
      freshDenied = true;
    }
    check("past-due-null-endsAt-fresh-denied", freshDenied);
    const { assertWithinPlanLimit: assertLimitPastDueNull } = await import(
      "../src/lib/planLimits.ts"
    );
    let pastDueNullCreatesBlocked = false;
    try {
      await assertLimitPastDueNull(orgId, "venues");
    } catch {
      pastDueNullCreatesBlocked = true;
    }
    check(
      "past-due-null-endsAt-creates-blocked",
      pastDueNullCreatesBlocked
    );

    // Soft-hold: DB still `active` + past_due/null — list shows Reactivate;
    // Approve must unlock (ops grant), not ORG_APPROVE_STATUS_MESSAGE.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "past_due",
        subscriptionPlan: null,
        subscriptionEndsAt: null,
        subscriptionInterval: null,
        stripeSubscriptionId: `sub_soft_hold_${stamp}`,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    const { approveRegisteredCompany, isSoftBillingHoldRow } = await import(
      "../src/lib/companyApproval.ts"
    );
    check(
      "soft-hold-row-detected",
      isSoftBillingHoldRow({
        status: "active",
        subscriptionStatus: "past_due",
        subscriptionEndsAt: null,
      })
    );
    await approveRegisteredCompany({
      orgId,
      actor: {
        sub: user.id,
        orgId: storefrontId,
        role: "admin",
        permissions: [],
        membershipRole: "platform_admin",
        preset: "platform_admin",
        companyWideView: true,
        av: null,
      } as any,
      subscriptionPlan: "starter",
    });
    const afterSoftHoldApprove = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    check(
      "soft-hold-approve-ops-grant",
      afterSoftHoldApprove?.status === "active" &&
        afterSoftHoldApprove?.subscriptionStatus === "active" &&
        afterSoftHoldApprove?.subscriptionPlan === "starter" &&
        afterSoftHoldApprove?.subscriptionEndsAt != null &&
        afterSoftHoldApprove.subscriptionEndsAt.getTime() > Date.now(),
      `status=${afterSoftHoldApprove?.status} plan=${afterSoftHoldApprove?.subscriptionPlan} sub=${afterSoftHoldApprove?.subscriptionStatus}`
    );

    // Soft-hold list projection must expose billingSoftHold so Suspend stays available.
    const { listRegisteredCompanies } = await import(
      "../src/lib/companyApproval.ts"
    );
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "past_due",
        subscriptionPlan: null,
        subscriptionEndsAt: null,
        stripeSubscriptionId: `sub_soft_list_${stamp}`,
      },
    });
    const listedSoft = (
      await listRegisteredCompanies({ status: "suspended", limit: 200 })
    ).companies;
    const softRow = listedSoft.find((c) => c.id === orgId);
    check(
      "soft-hold-list-billingSoftHold",
      softRow?.status === "suspended" && softRow?.billingSoftHold === true,
      `status=${softRow?.status} softHold=${String(softRow?.billingSoftHold)}`
    );
    // Restore ops grant for subsequent healthy-reapprove check.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "active",
        subscriptionPlan: "starter",
        subscriptionEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    let healthyReapproveBlocked = false;
    try {
      await approveRegisteredCompany({
        orgId,
        actor: {
          sub: user.id,
          orgId: storefrontId,
          role: "admin",
          permissions: [],
          membershipRole: "platform_admin",
          preset: "platform_admin",
          companyWideView: true,
          av: null,
        } as any,
        subscriptionPlan: "growth",
      });
    } catch {
      healthyReapproveBlocked = true;
    }
    check(
      "healthy-active-reapprove-blocked",
      healthyReapproveBlocked
    );

    // Unmapped / no Stripe: refresh must not return true for past endsAt.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionStatus: "active",
        subscriptionPlan: "starter",
        subscriptionEndsAt: new Date(Date.now() - 60_000),
        stripeSubscriptionId: `sub_smoke_unmapped_${stamp}`,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    const refreshUnmapped = await tryRefreshBoundSubscriptionIfLive(orgId);
    check(
      "refresh-unmapped-or-no-stripe-not-success",
      refreshUnmapped !== true,
      `refresh=${String(refreshUnmapped)}`
    );

    // Seed stale billing fields then approve without plan — must fully reset.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "suspended",
        subscriptionPlan: "growth",
        subscriptionStatus: "expired",
        subscriptionEndsAt: new Date(),
        subscriptionInterval: "month",
        stripeSubscriptionId: `sub_stale_${stamp}`,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    await approveRegisteredCompany({
      orgId,
      actor: {
        sub: user.id,
        orgId: storefrontId,
        role: "admin",
        permissions: [],
        membershipRole: "platform_admin",
        preset: "platform_admin",
        companyWideView: true,
        av: null,
      } as any,
      subscriptionPlan: null,
    });
    const afterApprove = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    check(
      "approve-without-plan-clears-billing",
      afterApprove?.status === "active" &&
        afterApprove?.subscriptionStatus === "none" &&
        afterApprove?.subscriptionPlan == null &&
        afterApprove?.subscriptionEndsAt == null &&
        // Without Stripe env, sync cannot verify — retain sub id to avoid
        // double Checkout after a failed cancel. With Stripe, dead subs clear.
        (afterApprove?.stripeSubscriptionId === `sub_stale_${stamp}` ||
          afterApprove?.stripeSubscriptionId == null) &&
        afterApprove?.stripeCustomerId === `cus_smoke_${stamp}`,
      `plan=${afterApprove?.subscriptionPlan} sub=${afterApprove?.subscriptionStatus} subId=${afterApprove?.stripeSubscriptionId}`
    );

    // requireStillOverdue must not re-suspend approve-without-plan (none + null endsAt).
    await markOrganizationSubscriptionExpired(
      orgId,
      "smoke:requireStillOverdue-after-approve-none",
      { requireStillOverdue: true, cancelStripe: false }
    );
    const afterExpireRace = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { status: true, subscriptionStatus: true },
    });
    check(
      "expire-requireStillOverdue-skips-approve-none",
      afterExpireRace?.status === "active" &&
        afterExpireRace?.subscriptionStatus === "none",
      `status=${afterExpireRace?.status} sub=${afterExpireRace?.subscriptionStatus}`
    );

    // Approve with plan stamp → ops grant entitle (COMPANY_OPS_GRANT_DAYS).
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "suspended",
        subscriptionPlan: null,
        subscriptionStatus: "none",
        subscriptionEndsAt: null,
        stripeSubscriptionId: null,
      },
    });
    const grantDays = Number(process.env.COMPANY_OPS_GRANT_DAYS || "30");
    const expectedDays =
      Number.isFinite(grantDays) && grantDays > 0 ? grantDays : 30;
    const beforeGrant = Date.now();
    await approveRegisteredCompany({
      orgId,
      actor: {
        sub: user.id,
        orgId: storefrontId,
        role: "admin",
        permissions: [],
        membershipRole: "platform_admin",
        preset: "platform_admin",
        companyWideView: true,
        av: null,
      } as any,
      subscriptionPlan: "starter",
    });
    const afterGrant = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    const endsAtMs = afterGrant?.subscriptionEndsAt?.getTime() ?? 0;
    const grantOk =
      afterGrant?.status === "active" &&
      afterGrant?.subscriptionStatus === "active" &&
      afterGrant?.subscriptionPlan === "starter" &&
      endsAtMs > beforeGrant &&
      endsAtMs <= beforeGrant + (expectedDays + 1) * 24 * 60 * 60 * 1000;
    check(
      "approve-with-plan-ops-grant",
      grantOk,
      `status=${afterGrant?.status} plan=${afterGrant?.subscriptionPlan} sub=${afterGrant?.subscriptionStatus} endsAt=${afterGrant?.subscriptionEndsAt?.toISOString()}`
    );
    const { assertWithinPlanLimit } = await import("../src/lib/planLimits.ts");
    let venuesEntitled = false;
    try {
      await assertWithinPlanLimit(orgId, "venues");
      venuesEntitled = true;
    } catch {
      venuesEntitled = false;
    }
    check("approve-with-plan-venues-entitled", venuesEntitled);

    // Already-suspended + bound cancel event must not claim a fresh expire.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "suspended",
        subscriptionStatus: "expired",
        subscriptionPlan: null,
        stripeSubscriptionId: `sub_already_suspended_${stamp}`,
        stripeCustomerId: `cus_smoke_${stamp}`,
      },
    });
    const alreadySuspendedExpire = await expireIfBoundStripeSubscription(
      orgId,
      `sub_already_suspended_${stamp}`,
      "smoke:already-suspended-cancel"
    );
    const afterAlreadySuspended = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { status: true, stripeSubscriptionId: true },
    });
    check(
      "already-suspended-expire-not-fresh",
      alreadySuspendedExpire.expired === false &&
        afterAlreadySuspended?.status === "suspended",
      `expired=${alreadySuspendedExpire.expired} status=${afterAlreadySuspended?.status}`
    );
    check(
      "already-suspended-keeps-or-clears-binding",
      // Without Stripe, cancel cannot confirm → retain. With Stripe gone → clear.
      afterAlreadySuspended?.stripeSubscriptionId ===
        `sub_already_suspended_${stamp}` ||
        afterAlreadySuspended?.stripeSubscriptionId == null,
      `subId=${afterAlreadySuspended?.stripeSubscriptionId}`
    );
  } finally {
    await prisma.activityLog.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.membership.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.profile.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  if (failed > 0) {
    console.error(`\n${failed} company-subscription smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll company-subscription smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
