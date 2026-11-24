/**
 * Company SaaS Stripe Billing — checkout, portal, webhook apply, expiry.
 * Never settles order/tailoring payments here.
 * Self-serve onboarding: pending orgs may Checkout; a live subscription apply
 * activates the workspace (status → active + plan stamp). Suspended still skip.
 */
import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { asIdString, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isPlatformAdminActor } from "@/lib/auth/permissions";
import { assertOrganizationActive, getStorefrontOrgId } from "@/lib/org";
import { getStripe, CompanyBillingConfigError } from "@/lib/stripe";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import { clearCachedStaffGatesForOrg } from "@/lib/ticketing/staffGateCache";
import {
  computePlanTermTotalMajor,
  demoSubscriptionEndsAt,
  getSubscriptionPlan,
  isDemoPlanId,
  isPlanCheckoutAvailable,
  isSubscriptionPlanId,
  mapStripePriceIdToPlan,
  normalizeBillingDurationMonths,
  resolveStripePriceId,
  resolveStripePriceIdForDuration,
  stripeRecurringForDurationMonths,
  subscriptionIntervalFromDurationMonths,
  subscriptionIntervalFromStripeRecurring,
  type BillingDurationMonths,
  type SubscriptionPlanId,
} from "@/lib/subscriptionPlans";
import { isCompanyBillingCreateEntitled } from "@/lib/planLimits";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";
import {
  billingGraceEndsAt,
  billingGraceDemoteCutoff,
  companyBillingGraceDays,
  msRemainingInBillingGrace,
} from "@/lib/billingGrace";
import type { OrgSubscriptionStatus } from "@/lib/org";

export const COMPANY_BILLING_PENDING_MESSAGE =
  "Company must be approved before billing";
export const COMPANY_BILLING_PLAN_MESSAGE = "Invalid or unavailable subscription plan";
export const COMPANY_BILLING_PRICE_MESSAGE =
  "Stripe price is not configured for this plan";
export const COMPANY_BILLING_ENTERPRISE_MESSAGE =
  "Enterprise plans require contacting sales";
export const COMPANY_BILLING_DEMO_MESSAGE =
  "Demo uses a free Checkout (no charge, no card). Choose Demo again from Billing or register with the Demo package.";
export const COMPANY_BILLING_ADMIN_ONLY_MESSAGE =
  "Only the company platform admin can manage billing";
export const COMPANY_BILLING_NO_CUSTOMER_MESSAGE =
  "No Stripe customer for this company yet — choose a plan first";
export const COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE =
  "Stripe customer does not belong to this organization";
export const COMPANY_BILLING_STOREFRONT_MESSAGE =
  "FECSYNC storefront organization cannot use company subscription billing";
export const COMPANY_BILLING_USE_PORTAL_MESSAGE =
  "This company already has a Stripe subscription — manage plan changes in the billing portal";
export const COMPANY_BILLING_STALE_CUSTOMER_MESSAGE =
  "Saved Stripe customer is no longer valid — start checkout again to recreate it";
/** Pending org already paid — client should sign in (no second Checkout). */
export const COMPANY_BILLING_ONBOARDING_ALREADY_ACTIVE_MESSAGE =
  "Workspace is already active after payment — sign in to open your dashboard";

/** Exact ForbiddenError messages safe to ACK on company_subscription webhooks. */
const COMPANY_BILLING_WEBHOOK_SKIP_MESSAGES = new Set<string>([
  COMPANY_BILLING_PENDING_MESSAGE,
  COMPANY_BILLING_PLAN_MESSAGE,
  COMPANY_BILLING_PRICE_MESSAGE,
  COMPANY_BILLING_ENTERPRISE_MESSAGE,
  COMPANY_BILLING_DEMO_MESSAGE,
  COMPANY_BILLING_ADMIN_ONLY_MESSAGE,
  COMPANY_BILLING_NO_CUSTOMER_MESSAGE,
  COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE,
  COMPANY_BILLING_STOREFRONT_MESSAGE,
  COMPANY_BILLING_USE_PORTAL_MESSAGE,
  COMPANY_BILLING_STALE_CUSTOMER_MESSAGE,
  COMPANY_BILLING_ONBOARDING_ALREADY_ACTIVE_MESSAGE,
  "Organization not found",
  "Organization not found for subscription apply",
  "Billing return URL is required",
  "Invalid billing return URL",
  "Billing return URL must be http(s)",
  "Billing return URL allowlist is empty",
  "Billing return URL origin is not allowed",
  "Invalid or incomplete company Checkout session",
  "Checkout payment is not complete yet",
]);

/**
 * True when a ForbiddenError is an expected company-billing business skip.
 * Used by the Stripe webhook so commerce settle ForbiddenErrors are never ACK'd.
 */
export function isCompanyBillingWebhookSkipError(err: unknown): boolean {
  if (!(err instanceof ForbiddenError)) return false;
  return COMPANY_BILLING_WEBHOOK_SKIP_MESSAGES.has(err.message);
}

/**
 * Company SaaS billing is for registered (non-default) tenants only.
 * Never attach Stripe customers/subscriptions to the public storefront org.
 */
export async function assertRegisteredCompanyBillingOrg(
  orgId: string
): Promise<{ id: string; name: string; isDefault: boolean; status: string }> {
  const id = requireId(orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();
  if (id === storefrontOrgId) {
    throw new ForbiddenError(COMPANY_BILLING_STOREFRONT_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true, isDefault: true, status: true },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(COMPANY_BILLING_STOREFRONT_MESSAGE);
  }
  return org;
}

/** Allow only http(s) return URLs on our app origin (never third-party env hosts). */
export function assertSafeBillingReturnUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new ForbiddenError("Billing return URL is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ForbiddenError("Invalid billing return URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ForbiddenError("Billing return URL must be http(s)");
  }
  const allowed = new Set<string>();
  // App origins only — do NOT trust STRIPE_COMPANY_BILLING_* as alternate hosts
  // (misconfigured env must not open an open-redirect allowlist).
  for (const raw of [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXTAUTH_URL,
  ]) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      allowed.add(new URL(v).origin);
    } catch {
      /* ignore */
    }
  }
  try {
    allowed.add(new URL(appBaseUrl()).origin);
  } catch {
    /* ignore */
  }
  // Fail closed — never accept a return URL when no app origin is configured.
  if (allowed.size === 0) {
    throw new ForbiddenError("Billing return URL allowlist is empty");
  }
  if (!allowed.has(parsed.origin)) {
    throw new ForbiddenError("Billing return URL origin is not allowed");
  }
  return parsed.toString();
}

function billingReturnUrlFromEnvOrDefault(
  envKey: string,
  fallbackPath: string
): string {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    try {
      return assertSafeBillingReturnUrl(fromEnv);
    } catch (err) {
      console.warn(
        `[company-billing] ignoring unsafe ${envKey}; using app origin fallback:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return assertSafeBillingReturnUrl(`${appBaseUrl()}${fallbackPath}`);
}

export type CompanyBillingState = {
  orgId: string;
  orgStatus: string;
  /** Stored plan id (null when unpaid / cleared). */
  plan: string | null;
  /** Effective plan for limits UI once entitled (null plan → starter floors). */
  planResolved: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  subscriptionInterval: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  /** Checkout term interest (months); never entitles alone. */
  requestedDurationMonths: number | null;
  pastDue: boolean;
  /**
   * Fresh soft-deny shape while org status is still active
   * (overdue live period or past_due + null endsAt).
   */
  billingSoftHold: boolean;
  /**
   * When soft-hold after period end: ISO instant when Demo demotion becomes
   * eligible (subscriptionEndsAt + COMPANY_BILLING_GRACE_DAYS). Null when not
   * in that window (or past_due with no endsAt).
   */
  billingGraceEndsAt: string | null;
  /** Configured grace length in days (default 7). */
  billingGraceDays: number;
  /** Ms left in grace while soft-hold; 0 when grace ended; null if N/A. */
  billingGraceMsRemaining: number | null;
  /** True when plan-capped creates are allowed (active|trialing|past_due). */
  billingEntitled: boolean;
  /**
   * True when Enterprise HQ APIs are unlocked for this registered company
   * (entitled + subscriptionPlan === enterprise). Storefront never true.
   */
  enterpriseHqEnabled: boolean;
  daysUntilRenewal: number | null;
};

export type StripeSubscriptionLike = {
  id: string;
  status: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  cancel_at_period_end?: boolean | null;
  /** Legacy API — removed on Stripe API 2025-10-29+ (period lives on items). */
  current_period_end?: number | null;
  items?: {
    data?: Array<{
      price?:
        | {
            id?: string | null;
            recurring?: {
              interval?: string | null;
              interval_count?: number | null;
            } | null;
          }
        | string
        | null;
      current_period_end?: number | null;
    }>;
  } | null;
  metadata?: Record<string, string> | null;
};

/** Prefer item-level period end (Stripe API 2025+); fall back to legacy top-level. */
export function periodEndUnixFromSubscription(
  sub: StripeSubscriptionLike
): number | null {
  let max: number | null = null;
  for (const item of sub.items?.data ?? []) {
    const end = item.current_period_end;
    if (typeof end === "number" && Number.isFinite(end)) {
      if (max == null || end > max) max = end;
    }
  }
  if (max != null) return max;
  if (
    typeof sub.current_period_end === "number" &&
    Number.isFinite(sub.current_period_end)
  ) {
    return sub.current_period_end;
  }
  return null;
}

/** Retrieve subscription with items expanded (period end lives on items in new Stripe API). */
export async function retrieveStripeSubscriptionForApply(
  subscriptionId: string
): Promise<StripeSubscriptionLike> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  return sub as unknown as StripeSubscriptionLike;
}

function onboardingOpsGrantEndsAt(): Date {
  const raw = Number(process.env.COMPANY_OPS_GRANT_DAYS || "30");
  const days = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Price→plan map first. Inline price_data Checkout (multi-month / Demo) has no
 * env Price reverse-map — trust metadata.plan when type=company_subscription.
 * Pending / expired-reactivate may also fall back to Organization.requestedPlan.
 */
export function resolvePlanForSubscriptionApply(
  stripeSub: StripeSubscriptionLike,
  orgStatus: string,
  requestedPlan?: string | null,
  allowInterestFallback = false
): SubscriptionPlanId | null {
  const priceId = priceIdFromSubscription(stripeSub);
  const mapped = mapStripePriceIdToPlan(priceId);
  if (mapped) return mapped;
  const metaPlan = stripeSub.metadata?.plan?.trim().toLowerCase() || "";
  const metaType = stripeSub.metadata?.type?.trim() || "";
  // Demo + paid price_data Checkouts stamp type + plan — always prefer that
  // after Price map fails (active Billing upgrades included).
  if (
    metaType === "company_subscription" &&
    isSubscriptionPlanId(metaPlan)
  ) {
    return metaPlan;
  }
  const freeCheckout =
    stripeSub.metadata?.freeCheckout === "1" || isDemoPlanId(metaPlan);
  if (freeCheckout && isSubscriptionPlanId(metaPlan)) return metaPlan;
  if (orgStatus !== "pending" && !allowInterestFallback) return null;
  if (isSubscriptionPlanId(metaPlan)) return metaPlan;
  const interest = requestedPlan?.trim().toLowerCase() || "";
  return isSubscriptionPlanId(interest) ? interest : null;
}

/** True when this Stripe sub is the free Demo package (Price map or metadata). */
export function isDemoCompanyStripeSubscription(
  stripeSub: StripeSubscriptionLike
): boolean {
  if (stripeSub.metadata?.freeCheckout === "1") return true;
  const metaPlan = stripeSub.metadata?.plan?.trim().toLowerCase() || "";
  if (isDemoPlanId(metaPlan)) return true;
  return isDemoPlanId(mapStripePriceIdToPlan(priceIdFromSubscription(stripeSub)));
}

function recurringFromSubscription(
  stripeSub: StripeSubscriptionLike
): { interval?: string | null; interval_count?: number | null } | null {
  const item = stripeSub.items?.data?.[0];
  const price = item?.price;
  if (!price || typeof price === "string") return null;
  const recurring = (
    price as {
      recurring?: { interval?: string | null; interval_count?: number | null };
    }
  ).recurring;
  return recurring ?? null;
}

function appBaseUrl(): string {
  return publicAppBaseUrl();
}

export function companyBillingSuccessUrl(): string {
  return billingReturnUrlFromEnvOrDefault(
    "STRIPE_COMPANY_BILLING_SUCCESS_URL",
    "/admin/billing?billing=success"
  );
}

export function companyBillingCancelUrl(): string {
  return billingReturnUrlFromEnvOrDefault(
    "STRIPE_COMPANY_BILLING_CANCEL_URL",
    "/admin/billing?billing=cancel"
  );
}

export function companyBillingPortalReturnUrl(): string {
  return assertSafeBillingReturnUrl(
    `${appBaseUrl()}/admin/billing?billing=portal`
  );
}

/** After first paid onboarding Checkout — confirm session, then sign in. */
export function companyOnboardingCheckoutSuccessUrl(email?: string | null): string {
  // Validate origin only — Stripe requires the literal `{CHECKOUT_SESSION_ID}`
  // (URLSearchParams would encode braces and Stripe would not substitute).
  const base = assertSafeBillingReturnUrl(
    `${appBaseUrl()}/company-checkout/complete`
  );
  const parsed = new URL(base);
  const trimmed = (email || "").trim().toLowerCase();
  const extra = trimmed
    ? `&email=${encodeURIComponent(trimmed)}`
    : "";
  return `${parsed.origin}${parsed.pathname}?session_id={CHECKOUT_SESSION_ID}${extra}`;
}

/** Abandoned / canceled onboarding Checkout — resume from waiting room. */
export function companyOnboardingCheckoutCancelUrl(): string {
  return assertSafeBillingReturnUrl(
    `${appBaseUrl()}/company-pending?billing=cancel`
  );
}

function daysUntil(date: Date | null | undefined): number | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export async function getCompanyBillingState(
  orgId: string,
  actor?: {
    preset?: string | null;
    membershipRole?: string | null;
    orgId?: string | null;
    storefrontOrgId?: string | null;
  } | null
): Promise<CompanyBillingState> {
  const id = requireId(orgId, "orgId");
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionInterval: true,
      subscriptionCancelAtPeriodEnd: true,
      requestedDurationMonths: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });
  if (!org) {
    throw new ForbiddenError("Organization not found");
  }
  const endsAt = org.subscriptionEndsAt;
  const rawPlan = org.subscriptionPlan?.trim().toLowerCase() || null;
  const plan =
    rawPlan && isSubscriptionPlanId(rawPlan) ? rawPlan : null;
  const subscriptionStatus = org.subscriptionStatus;
  const billingEntitled = isCompanyBillingCreateEntitled({
    subscriptionStatus,
    subscriptionEndsAt: endsAt,
    orgStatus: org.status,
  });
  const { orgHasEnterpriseHq } = await import("@/lib/enterpriseHq");
  const { resolveIsPlatformSoftwareOwner } = await import(
    "@/lib/resolvePlatformSoftwareOwner"
  );
  const billingSoftHold = isSoftBillingHoldRow({
    status: org.status,
    subscriptionStatus,
    subscriptionEndsAt: endsAt,
    subscriptionPlan: plan,
  });
  const ownerHost = await resolveIsPlatformSoftwareOwner({
    preset: actor?.preset,
    membershipRole: actor?.membershipRole,
    orgId: id,
    storefrontOrgId: actor?.storefrontOrgId,
  });
  const enterpriseHqEnabled =
    ownerHost ||
    (!billingSoftHold &&
      orgHasEnterpriseHq({
        isDefault: org.isDefault,
        status: org.status,
        subscriptionPlan: plan,
        subscriptionStatus,
        subscriptionEndsAt: endsAt,
      }));
  const now = new Date();
  const inPeriodGrace =
    billingSoftHold &&
    endsAt != null &&
    endsAt.getTime() < now.getTime() &&
    plan !== "demo";
  const graceEnds = inPeriodGrace ? billingGraceEndsAt(endsAt) : null;
  return {
    orgId: org.id,
    orgStatus: org.status,
    plan,
    planResolved: plan ?? "starter",
    subscriptionStatus,
    subscriptionEndsAt: endsAt ? endsAt.toISOString() : null,
    subscriptionInterval: org.subscriptionInterval,
    cancelAtPeriodEnd: Boolean(org.subscriptionCancelAtPeriodEnd),
    hasCustomer: Boolean(org.stripeCustomerId?.trim()),
    hasSubscription: Boolean(org.stripeSubscriptionId?.trim()),
    requestedDurationMonths:
      typeof org.requestedDurationMonths === "number" &&
      Number.isFinite(org.requestedDurationMonths)
        ? Math.floor(org.requestedDurationMonths)
        : null,
    // Grace requires a bound sub — unbound past_due is normalized on clear paths.
    pastDue:
      subscriptionStatus === "past_due" &&
      Boolean(org.stripeSubscriptionId?.trim()),
    billingSoftHold,
    billingGraceEndsAt: graceEnds ? graceEnds.toISOString() : null,
    billingGraceDays: companyBillingGraceDays(),
    billingGraceMsRemaining: inPeriodGrace
      ? msRemainingInBillingGrace(endsAt, now)
      : null,
    billingEntitled: ownerHost ? true : billingEntitled,
    enterpriseHqEnabled,
    daysUntilRenewal: daysUntil(endsAt),
  };
}

export async function ensureStripeCustomerForOrg(
  org: { id: string; name: string; stripeCustomerId?: string | null },
  actorEmail: string
): Promise<string> {
  await assertRegisteredCompanyBillingOrg(org.id);
  const orgId = org.id;

  const live = await resolveLiveStripeCustomerId(orgId);
  if (live) return live;

  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      email: actorEmail.trim() || undefined,
      name: org.name,
      metadata: { orgId, type: "company_subscription" },
    },
    { idempotencyKey: `company-customer:${orgId}` }
  );

  // Claim only if still unbound (null or blank). Concurrent checkouts must not
  // overwrite a live winner; never return a customer id that is not on the org
  // (webhook apply requires DB binding).
  const claimed = await prisma.organization.updateMany({
    where: {
      id: orgId,
      OR: [{ stripeCustomerId: null }, { stripeCustomerId: "" }],
    },
    data: { stripeCustomerId: customer.id },
  });
  if (claimed.count === 1) {
    return customer.id;
  }

  const winner = await resolveLiveStripeCustomerId(orgId);
  if (winner && winner !== customer.id) {
    try {
      await stripe.customers.del(customer.id);
    } catch (err) {
      console.warn("[company-billing] orphan customer cleanup failed:", err);
    }
    return winner;
  }
  if (winner) return winner;

  // Lost claim and no live binding — do not hand Checkout an unbound customer.
  try {
    await stripe.customers.del(customer.id);
  } catch (err) {
    console.warn(
      "[company-billing] unbound customer cleanup failed:",
      err
    );
  }
  throw new CompanyBillingConfigError(
    "Could not bind Stripe customer for this company — try checkout again"
  );
}

function isStripeResourceMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; statusCode?: number };
  // Do not treat generic StripeInvalidRequestError as "missing" — that would
  // clear bindings / fake cancel success on unrelated invalid requests.
  return e.code === "resource_missing" || e.statusCode === 404;
}

function isStripeAlreadyCanceled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = String((err as { message?: string }).message || "").toLowerCase();
  return msg.includes("already been canceled") || msg.includes("no such subscription");
}

/**
 * Unbind a deleted/missing Stripe customer. Always clear stripeSubscriptionId
 * too — otherwise checkout is blocked by a retained sub id while portal has
 * no customer (deadlock). Also drop orphan past_due grace (no bound sub).
 */
async function clearStaleStripeCustomerBinding(
  orgId: string,
  customerId: string
): Promise<void> {
  const cid = customerId.trim();
  if (!cid) return;
  await prisma.organization.updateMany({
    where: { id: orgId, stripeCustomerId: cid },
    data: {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
  });
  await normalizeUnboundPastDueGrace(orgId);
}

/**
 * past_due without a bound subscription is an invalid grace state (checkout
 * would create a new customer while UI still shows payment-failed grace).
 * Never wipe orgs still inside the renewal soft-hold window (period ended but
 * COMPANY_BILLING_GRACE_DAYS not finished) — that would unlock admin mid-grace.
 */
export async function normalizeUnboundPastDueGrace(orgId: string): Promise<void> {
  const id = asIdString(orgId);
  if (!id) return;

  const current = await prisma.organization.findUnique({
    where: { id },
    select: {
      subscriptionEndsAt: true,
      subscriptionStatus: true,
    },
  });
  if (
    current?.subscriptionEndsAt &&
    current.subscriptionEndsAt.getTime() < Date.now()
  ) {
    const { isPastBillingGracePeriod } = await import("@/lib/billingGrace");
    if (!isPastBillingGracePeriod(current.subscriptionEndsAt)) {
      console.warn(
        "[company-billing] skip unbound past_due normalize — still in renewal grace",
        id
      );
      return;
    }
  }

  const result = await prisma.organization.updateMany({
    where: {
      id,
      isDefault: false,
      status: "active",
      subscriptionStatus: "past_due",
      OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: "" }],
    },
    data: {
      subscriptionStatus: "none",
      subscriptionPlan: null,
      subscriptionEndsAt: null,
      subscriptionInterval: null,
      subscriptionCancelAtPeriodEnd: false,
    },
  });
  if (result.count === 0) return;
  await logActivityEntryAsync({
    orgId: id,
    action: "Company Billing Normalized Unbound Past Due",
    entityType: "Settings",
    entityId: id,
    description:
      "Cleared past_due grace and plan fields after subscription binding was removed",
    metadata: { domain: "company-billing" },
  });
  // Episode ended without entitled renew — reset Step 3 watermarks so a later
  // past_due / remind cycle can fire again.
  try {
    const { clearCompanySubscriptionNoticeWatermarks } = await import(
      "@/lib/companySubscriptionNotices"
    );
    await clearCompanySubscriptionNoticeWatermarks(id);
  } catch (err) {
    console.warn(
      "[company-billing] clear notice watermarks after unbound past_due normalize failed:",
      err
    );
  }
}

/** Return live customer id, or clear a deleted/missing binding and return null. */
async function resolveLiveStripeCustomerId(
  orgId: string
): Promise<string | null> {
  const row = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });
  const cid = row?.stripeCustomerId?.trim() || "";
  if (!cid) return null;

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(cid);
    if (customer.deleted) {
      await clearStaleStripeCustomerBinding(orgId, cid);
      return null;
    }
    return cid;
  } catch (err) {
    if (err instanceof CompanyBillingConfigError) throw err;
    if (isStripeResourceMissing(err)) {
      await clearStaleStripeCustomerBinding(orgId, cid);
      return null;
    }
    // Transient Stripe errors: keep binding and surface later.
    console.warn("[company-billing] customer verify deferred:", err);
    return cid;
  }
}

/**
 * Binding checks before linking a Stripe customer/subscription to an org.
 * Rejects storefront, customer↔org mismatches, and metadata spoofing.
 * First customer attach must happen via ensureStripeCustomerForOrg (checkout),
 * not via webhook metadata alone.
 */
export async function assertStripeCustomerBoundToOrg(
  orgId: string,
  customerId: string | null | undefined,
  existingOrgCustomerId?: string | null
): Promise<void> {
  await assertRegisteredCompanyBillingOrg(orgId);
  if (!customerId?.trim()) {
    throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
  }
  const cid = customerId.trim();
  const existing = existingOrgCustomerId?.trim() || "";

  // Webhooks must not invent the org↔customer link from attacker-controlled metadata.
  if (!existing) {
    throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
  }
  if (existing !== cid) {
    throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
  }

  const boundOrg = await prisma.organization.findFirst({
    where: { stripeCustomerId: cid },
    select: { id: true },
  });
  if (boundOrg && boundOrg.id !== orgId) {
    throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
  }

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(cid);
    if (customer.deleted) {
      await clearStaleStripeCustomerBinding(orgId, cid);
      throw new ForbiddenError(COMPANY_BILLING_STALE_CUSTOMER_MESSAGE);
    }
    const metaOrg = customer.metadata?.orgId?.trim();
    if (metaOrg && metaOrg !== orgId) {
      throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
    }
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    if (isStripeResourceMissing(err)) {
      await clearStaleStripeCustomerBinding(orgId, cid);
      throw new ForbiddenError(COMPANY_BILLING_STALE_CUSTOMER_MESSAGE);
    }
    // Config missing or transient: DB binding matched. Checkout/portal still
    // fail closed via getStripe(); apply smokes can run without Stripe env.
    if (err instanceof CompanyBillingConfigError) {
      console.warn("[company-billing] customer retrieve skipped:", err.message);
      return;
    }
    console.warn("[company-billing] customer retrieve deferred:", err);
  }
}

function priceIdFromSubscription(sub: StripeSubscriptionLike): string | null {
  const item = sub.items?.data?.[0];
  if (!item?.price) return null;
  if (typeof item.price === "string") return item.price;
  return item.price.id?.trim() || null;
}

export function mapStripeSubscriptionStatus(
  status: string
): OrgSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "paused":
      return "past_due";
    case "incomplete":
    case "incomplete_expired":
      // Not a billing state we persist — Checkout may abandon mid-flow.
      return "none";
    default:
      return "none";
  }
}

/** Stripe statuses that should update org subscription columns. */
export function isApplicableStripeSubscriptionStatus(status: string): boolean {
  return (
    status === "trialing" ||
    status === "active" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused"
  );
}

/**
 * Ops fail-closed / legacy suspend shape — does NOT delete tenant data.
 * Unpaid period end now uses {@link organizationSubscriptionDemotedToDemoData}
 * via {@link markOrganizationSubscriptionExpired} (soft demote, records intact).
 * Prefer {@link organizationOpsHoldData} for FECSYNC Suspend so
 * self-serve renew cannot unlock without Approve / Set plan.
 */
export function organizationSubscriptionExpiredData(): {
  status: "suspended";
  subscriptionStatus: "expired";
  subscriptionInterval: null;
  subscriptionCancelAtPeriodEnd: false;
  stripeSubscriptionId: string | null;
  subscriptionEndsAt: null;
} {
  return {
    status: "suspended",
    subscriptionStatus: "expired",
    // Keep subscriptionPlan so self-serve renew Checkout knows which Price to open.
    // Entitlement still requires active status + future endsAt (not plan alone).
    subscriptionInterval: null,
    subscriptionCancelAtPeriodEnd: false,
    stripeSubscriptionId: null,
    // Clear past period end so UI/metrics do not treat expired orgs as "expiring".
    subscriptionEndsAt: null,
  };
}

/**
 * Manual ops Suspend from registered-companies — soft lock only.
 * NEVER deletes Organization / venues / catalog / orders / memberships / history.
 * Uses subscriptionStatus `ops_hold` (not `expired`) so billing renew stays locked
 * until FECSYNC Approve or emergency Set plan.
 */
export function organizationOpsHoldData(): {
  status: "suspended";
  subscriptionStatus: "ops_hold";
  subscriptionInterval: null;
  subscriptionCancelAtPeriodEnd: false;
  subscriptionEndsAt: null;
} {
  return {
    status: "suspended",
    subscriptionStatus: "ops_hold",
    subscriptionInterval: null,
    subscriptionCancelAtPeriodEnd: false,
    subscriptionEndsAt: null,
  };
}

export { isOpsCompanyHold } from "@/lib/accountSuspendMessages";

/**
 * Unpaid period end → Demo package (active + locked apps).
 * NEVER deletes Organization / Product / Order / Venue / Membership / history.
 * Stashes the last paid plan on `requestedPlan` so renew can reopen that Price.
 */
export function organizationSubscriptionDemotedToDemoData(input?: {
  priorPlan?: string | null;
  from?: Date;
}): {
  status: "active";
  subscriptionPlan: "demo";
  subscriptionStatus: "trialing";
  subscriptionEndsAt: Date;
  subscriptionInterval: "month";
  subscriptionCancelAtPeriodEnd: false;
  requestedPlan?: string;
} {
  const prior = input?.priorPlan?.trim().toLowerCase() || "";
  const stashPrior =
    isSubscriptionPlanId(prior) && !isDemoPlanId(prior) ? prior : null;
  return {
    status: "active",
    subscriptionPlan: "demo",
    subscriptionStatus: "trialing",
    subscriptionEndsAt: demoSubscriptionEndsAt(input?.from ?? new Date()),
    subscriptionInterval: "month",
    subscriptionCancelAtPeriodEnd: false,
    ...(stashPrior ? { requestedPlan: stashPrior } : {}),
  };
}

/**
 * Synthetic apply callers (reconcile / lazy refresh / ops-unlock) must not
 * advance the Stripe event watermark — wall-clock stamps poison later webhooks
 * with older event.created (false stale-skip).
 */
export function isSyntheticBillingApplyEvent(
  eventId: string | null | undefined
): boolean {
  const eid = typeof eventId === "string" ? eventId.trim() : "";
  if (!eid) return true;
  return (
    eid.startsWith("reconcile-") ||
    eid.startsWith("lazy-refresh") ||
    eid.startsWith("approve:") ||
    eid.startsWith("ops-unlock") ||
    eid.startsWith("onboarding-confirm") ||
    eid.startsWith("apply-skip:")
  );
}

/** Clear ordering watermarks (raw — client types may lag schema). */
export async function clearOrganizationBillingEventWatermark(
  orgId: string,
  db: { $executeRaw: typeof prisma.$executeRaw } = prisma
): Promise<void> {
  const id = requireId(orgId, "orgId");
  await db.$executeRaw`
    UPDATE "organizations"
    SET
      "stripeBillingLastEventId" = NULL,
      "stripeBillingLastEventCreated" = NULL
    WHERE "id" = ${id}
  `;
}

export async function createCompanySubscriptionCheckout(input: {
  orgId: string;
  plan: string;
  /** Term length in months (1|2|3|6|12|24|60). Demo ignores (free trial days). */
  durationMonths?: number | null;
  actor: {
    sub: string;
    email?: string | null;
    preset?: string | null;
    membershipRole?: string | null;
  };
  successUrl?: string;
  cancelUrl?: string;
  /**
   * Self-serve register → Checkout while Organization.status is still pending.
   * Payment webhook activates the org. Suspended still skip unless
   * allowLockedRenew (expired soft-hold renew).
   */
  allowPendingOnboarding?: boolean;
  /** Soft-hold / expired-suspend renew without full admin unlock. */
  allowLockedRenew?: boolean;
}): Promise<{ url: string }> {
  const orgId = requireId(input.orgId, "orgId");
  await assertRegisteredCompanyBillingOrg(orgId);
  const onboarding = input.allowPendingOnboarding === true;
  const lockedRenew = input.allowLockedRenew === true;
  if (!onboarding && !lockedRenew) {
    await assertOrganizationActive(orgId);
  } else if (lockedRenew && !onboarding) {
    const row = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { status: true, subscriptionStatus: true },
    });
    if (!row || row.status === "pending") {
      throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
    }
    if (
      row.status === "suspended" &&
      row.subscriptionStatus !== "expired"
    ) {
      throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
    }
  }

  if (!isPlatformAdminActor(input.actor)) {
    throw new ForbiddenError(COMPANY_BILLING_ADMIN_ONLY_MESSAGE);
  }

  const planId = input.plan?.trim().toLowerCase();
  if (!isSubscriptionPlanId(planId)) {
    throw new ForbiddenError(COMPANY_BILLING_PLAN_MESSAGE);
  }
  const plan = getSubscriptionPlan(planId)!;
  if (plan.cta === "contact" && !resolveStripePriceId(planId)) {
    throw new ForbiddenError(COMPANY_BILLING_ENTERPRISE_MESSAGE);
  }
  const freeNoCardCheckout = isDemoPlanId(planId);
  // Demo stays free monthly trial; paid terms use selected duration.
  const durationMonths: BillingDurationMonths = freeNoCardCheckout
    ? 1
    : normalizeBillingDurationMonths(input.durationMonths);
  const priceId = resolveStripePriceIdForDuration(planId, durationMonths);
  const termTotalMajor = computePlanTermTotalMajor(planId, durationMonths);
  if (!priceId && !freeNoCardCheckout) {
    if (termTotalMajor == null || termTotalMajor < 0) {
      throw new ForbiddenError(COMPANY_BILLING_PRICE_MESSAGE);
    }
    if (!isPlanCheckoutAvailable(planId)) {
      throw new ForbiddenError(COMPANY_BILLING_PRICE_MESSAGE);
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      status: true,
      subscriptionPlan: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });
  if (!org) {
    throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
  }
  if (org.status === "suspended" && !lockedRenew) {
    throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
  }
  const statusOk =
    org.status === "active" ||
    (onboarding && org.status === "pending") ||
    (lockedRenew && org.status === "suspended");
  if (!statusOk) {
    throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
  }

  // Persist interest so resume Checkout / renew can reopen the same term.
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      requestedPlan: planId,
      requestedDurationMonths: durationMonths,
    },
  });

  const upgradingFromDemo =
    !freeNoCardCheckout && isDemoPlanId(org.subscriptionPlan);

  if (org.stripeSubscriptionId?.trim()) {
    const boundId = org.stripeSubscriptionId.trim();
    // Stale incomplete/canceled/missing Checkout bindings must not permanently
    // lock portal-only mode — only a still-live bound sub forces the portal.
    try {
      const stripeProbe = getStripe();
      const remote = await stripeProbe.subscriptions.retrieve(boundId);
      if (
        remote.status === "incomplete" ||
        remote.status === "incomplete_expired" ||
        remote.status === "canceled"
      ) {
        await clearAbandonedIncompleteSubscriptionBinding(
          orgId,
          boundId,
          `checkout:${remote.status}-binding`
        );
      } else if (
        upgradingFromDemo &&
        isDemoCompanyStripeSubscription(
          remote as unknown as StripeSubscriptionLike
        )
      ) {
        // Demo trial sub blocks a second Checkout — cancel + clear so paid
        // multi-duration Checkout can start (Portal cannot sell price_data terms).
        await cancelDemoSubscriptionForPaidUpgrade(
          orgId,
          boundId,
          "checkout:demo-upgrade"
        );
      } else if (onboarding && org.status === "pending") {
        // Paid but still pending (webhook/confirm lag or prior refuse) — finish activate.
        const expanded = await retrieveStripeSubscriptionForApply(boundId);
        await applyStripeSubscriptionToOrg(
          orgId,
          expanded,
          `onboarding-resume:${boundId}`,
          Math.floor(Date.now() / 1000)
        );
        const after = await getCompanyBillingState(orgId);
        if (after.orgStatus === "active") {
          throw new ForbiddenError(
            COMPANY_BILLING_ONBOARDING_ALREADY_ACTIVE_MESSAGE
          );
        }
        throw new ForbiddenError(COMPANY_BILLING_USE_PORTAL_MESSAGE);
      } else {
        throw new ForbiddenError(COMPANY_BILLING_USE_PORTAL_MESSAGE);
      }
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      if (err instanceof CompanyBillingConfigError) {
        throw new ForbiddenError(COMPANY_BILLING_USE_PORTAL_MESSAGE);
      }
      if (isStripeResourceMissing(err)) {
        await clearAbandonedIncompleteSubscriptionBinding(
          orgId,
          boundId,
          "checkout:missing-binding"
        );
      } else {
        console.warn(
          "[company-billing] checkout bound-sub probe failed:",
          orgId,
          boundId,
          err
        );
        throw new ForbiddenError(COMPANY_BILLING_USE_PORTAL_MESSAGE);
      }
    }
  }

  const email = (input.actor.email || "").trim();
  const customerId = await ensureStripeCustomerForOrg(org, email);
  const stripe = getStripe();

  // Orphan live subs (apply skipped / race) must not start a second Checkout.
  try {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    const live = listed.data.find((row) =>
      isLiveStripeSubscriptionStatus(row.status)
    );
    if (live) {
      const liveLike = live as unknown as StripeSubscriptionLike;
      if (
        upgradingFromDemo &&
        isDemoCompanyStripeSubscription(liveLike)
      ) {
        await cancelDemoSubscriptionForPaidUpgrade(
          orgId,
          live.id,
          "checkout:demo-upgrade-list"
        );
      } else {
        await retainStripeSubscriptionBinding(orgId, live.id);
        if (onboarding && org.status === "pending") {
          const expanded = await retrieveStripeSubscriptionForApply(live.id);
          await applyStripeSubscriptionToOrg(
            orgId,
            expanded,
            `onboarding-resume-list:${live.id}`,
            Math.floor(Date.now() / 1000)
          );
          const after = await getCompanyBillingState(orgId);
          if (after.orgStatus === "active") {
            throw new ForbiddenError(
              COMPANY_BILLING_ONBOARDING_ALREADY_ACTIVE_MESSAGE
            );
          }
        }
        throw new ForbiddenError(COMPANY_BILLING_USE_PORTAL_MESSAGE);
      }
    }
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    if (err instanceof CompanyBillingConfigError) throw err;
    // Customer already exists — inconclusive list must not open a second Checkout
    // while an unbound live sub may still be charging.
    console.warn(
      "[company-billing] checkout live-sub probe failed:",
      orgId,
      err
    );
    throw new CompanyBillingConfigError(
      "Unable to verify existing Stripe subscriptions — try again shortly"
    );
  }

  // Never trust client-supplied redirect hosts — only allowlisted origins.
  // Onboarding success URL must keep literal `{CHECKOUT_SESSION_ID}` unencoded.
  const successUrl = onboarding
    ? input.successUrl?.trim() || companyOnboardingCheckoutSuccessUrl(email)
    : assertSafeBillingReturnUrl(
        input.successUrl?.trim() || companyBillingSuccessUrl()
      );
  if (onboarding) {
    // Origin already validated inside companyOnboardingCheckoutSuccessUrl.
    const originOk = (() => {
      try {
        assertSafeBillingReturnUrl(
          `${new URL(successUrl).origin}/company-checkout/complete`
        );
        return true;
      } catch {
        return false;
      }
    })();
    if (!originOk || !successUrl.includes("{CHECKOUT_SESSION_ID}")) {
      throw new ForbiddenError("Invalid billing return URL");
    }
  }
  const cancelUrl = assertSafeBillingReturnUrl(
    input.cancelUrl?.trim() ||
      (onboarding
        ? companyOnboardingCheckoutCancelUrl()
        : companyBillingCancelUrl())
  );
  const idempotencyKey = `company-checkout:${orgId}:${planId}:${durationMonths}m:${customerId}:${Math.floor(
    Date.now() / (5 * 60 * 1000)
  )}`;

  // Demo: $0 Checkout with payment_method_collection=if_required (no card).
  // Prefer env Price when set; otherwise inline price_data unit_amount 0.
  // Paid multi-month: duration Price env, else price_data from display×months.
  const demoTrialDays = (() => {
    if (!freeNoCardCheckout) return null;
    const raw = Number(process.env.COMPANY_DEMO_DAYS || "30");
    if (!Number.isFinite(raw) || raw < 1) return 30;
    return Math.min(Math.floor(raw), 90);
  })();

  const recurring = stripeRecurringForDurationMonths(durationMonths);
  const intervalLabel = subscriptionIntervalFromDurationMonths(durationMonths);
  const durationMeta = {
    durationMonths: String(durationMonths),
    billingInterval: intervalLabel,
  };

  let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  if (priceId) {
    lineItems = [{ price: priceId, quantity: 1 }];
  } else if (freeNoCardCheckout) {
    lineItems = [
      {
        quantity: 1,
        price_data: {
          currency: (plan.currency || "USD").toLowerCase(),
          unit_amount: 0,
          recurring: { interval: "month", interval_count: 1 },
          product_data: {
            name: `${plan.name} — FECSYNC`,
            description:
              "Free Demo package. No charge. No credit or debit card required.",
          },
        },
      },
    ];
  } else {
    const unitAmount = Math.round((termTotalMajor ?? 0) * 100);
    if (!Number.isFinite(unitAmount) || unitAmount < 0) {
      throw new ForbiddenError(COMPANY_BILLING_PRICE_MESSAGE);
    }
    const termLabel =
      durationMonths === 1
        ? "monthly"
        : durationMonths % 12 === 0
          ? `${durationMonths / 12}-year`
          : `${durationMonths}-month`;
    lineItems = [
      {
        quantity: 1,
        price_data: {
          currency: (plan.currency || "USD").toLowerCase(),
          unit_amount: unitAmount,
          recurring: {
            interval: recurring.interval,
            interval_count: recurring.interval_count,
          },
          product_data: {
            name: `${plan.name} — FECSYNC (${termLabel})`,
            description: `${plan.name} package billed every ${termLabel} ($${termTotalMajor} ${plan.currency || "USD"}).`,
          },
        },
      },
    ];
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      client_reference_id: orgId,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // $0 Demo: Stripe skips card collection when nothing is due.
      ...(freeNoCardCheckout
        ? { payment_method_collection: "if_required" as const }
        : {}),
      metadata: {
        type: "company_subscription",
        orgId,
        plan: planId,
        actorSub: input.actor.sub,
        onboarding: onboarding ? "1" : "0",
        ...durationMeta,
        ...(freeNoCardCheckout
          ? { freeCheckout: "1", noCharge: "1", noCardRequired: "1" }
          : {}),
      },
      subscription_data: {
        metadata: {
          type: "company_subscription",
          orgId,
          plan: planId,
          actorSub: input.actor.sub,
          onboarding: onboarding ? "1" : "0",
          ...durationMeta,
          ...(freeNoCardCheckout
            ? { freeCheckout: "1", noCharge: "1", noCardRequired: "1" }
            : {}),
        },
        ...(demoTrialDays != null
          ? {
              trial_period_days: demoTrialDays,
              // End after trial — do not roll into forever $0 recurring that
              // would refresh/extend Demo via reconcile.
              cancel_at_period_end: true,
            }
          : {}),
      },
      custom_text: freeNoCardCheckout
        ? {
            submit: {
              message:
                "This Demo is free — you will not be charged and no card is required.",
            },
          }
        : {
            submit: {
              message: `You are subscribing to ${plan.name} for ${durationMonths === 1 ? "1 month" : durationMonths % 12 === 0 ? `${durationMonths / 12} year(s)` : `${durationMonths} months`} ($${termTotalMajor ?? "—"} ${plan.currency || "USD"} per term).`,
            },
          },
    },
    { idempotencyKey }
  );

  if (!session.url) {
    throw new Error("Stripe Checkout did not return a URL");
  }
  return { url: session.url };
}

export const COMPANY_ONBOARDING_SESSION_MESSAGE =
  "Invalid or incomplete company Checkout session";
export const COMPANY_ONBOARDING_UNPAID_MESSAGE =
  "Checkout payment is not complete yet";

/**
 * Client return from Stripe success_url — verify the Checkout session is paid
 * and activate the pending org immediately (idempotent with the webhook).
 * Does not trust client orgId; resolves tenant from Stripe customer binding.
 */
export async function confirmCompanyOnboardingCheckoutSession(
  sessionIdRaw: string,
  eventIdPrefix = "onboarding-confirm"
): Promise<{
  orgId: string;
  orgStatus: string;
  plan: string | null;
  billingEntitled: boolean;
  activated: boolean;
  email: string | null;
}> {
  const sessionId = sessionIdRaw.trim();
  if (!sessionId.startsWith("cs_")) {
    throw new ForbiddenError(COMPANY_ONBOARDING_SESSION_MESSAGE);
  }

  const stripe = getStripe();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.warn("[company-billing] onboarding confirm retrieve failed:", err);
    throw new ForbiddenError(COMPANY_ONBOARDING_SESSION_MESSAGE);
  }

  const metadata = (session.metadata || {}) as Record<string, string | undefined>;
  if (
    session.mode !== "subscription" ||
    metadata.type !== "company_subscription"
  ) {
    throw new ForbiddenError(COMPANY_ONBOARDING_SESSION_MESSAGE);
  }

  // Require a successful payment (or $0 trial / no_payment_required).
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    throw new ForbiddenError(COMPANY_ONBOARDING_UNPAID_MESSAGE);
  }
  if (session.status === "expired") {
    throw new ForbiddenError(COMPANY_ONBOARDING_UNPAID_MESSAGE);
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer &&
          typeof session.customer === "object" &&
          "id" in session.customer
        ? String(session.customer.id)
        : null;
  const claimedOrgId =
    metadata.orgId?.trim() ||
    (typeof session.client_reference_id === "string"
      ? session.client_reference_id.trim()
      : "");
  const boundByCustomer = await findOrgIdByStripeCustomerId(customerId);
  const orgId = boundByCustomer || claimedOrgId;
  if (!orgId || !boundByCustomer) {
    throw new ForbiddenError(COMPANY_ONBOARDING_SESSION_MESSAGE);
  }
  if (claimedOrgId && claimedOrgId !== boundByCustomer) {
    throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
  }

  const subscriptionRef = session.subscription;
  const subscriptionId =
    typeof subscriptionRef === "string"
      ? subscriptionRef
      : subscriptionRef && typeof subscriptionRef === "object"
        ? String(subscriptionRef.id)
        : null;
  if (!subscriptionId) {
    throw new ForbiddenError(COMPANY_ONBOARDING_SESSION_MESSAGE);
  }

  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { status: true },
  });
  const wasPending = before?.status === "pending";

  const sub = await retrieveStripeSubscriptionForApply(subscriptionId);
  await applyStripeSubscriptionToOrg(
    orgId,
    sub,
    `${eventIdPrefix}:${sessionId}`,
    Math.floor(Date.now() / 1000)
  );

  const state = await getCompanyBillingState(orgId);
  return {
    orgId,
    orgStatus: state.orgStatus,
    plan: state.plan,
    billingEntitled: state.billingEntitled,
    activated: wasPending && state.orgStatus === "active",
    email:
      typeof session.customer_details?.email === "string"
        ? session.customer_details.email
        : typeof session.customer_email === "string"
          ? session.customer_email
          : null,
  };
}

export async function createCompanyBillingPortal(input: {
  orgId: string;
  actor: {
    sub: string;
    preset?: string | null;
    membershipRole?: string | null;
  };
  returnUrl?: string;
  /**
   * Soft-hold / expired-suspend renew: open Portal without requiring
   * assertOrganizationActive (still blocks pending + non-expired ops suspend).
   */
  allowLockedRenew?: boolean;
}): Promise<{ url: string }> {
  const orgId = requireId(input.orgId, "orgId");
  await assertRegisteredCompanyBillingOrg(orgId);

  if (input.allowLockedRenew) {
    const row = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { status: true, subscriptionStatus: true },
    });
    if (!row || row.status === "pending") {
      throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
    }
    if (
      row.status === "suspended" &&
      row.subscriptionStatus !== "expired"
    ) {
      throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
    }
  } else {
    await assertOrganizationActive(orgId);
  }

  if (!isPlatformAdminActor(input.actor)) {
    throw new ForbiddenError(COMPANY_BILLING_ADMIN_ONLY_MESSAGE);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!org?.stripeCustomerId?.trim()) {
    throw new ForbiddenError(COMPANY_BILLING_NO_CUSTOMER_MESSAGE);
  }
  const customerId = org.stripeCustomerId.trim();

  try {
    await assertStripeCustomerBoundToOrg(orgId, customerId, customerId);
  } catch (err) {
    if (
      err instanceof ForbiddenError &&
      err.message === COMPANY_BILLING_STALE_CUSTOMER_MESSAGE
    ) {
      throw new ForbiddenError(COMPANY_BILLING_NO_CUSTOMER_MESSAGE);
    }
    throw err;
  }

  const stripe = getStripe();
  const returnUrl = assertSafeBillingReturnUrl(
    input.returnUrl?.trim() || companyBillingPortalReturnUrl()
  );
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  if (!session.url) {
    throw new Error("Stripe Billing Portal did not return a URL");
  }
  return { url: session.url };
}

/** Webhook-facing SaaS entitlement apply — must not touch marketplace / Connect tables. */
export async function applyStripeSubscriptionToOrg(
  orgId: string,
  stripeSub: StripeSubscriptionLike,
  eventId?: string | null,
  eventCreatedUnix?: number | null
): Promise<CompanyBillingState> {
  const id = requireId(orgId, "orgId");
  await assertRegisteredCompanyBillingOrg(id);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionEndsAt: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
      name: true,
      requestedPlan: true,
    },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError("Organization not found for subscription apply");
  }
  const priorEndsAtMs = org.subscriptionEndsAt?.getTime() ?? null;
  const activatingFromPending = org.status === "pending";
  const reactivatingFromExpiredSuspend =
    org.status === "suspended" && org.subscriptionStatus === "expired";
  const upgradingFromDemo =
    org.status === "active" && isDemoPlanId(org.subscriptionPlan);

  // Manual ops suspend (non-expired) stays locked until FECSYNC Approve.
  // Expired suspends auto-reactivate when Stripe renews a live paid period.
  // Demo demotion stays active — paid Checkout apply restores entitlements only
  // (never wipes tenant records).
  // Pending orgs: self-serve Checkout may activate below on a live mapped apply.
  if (org.status === "suspended" && !reactivatingFromExpiredSuspend) {
    console.warn(
      "[company-billing] skipping apply for suspended org",
      id,
      eventId
    );
    if (isApplicableStripeSubscriptionStatus(stripeSub.status)) {
      await retainStripeSubscriptionBinding(id, stripeSub.id);
    }
    await logActivityEntryAsync({
      orgId: id,
      action: "Company Billing Skipped Suspended",
      entityType: "Settings",
      entityId: id,
      description: `Stripe subscription event ignored while org suspended`,
      metadata: {
        domain: "company-billing",
        eventId: eventId ?? null,
        stripeSubscriptionId: stripeSub.id,
        stripeStatus: stripeSub.status,
      },
    });
    return getCompanyBillingState(id);
  }

  if (reactivatingFromExpiredSuspend) {
    if (!isApplicableStripeSubscriptionStatus(stripeSub.status)) {
      console.warn(
        "[company-billing] expired-suspend — skip non-applicable status",
        id,
        stripeSub.status,
        eventId
      );
      return getCompanyBillingState(id);
    }
    console.info(
      "[company-billing] expired-suspend — self-serve reactivation path",
      id,
      eventId
    );
  }

  if (upgradingFromDemo && isApplicableStripeSubscriptionStatus(stripeSub.status)) {
    console.info(
      "[company-billing] demo → paid — entitlement restore (records intact)",
      id,
      eventId
    );
  }

  if (org.status === "pending") {
    // Incomplete / non-applicable: do not activate — clear abandoned bindings only.
    if (!isApplicableStripeSubscriptionStatus(stripeSub.status)) {
      console.warn(
        "[company-billing] pending org — skip activate (non-applicable status)",
        id,
        stripeSub.status,
        eventId
      );
      const boundId = org.stripeSubscriptionId?.trim() || "";
      if (
        boundId === stripeSub.id &&
        (stripeSub.status === "incomplete" ||
          stripeSub.status === "incomplete_expired")
      ) {
        await clearAbandonedIncompleteSubscriptionBinding(
          id,
          stripeSub.id,
          `pending-apply-skip:${stripeSub.status}:${eventId || "no-event"}`
        );
      }
      await logActivityEntryAsync({
        orgId: id,
        action: "Company Billing Skipped Pending Incomplete",
        entityType: "Settings",
        entityId: id,
        description: `Ignored Stripe status ${stripeSub.status} while org pending onboarding payment`,
        metadata: {
          domain: "company-billing",
          eventId: eventId ?? null,
          stripeSubscriptionId: stripeSub.id,
          stripeStatus: stripeSub.status,
        },
      });
      return getCompanyBillingState(id);
    }
    // Live applicable — fall through to activate + stamp in the main write path.
    console.info(
      "[company-billing] pending org — self-serve activation path",
      id,
      eventId
    );
  }

  const eid = typeof eventId === "string" ? eventId.trim() : "";

  const createdUnix =
    typeof eventCreatedUnix === "number" && Number.isFinite(eventCreatedUnix)
      ? Math.floor(eventCreatedUnix)
      : null;

  // Abandoned / incomplete Checkout must not stamp past_due or a live sub id.
  if (!isApplicableStripeSubscriptionStatus(stripeSub.status)) {
    console.warn(
      "[company-billing] skipping non-applicable Stripe status",
      stripeSub.status,
      id,
      eventId
    );
    const boundId = org.stripeSubscriptionId?.trim() || "";
    // subscription.updated → incomplete_expired: clear binding (same as expire path).
    if (
      boundId === stripeSub.id &&
      (stripeSub.status === "incomplete" ||
        stripeSub.status === "incomplete_expired")
    ) {
      await clearAbandonedIncompleteSubscriptionBinding(
        id,
        stripeSub.id,
        `apply-skip:${stripeSub.status}:${eventId || "no-event"}`
      );
    }
    await logActivityEntryAsync({
      orgId: id,
      action: "Company Billing Skipped Incomplete",
      entityType: "Settings",
      entityId: id,
      description: `Ignored Stripe subscription status ${stripeSub.status}`,
      metadata: {
        domain: "company-billing",
        eventId: eventId ?? null,
        stripeSubscriptionId: stripeSub.id,
        stripeStatus: stripeSub.status,
      },
    });
    return getCompanyBillingState(id);
  }

  // Sibling guard: never let a concurrent Checkout overwrite a still-live binding
  // (payment_failed already rejects siblings; invoice.paid/subscription.* must too).
  const boundSubId = org.stripeSubscriptionId?.trim() || "";
  if (boundSubId && boundSubId !== stripeSub.id) {
    let boundStillLive = false;
    try {
      const stripe = getStripe();
      const bound = await stripe.subscriptions.retrieve(boundSubId);
      boundStillLive = isLiveStripeSubscriptionStatus(bound.status);
    } catch (err) {
      if (err instanceof CompanyBillingConfigError) {
        // Stripe down — keep existing binding; do not adopt sibling.
        boundStillLive = true;
      } else if (!isStripeResourceMissing(err)) {
        console.warn(
          "[company-billing] sibling bound retrieve deferred — skipping apply",
          id,
          boundSubId,
          stripeSub.id,
          err
        );
        boundStillLive = true;
      }
    }
    if (boundStillLive) {
      console.warn(
        "[company-billing] skipping sibling subscription apply",
        id,
        "bound=",
        boundSubId,
        "event=",
        stripeSub.id
      );
      await logActivityEntryAsync({
        orgId: id,
        action: "Company Billing Skipped Sibling",
        entityType: "Settings",
        entityId: id,
        description: `Ignored Stripe subscription ${stripeSub.id} while live binding ${boundSubId} remains`,
        metadata: {
          domain: "company-billing",
          eventId: eventId ?? null,
          stripeSubscriptionId: stripeSub.id,
          boundSubscriptionId: boundSubId,
        },
      });
      // Cancel the orphan sibling so ignored events cannot keep charging.
      const cancelled = await bestEffortCancelStripeSubscription(stripeSub.id);
      await logActivityEntryAsync({
        orgId: id,
        action: cancelled
          ? "Company Billing Sibling Cancelled"
          : "Company Billing Sibling Cancel Incomplete",
        entityType: "Settings",
        entityId: id,
        description: cancelled
          ? `Cancelled sibling Stripe subscription ${stripeSub.id}`
          : `Best-effort cancel incomplete for sibling ${stripeSub.id}`,
        metadata: {
          domain: "company-billing",
          eventId: eventId ?? null,
          stripeSubscriptionId: stripeSub.id,
          boundSubscriptionId: boundSubId,
          cancelled,
        },
      });
      return getCompanyBillingState(id);
    }
  }

  const customerId =
    typeof stripeSub.customer === "string"
      ? stripeSub.customer
      : stripeSub.customer &&
          typeof stripeSub.customer === "object" &&
          "id" in stripeSub.customer
        ? String(stripeSub.customer.id)
        : null;

  // Prefer DB binding over subscription metadata; block cross-tenant attach.
  await assertStripeCustomerBoundToOrg(id, customerId, org.stripeCustomerId);

  const metaOrg = stripeSub.metadata?.orgId?.trim();
  if (metaOrg && metaOrg !== id) {
    throw new ForbiddenError(COMPANY_BILLING_CUSTOMER_MISMATCH_MESSAGE);
  }

  const priceId = priceIdFromSubscription(stripeSub);
  // Price→plan first; pending / expired-reactivate may fall back to metadata / interest.
  const mappedPlan = resolvePlanForSubscriptionApply(
    stripeSub,
    org.status,
    org.requestedPlan ?? org.subscriptionPlan,
    reactivatingFromExpiredSuspend
  );

  if (!mappedPlan) {
    console.warn(
      "[company-billing] apply without mapped plan — refusing partial write",
      priceId,
      id,
      eventId
    );
    await retainStripeSubscriptionBinding(id, stripeSub.id);
    await logActivityEntryAsync({
      orgId: id,
      action: "Company Billing Skipped Unmapped Plan",
      entityType: "Settings",
      entityId: id,
      description: `Stripe price ${priceId ?? "unknown"} did not map to a plan`,
      metadata: {
        domain: "company-billing",
        eventId: eventId ?? null,
        stripeSubscriptionId: stripeSub.id,
        priceId,
      },
    });
    return getCompanyBillingState(id);
  }

  const subscriptionStatus = mapStripeSubscriptionStatus(stripeSub.status);
  let endsAtSec = periodEndUnixFromSubscription(stripeSub);
  // Pending / expired-suspend self-serve: never leave a paid live sub stuck without endsAt.
  if (
    (org.status === "pending" || reactivatingFromExpiredSuspend) &&
    (subscriptionStatus === "active" ||
      subscriptionStatus === "trialing" ||
      subscriptionStatus === "past_due") &&
    (endsAtSec == null || !Number.isFinite(endsAtSec))
  ) {
    endsAtSec = Math.floor(onboardingOpsGrantEndsAt().getTime() / 1000);
    console.warn(
      "[company-billing] pending/reactivate apply — using ops-grant endsAt fallback",
      id,
      stripeSub.id
    );
  }
  let subscriptionEndsAt =
    typeof endsAtSec === "number" && Number.isFinite(endsAtSec)
      ? new Date(endsAtSec * 1000)
      : null;

  const liveBilling =
    subscriptionStatus === "active" ||
    subscriptionStatus === "trialing" ||
    subscriptionStatus === "past_due";
  // Never write live billing with null endsAt — that bypasses lazy expire + reconcile.
  if (liveBilling && !subscriptionEndsAt) {
    console.warn(
      "[company-billing] apply without period end — refusing live write",
      id,
      eventId,
      stripeSub.status
    );
    await retainStripeSubscriptionBinding(id, stripeSub.id);
    await logActivityEntryAsync({
      orgId: id,
      action: "Company Billing Skipped Missing Period End",
      entityType: "Settings",
      entityId: id,
      description: `Stripe subscription ${stripeSub.id} missing period end`,
      metadata: {
        domain: "company-billing",
        eventId: eventId ?? null,
        stripeSubscriptionId: stripeSub.id,
        stripeStatus: stripeSub.status,
      },
    });
    return getCompanyBillingState(id);
  }
  // Never stamp an already-overdue period end onto a live sub — that creates
  // active+past endsAt and races lazy expire vs ops unlock success.
  // Pending onboarding / expired-suspend renew exception: bump endsAt forward.
  if (
    liveBilling &&
    subscriptionEndsAt &&
    subscriptionEndsAt.getTime() <= Date.now()
  ) {
    if (org.status === "pending" || reactivatingFromExpiredSuspend) {
      subscriptionEndsAt = onboardingOpsGrantEndsAt();
      console.warn(
        "[company-billing] pending/reactivate apply — past period end, using grant window",
        id,
        stripeSub.id
      );
    } else {
      console.warn(
        "[company-billing] apply with past period end — refusing live write",
        id,
        eventId,
        stripeSub.status,
        subscriptionEndsAt.toISOString()
      );
      await retainStripeSubscriptionBinding(id, stripeSub.id);
      // Only stamp grace on THIS subscription binding — never false-dunning a
      // different live bound sub when a sibling past-end event arrives.
      // Skip if DB endsAt was already advanced (concurrent apply won).
      await prisma.organization.updateMany({
        where: {
          id,
          status: "active",
          stripeSubscriptionId: stripeSub.id,
          OR: [
            { subscriptionEndsAt: null },
            { subscriptionEndsAt: { lte: new Date() } },
          ],
        },
        data: { subscriptionStatus: "past_due" },
      });
      await logActivityEntryAsync({
        orgId: id,
        action: "Company Billing Skipped Past Period End",
        entityType: "Settings",
        entityId: id,
        description: `Stripe subscription ${stripeSub.id} period end already past`,
        metadata: {
          domain: "company-billing",
          eventId: eventId ?? null,
          stripeSubscriptionId: stripeSub.id,
          stripeStatus: stripeSub.status,
          subscriptionEndsAt: subscriptionEndsAt.toISOString(),
        },
      });
      // Soft-hold stamp must sync with Step 3 past_due notice (CTA adapts when locked).
      try {
        const { notifyCompanyPastDue } = await import(
          "@/lib/companySubscriptionNotices"
        );
        await notifyCompanyPastDue(id);
      } catch (err) {
        console.warn(
          "[company-billing] past_due notice after past-period refuse failed:",
          err
        );
      }
      return getCompanyBillingState(id);
    }
  }

  // Ordering watermark must be an event clock, never period end / wall clock.
  // Synthetic refreshes (reconcile/lazy/ops) must NOT advance it — that poisons
  // later Stripe webhooks with older event.created (false stale skip).
  const nowSec = Math.floor(Date.now() / 1000);
  const syntheticApply = isSyntheticBillingApplyEvent(eid || eventId);
  const watermarkUnix = syntheticApply
    ? null
    : createdUnix != null
      ? createdUnix
      : nowSec;

  // Org plan columns + Applied audit row in one transaction so a swallowed
  // ActivityLog write cannot leave an applied plan without a watermark
  // (which would allow older Stripe events to overwrite newer state).
  // Watermark columns on Organization are SSOT; ActivityLog remains audit trail.
  type ApplyTxResult =
    | { kind: "applied" }
    | { kind: "skip"; reason: string };

  const txResult = await prisma.$transaction(async (tx) => {
    type OrgLockRow = {
      status: string;
      stripeCustomerId: string | null;
      stripeBillingLastEventId: string | null;
      stripeBillingLastEventCreated: number | null;
    };
    const locked = await tx.$queryRaw<OrgLockRow[]>`
      SELECT "status", "stripeCustomerId", "stripeBillingLastEventId", "stripeBillingLastEventCreated"
      FROM "organizations"
      WHERE "id" = ${id}
      FOR UPDATE
    `;
    const row = locked[0];
    if (
      !row ||
      (row.status !== "active" &&
        row.status !== "pending" &&
        !(
          row.status === "suspended" &&
          reactivatingFromExpiredSuspend
        )) ||
      row.stripeCustomerId !== customerId
    ) {
      return { kind: "skip", reason: "race" } as ApplyTxResult;
    }

    if (eid && row.stripeBillingLastEventId === eid) {
      return { kind: "skip", reason: "idempotent" } as ApplyTxResult;
    }

    const prevRaw = row.stripeBillingLastEventCreated;
    const prevCreated =
      prevRaw != null && prevRaw > nowSec + 3600 ? null : prevRaw;
    // Synthetic refreshes never stale-skip on watermark (and do not advance it).
    if (
      !syntheticApply &&
      watermarkUnix != null &&
      prevCreated != null &&
      watermarkUnix < prevCreated
    ) {
      return { kind: "skip", reason: "stale" } as ApplyTxResult;
    }

    const written = await tx.organization.updateMany({
      where: {
        id,
        status: {
          in: reactivatingFromExpiredSuspend
            ? ["active", "pending", "suspended"]
            : ["active", "pending"],
        },
        stripeCustomerId: customerId,
        ...(reactivatingFromExpiredSuspend
          ? { subscriptionStatus: "expired" }
          : {}),
      },
      data: {
        status: "active",
        ...(row.status === "pending" || reactivatingFromExpiredSuspend
          ? { approvedAt: new Date(), approvedById: null }
          : {}),
        subscriptionPlan: mappedPlan,
        subscriptionStatus,
        subscriptionEndsAt,
        subscriptionInterval: (() => {
          const fromStripe = subscriptionIntervalFromStripeRecurring(
            recurringFromSubscription(stripeSub)
          );
          if (fromStripe && fromStripe !== "month") return fromStripe;
          const metaMonths = stripeSub.metadata?.durationMonths;
          if (metaMonths != null && String(metaMonths).trim() !== "") {
            return subscriptionIntervalFromDurationMonths(
              normalizeBillingDurationMonths(metaMonths)
            );
          }
          return fromStripe || "month";
        })(),
        subscriptionCancelAtPeriodEnd: Boolean(stripeSub.cancel_at_period_end),
        stripeSubscriptionId: stripeSub.id,
      },
    });
    if (written.count === 0) {
      return { kind: "skip", reason: "race" } as ApplyTxResult;
    }

    // Real Stripe events only — synthetic reconcile/lazy/ops must not poison
    // event.created ordering for later webhooks.
    if (!syntheticApply && watermarkUnix != null) {
      await tx.$executeRaw`
        UPDATE "organizations"
        SET
          "stripeBillingLastEventId" = ${eid || null},
          "stripeBillingLastEventCreated" = ${watermarkUnix}
        WHERE "id" = ${id}
      `;
    }

    await tx.activityLog.create({
      data: {
        orgId: id,
        action:
          row.status === "pending"
            ? "Company Subscription Activated Onboarding"
            : reactivatingFromExpiredSuspend
              ? "Company Subscription Reactivated After Expire"
              : "Company Subscription Applied",
        entityType: "Settings",
        entityId: id,
        description:
          row.status === "pending"
            ? `Self-serve payment activated org + applied Stripe subscription ${stripeSub.id} (${subscriptionStatus})`
            : reactivatingFromExpiredSuspend
              ? `Auto-reactivated expired org via Stripe subscription ${stripeSub.id} (${subscriptionStatus})`
              : upgradingFromDemo
                ? `Restored entitlements from Demo via Stripe subscription ${stripeSub.id} (${subscriptionStatus}) — records intact`
                : `Applied Stripe subscription ${stripeSub.id} (${subscriptionStatus})`,
        metadata: {
          domain: "company-billing",
          eventId: eid || eventId || null,
          stripeEventCreated: watermarkUnix,
          syntheticApply,
          plan: mappedPlan,
          subscriptionStatus,
          stripeSubscriptionId: stripeSub.id,
          activatedFromPending: row.status === "pending",
          reactivatedFromExpired: reactivatingFromExpiredSuspend,
          restoredFromDemo: upgradingFromDemo,
          dataPreserved: true,
        },
      },
    });

    return { kind: "applied" } as ApplyTxResult;
  }, {
    // FOR UPDATE + raw watermark + ActivityLog — default 5s flakes under load
    // and can abort after org columns write (invalid applied-without-audit).
    maxWait: 10_000,
    timeout: 20_000,
  });

  if (txResult.kind === "skip") {
    if (txResult.reason === "stale") {
      console.warn(
        "[company-billing] skipping stale Stripe event",
        id,
        eid || null,
        watermarkUnix
      );
      await logActivityEntryAsync({
        orgId: id,
        action: "Company Billing Skipped Stale Event",
        entityType: "Settings",
        entityId: id,
        description: `Stripe apply ignored — event older than last applied`,
        metadata: {
          domain: "company-billing",
          eventId: eid || null,
          stripeEventCreated: watermarkUnix,
          stripeSubscriptionId: stripeSub.id,
        },
      });
    } else if (txResult.reason === "race") {
      console.warn(
        "[company-billing] apply skipped — org not active/pending or customer unbound",
        id,
        eventId
      );
      await logActivityEntryAsync({
        orgId: id,
        action: "Company Billing Skipped Apply Race",
        entityType: "Settings",
        entityId: id,
        description: `Stripe apply ignored — org not active/pending or customer mismatch`,
        metadata: {
          domain: "company-billing",
          eventId: eventId ?? null,
          stripeSubscriptionId: stripeSub.id,
        },
      });
    }
    return getCompanyBillingState(id);
  }

  // Self-serve onboarding / post-expire renew: notify when payment unlocked access.
  if (activatingFromPending || reactivatingFromExpiredSuspend) {
    try {
      const { notifyCompanySelfServeActivated } = await import(
        "@/lib/companySubscriptionNotices"
      );
      await notifyCompanySelfServeActivated(id);
    } catch (err) {
      console.warn(
        "[company-billing] onboarding/reactivate activate notice failed:",
        err
      );
    }
  }

  // Drop sibling live Checkout subscriptions so concurrent sessions cannot
  // leave an unbound sub still charging after this apply wins.
  await bestEffortCancelOtherLiveSubscriptions(customerId, stripeSub.id, id);

  // Fresh entitled period → reset Step 3 notice watermarks (best-effort).
  // Do not clear past_due watermark while still past_due — that would allow
  // past_due mail to re-fire on a later invoice.payment_failed after a period
  // refresh. When endsAt advances into a new period, always clear remind
  // watermarks so 7/3/1 windows can fire again.
  try {
    const again = await prisma.organization.findUnique({
      where: { id },
      select: { subscriptionEndsAt: true, subscriptionStatus: true },
    });
    const newEndsAtMs = again?.subscriptionEndsAt?.getTime() ?? null;
    const endsAtAdvanced =
      newEndsAtMs != null &&
      (priorEndsAtMs == null || newEndsAtMs > priorEndsAtMs);
    if (
      again?.subscriptionEndsAt &&
      again.subscriptionEndsAt.getTime() > Date.now() &&
      (again.subscriptionStatus === "active" ||
        again.subscriptionStatus === "trialing")
    ) {
      const { clearCompanySubscriptionNoticeWatermarks } = await import(
        "@/lib/companySubscriptionNotices"
      );
      await clearCompanySubscriptionNoticeWatermarks(id);
    } else if (endsAtAdvanced) {
      const { clearCompanySubscriptionRemindWatermarks } = await import(
        "@/lib/companySubscriptionNotices"
      );
      await clearCompanySubscriptionRemindWatermarks(id);
    }
  } catch (err) {
    console.warn("[company-billing] clear notice watermarks failed:", err);
  }

  clearCachedStaffGatesForOrg(id);

  return getCompanyBillingState(id);
}

/**
 * Unpaid / canceled period end, or Demo trial end.
 *
 * - Paid (non-Demo) overdue: after COMPANY_BILLING_GRACE_DAYS → demote to Demo
 *   (active + locked apps; records intact).
 * - Demo trial overdue: suspend immediately when subscriptionEndsAt passes
 *   (no grace). Self-serve renew stays locked until FECSYNC reactivates
 *   Demo via Company workspaces Approve or emergency Set plan — then upgrade.
 *
 * Never deletes org catalog/orders/venues/memberships/history.
 */
export async function markOrganizationSubscriptionExpired(
  orgId: string,
  reason: string,
  options?: { cancelStripe?: boolean; requireStillOverdue?: boolean }
): Promise<CompanyBillingState> {
  const id = requireId(orgId, "orgId");
  await assertRegisteredCompanyBillingOrg(id);
  const cancelStripe = options?.cancelStripe !== false;
  const requireStillOverdue = options?.requireStillOverdue === true;

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      isDefault: true,
      name: true,
      status: true,
      subscriptionPlan: true,
      requestedPlan: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
    },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError("Organization not found");
  }

  const priorSubId = org.stripeSubscriptionId?.trim() || null;
  const now = new Date();
  const graceCutoff = billingGraceDemoteCutoff(now);
  const graceDays = companyBillingGraceDays();
  const priorPlan =
    org.subscriptionPlan?.trim().toLowerCase() ||
    org.requestedPlan?.trim().toLowerCase() ||
    null;
  const expireDemoTrial = isDemoPlanId(org.subscriptionPlan);
  // Demo suspends at period end (no renewal grace). Paid plans wait for grace.
  const endsAtCutoff = expireDemoTrial ? now : graceCutoff;

  const transitioned = await prisma.$transaction(async (tx) => {
    const result = await tx.organization.updateMany({
      where: {
        id,
        status: "active",
        ...(expireDemoTrial ? { subscriptionPlan: "demo" } : {}),
        ...(requireStillOverdue
          ? {
              // Dated period end only. past_due + null endsAt stays soft-held
              // until Stripe stamps a period (paid path) — Demo always has endsAt.
              subscriptionEndsAt: { lt: endsAtCutoff },
            }
          : {}),
      },
      data: expireDemoTrial
        ? {
            ...organizationSubscriptionExpiredData(),
            // Keep plan=demo so ops UI + renew gates know this is Demo expiry.
            subscriptionPlan: "demo",
            // Allow Demo-suspend notice after an earlier paid→Demo demotion notice.
            subscriptionNoticeExpiredAt: null,
          }
        : {
            ...organizationSubscriptionDemotedToDemoData({
              priorPlan,
              from: now,
            }),
            stripeSubscriptionId: priorSubId,
          },
    });
    if (result.count > 0) {
      await clearOrganizationBillingEventWatermark(id, tx);
      await tx.activityLog.create({
        data: {
          orgId: id,
          action: expireDemoTrial
            ? "Company Demo Trial Expired"
            : "Company Subscription Demoted To Demo",
          entityType: "Settings",
          entityId: id,
          description: (expireDemoTrial
            ? `Suspended "${org.name}" after Demo trial ended — ${reason}. Contact ops to reactivate Demo. Records kept.`
            : `Moved "${org.name}" to Demo after unpaid period + ${graceDays}d grace — ${reason}. All company records kept.`
          ).slice(0, 500),
          metadata: {
            domain: "company-billing",
            reason,
            cancelStripe,
            stripeCancelPending: cancelStripe,
            requireStillOverdue,
            graceDays: expireDemoTrial ? 0 : graceDays,
            graceCutoff: endsAtCutoff.toISOString(),
            priorPlan,
            demotedTo: expireDemoTrial ? null : "demo",
            demoTrialSuspended: expireDemoTrial,
            dataPreserved: true,
          },
        },
      });
    }
    return result;
  });

  let canceled = false;
  if (cancelStripe) {
    const mayCancelStripe =
      transitioned.count > 0 || org.status === "suspended";
    if (!mayCancelStripe) {
      console.warn(
        "[company-billing] skip Stripe cancel — org not transitioned after expire no-op",
        id,
        reason
      );
    } else {
      canceled = await bestEffortCancelLiveStripeSubscriptionsForOrg({
        stripeSubscriptionId: priorSubId,
        stripeCustomerId: org.stripeCustomerId,
      });
      if (canceled && priorSubId) {
        await prisma.organization.updateMany({
          where: {
            id,
            stripeSubscriptionId: priorSubId,
          },
          data: { stripeSubscriptionId: null },
        });
      }
      if (transitioned.count > 0) {
        await logActivityEntryAsync({
          orgId: id,
          action: "Company Subscription Stripe Cancel",
          entityType: "Settings",
          entityId: id,
          description: canceled
            ? `Canceled Stripe subscription(s) after ${expireDemoTrial ? "Demo trial suspend" : "Demo demotion"} for "${org.name}"`
            : `Stripe cancel incomplete after expire for "${org.name}" — binding retained`,
          metadata: {
            domain: "company-billing",
            reason,
            stripeCanceled: canceled,
            stripeSubscriptionId: priorSubId,
            dataPreserved: true,
            demoTrialSuspended: expireDemoTrial,
          },
        });
      }
    }
  }

  if (transitioned.count > 0) {
    try {
      const { notifyCompanyExpired } = await import(
        "@/lib/companySubscriptionNotices"
      );
      await notifyCompanyExpired(id);
    } catch (err) {
      console.warn(
        expireDemoTrial
          ? "[company-billing] demo-trial suspend notice failed:"
          : "[company-billing] demo-demotion notice failed:",
        err
      );
    }
  }

  if (transitioned.count > 0) {
    clearCachedStaffGatesForOrg(id);
  }

  return getCompanyBillingState(id);
}

/**
 * Reconcile-style refresh for lazy expire: if a bound Stripe sub is still live
 * with a future period end, re-apply and return true (do not suspend).
 * Transient Stripe errors return null (caller may fail-close locally without cancel).
 */
export async function tryRefreshBoundSubscriptionIfLive(
  orgId: string
): Promise<boolean | null> {
  const id = requireId(orgId, "orgId");
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      status: true,
      isDefault: true,
      stripeSubscriptionId: true,
      subscriptionPlan: true,
      subscriptionEndsAt: true,
    },
  });
  if (!org || org.isDefault || org.status !== "active") return false;
  const subId = org.stripeSubscriptionId?.trim() || "";
  if (!subId) return false;

  // Demo trial past endsAt: never extend via Stripe period refresh — durable
  // suspend (ops reactivate) must run instead.
  if (
    isDemoPlanId(org.subscriptionPlan) &&
    org.subscriptionEndsAt != null &&
    org.subscriptionEndsAt.getTime() <= Date.now()
  ) {
    console.warn(
      "[company-billing] lazy refresh skip — Demo trial ended; refuse Stripe extend",
      id,
      subId
    );
    return false;
  }

  try {
    const stripe = getStripe();
    const sub = (await stripe.subscriptions.retrieve(
      subId
    )) as unknown as StripeSubscriptionLike;
    if (!isLiveStripeSubscriptionStatus(sub.status)) return false;
    const endsAtSec = periodEndUnixFromSubscription(sub);
    // Align with reconcile: live Stripe + unparseable period end → do NOT
    // durable-expire (would cancel a still-billing sub). Soft-deny like outage.
    if (typeof endsAtSec !== "number" || !Number.isFinite(endsAtSec)) {
      console.warn(
        "[company-billing] lazy refresh skip — live sub missing period end",
        id,
        sub.id,
        sub.status
      );
      return null;
    }
    if (endsAtSec * 1000 <= Date.now()) {
      // Live Stripe with past period end — for Demo, allow durable expire.
      // Paid: period-boundary lag; do NOT cancel (align with reconcile skip).
      if (isDemoPlanId(org.subscriptionPlan)) {
        console.warn(
          "[company-billing] lazy refresh — Demo live+past → expire path",
          id,
          sub.id
        );
        return false;
      }
      console.warn(
        "[company-billing] lazy refresh skip — live sub period end still past",
        id,
        sub.id,
        sub.status
      );
      await applyStripeSubscriptionToOrg(
        id,
        sub,
        `lazy-refresh-past:${sub.id}:${endsAtSec}`,
        Math.floor(Date.now() / 1000)
      );
      return null;
    }
    const mappedPlan = resolvePlanForSubscriptionApply(
      sub,
      "active",
      org.subscriptionPlan,
      true
    );
    // Never refresh-extend a Demo org onto a new Stripe period (mapped Demo Price).
    if (isDemoPlanId(org.subscriptionPlan) || isDemoPlanId(mappedPlan)) {
      // Future Stripe period on Demo is only OK while org Demo endsAt still future
      // (already gated above). If we got here, org Demo is still in window —
      // skip apply that could drift endsAt past COMPANY_DEMO_DAYS via Stripe.
      if (isDemoPlanId(org.subscriptionPlan)) {
        return true;
      }
    }
    // Unmapped price: apply retains binding but does not stamp plan/endsAt —
    // treat as refresh failure so lazy expire can durable-suspend.
    // price_data Checkouts resolve via metadata (resolvePlanForSubscriptionApply).
    if (!mappedPlan) return false;
    await applyStripeSubscriptionToOrg(
      id,
      sub,
      `lazy-refresh:${sub.id}:${endsAtSec}`,
      Math.floor(Date.now() / 1000)
    );
    const again = await prisma.organization.findUnique({
      where: { id },
      select: {
        subscriptionEndsAt: true,
        subscriptionPlan: true,
      },
    });
    if (
      again?.subscriptionPlan !== mappedPlan ||
      !again.subscriptionEndsAt ||
      again.subscriptionEndsAt.getTime() <= Date.now()
    ) {
      // Soft-skip (stale watermark / race): Stripe is still live+future — never
      // durable-expire/cancel. Align with ops-unlock fail-closed → null.
      console.warn(
        "[company-billing] lazy refresh soft-skip — apply did not advance endsAt",
        id,
        sub.id
      );
      return null;
    }
    return true;
  } catch (err) {
    if (err instanceof CompanyBillingConfigError) {
      return null;
    }
    console.warn("[company-billing] lazy Stripe refresh deferred:", id, err);
    return null;
  }
}

/**
 * Expire only when the Stripe event refers to this org's bound live subscription.
 * Abandoned incomplete Checkout delete/cancel must not suspend active tenants.
 */
export async function expireIfBoundStripeSubscription(
  orgId: string,
  stripeSubscriptionId: string | null | undefined,
  reason: string
): Promise<{ expired: boolean; billing: CompanyBillingState }> {
  const id = requireId(orgId, "orgId");
  await assertRegisteredCompanyBillingOrg(id);
  const subId =
    typeof stripeSubscriptionId === "string" ? stripeSubscriptionId.trim() : "";
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { stripeSubscriptionId: true, status: true },
  });
  const boundId = org?.stripeSubscriptionId?.trim() || "";
  if (!subId || !boundId || boundId !== subId) {
    console.warn(
      "[company-billing] skip expire — subscription not bound to org",
      id,
      subId || null,
      org?.stripeSubscriptionId ?? null
    );
    await logActivityEntryAsync({
      orgId: id,
      action: "Company Billing Skipped Unbound Expire",
      entityType: "Settings",
      entityId: id,
      description: `Ignored Stripe expire for unbound subscription ${subId || "unknown"}`,
      metadata: {
        domain: "company-billing",
        reason,
        stripeSubscriptionId: subId || null,
        boundSubscriptionId: org?.stripeSubscriptionId ?? null,
      },
    });
    return { expired: false, billing: await getCompanyBillingState(id) };
  }

  // Incomplete Checkout noise must never suspend — clear binding only.
  try {
    const stripe = getStripe();
    const remote = await stripe.subscriptions.retrieve(subId);
    if (
      remote.status === "incomplete" ||
      remote.status === "incomplete_expired"
    ) {
      await clearAbandonedIncompleteSubscriptionBinding(id, subId, reason);
      return { expired: false, billing: await getCompanyBillingState(id) };
    }
  } catch (err) {
    if (err instanceof CompanyBillingConfigError) {
      // Dev/smoke without Stripe — fall through to durable expire.
    } else if (isStripeResourceMissing(err)) {
      // Sub already gone — durable expire is appropriate.
    } else {
      // Transient Stripe errors: do NOT durable-suspend — may be incomplete
      // binding that clear-only path would handle when Stripe recovers.
      console.warn(
        "[company-billing] expire retrieve deferred — soft-skip (no suspend)",
        id,
        subId,
        err
      );
      return { expired: false, billing: await getCompanyBillingState(id) };
    }
  }

  const wasActive = org?.status === "active";
  const billing = await markOrganizationSubscriptionExpired(id, reason, {
    requireStillOverdue: true,
  });
  // Stripe confirmed this bound sub is gone, but requireStillOverdue skipped
  // demotion (still before endsAt, or still inside COMPANY_BILLING_GRACE_DAYS).
  // Keep period-end + grace soft-hold intact — do NOT clear binding / normalize
  // past_due (that would wipe plan/endsAt and unlock admin mid-grace).
  if (billing.orgStatus === "active") {
    const row = await prisma.organization.findUnique({
      where: { id },
      select: {
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        subscriptionPlan: true,
        stripeSubscriptionId: true,
      },
    });
    const keepThroughPeriodEnd =
      (row?.subscriptionStatus === "active" ||
        row?.subscriptionStatus === "trialing") &&
      row.subscriptionEndsAt != null &&
      row.subscriptionEndsAt.getTime() > Date.now() &&
      row.stripeSubscriptionId?.trim() === subId;

    const { isPastBillingGracePeriod } = await import("@/lib/billingGrace");
    const liveStatus =
      row?.subscriptionStatus === "active" ||
      row?.subscriptionStatus === "trialing" ||
      row?.subscriptionStatus === "past_due";
    const keepThroughBillingGrace =
      liveStatus &&
      row?.subscriptionPlan?.trim().toLowerCase() !== "demo" &&
      row?.subscriptionEndsAt != null &&
      row.subscriptionEndsAt.getTime() < Date.now() &&
      !isPastBillingGracePeriod(row.subscriptionEndsAt) &&
      row.stripeSubscriptionId?.trim() === subId;

    if (keepThroughPeriodEnd || keepThroughBillingGrace) {
      if (keepThroughBillingGrace) {
        console.warn(
          "[company-billing] keep binding through renewal grace — skip clear/normalize",
          id,
          subId,
          reason
        );
      }
      return {
        expired: false,
        billing: await getCompanyBillingState(id),
      };
    }
    const cleared = await prisma.organization.updateMany({
      where: {
        id,
        status: "active",
        stripeSubscriptionId: subId,
      },
      data: { stripeSubscriptionId: null },
    });
    if (cleared.count > 0) {
      await normalizeUnboundPastDueGrace(id);
      await logActivityEntryAsync({
        orgId: id,
        action: "Company Billing Cleared Dead Binding",
        entityType: "Settings",
        entityId: id,
        description: `Cleared Stripe subscription ${subId} without suspend (org still active / not overdue)`,
        metadata: {
          domain: "company-billing",
          reason,
          stripeSubscriptionId: subId,
        },
      });
    }
    return {
      expired: false,
      billing: await getCompanyBillingState(id),
    };
  }
  return {
    expired: wasActive && billing.orgStatus === "suspended",
    billing,
  };
}

/**
 * Drop an abandoned incomplete Checkout binding without suspending the tenant.
 */
async function clearAbandonedIncompleteSubscriptionBinding(
  orgId: string,
  stripeSubscriptionId: string,
  reason: string
): Promise<void> {
  const result = await prisma.organization.updateMany({
    where: {
      id: orgId,
      isDefault: false,
      stripeSubscriptionId,
    },
    data: { stripeSubscriptionId: null },
  });
  if (result.count === 0) return;
  await normalizeUnboundPastDueGrace(orgId);
  console.warn(
    "[company-billing] cleared incomplete Checkout binding (no suspend)",
    orgId,
    stripeSubscriptionId,
    reason
  );
  await logActivityEntryAsync({
    orgId,
    action: "Company Billing Cleared Incomplete Binding",
    entityType: "Settings",
    entityId: orgId,
    description:
      "Cleared abandoned incomplete Stripe subscription binding without suspending",
    metadata: {
      domain: "company-billing",
      reason,
      stripeSubscriptionId,
    },
  });
}

/**
 * End a free Demo Stripe subscription so paid Checkout can start.
 * Never used for paid live subs (those stay portal-only).
 */
async function cancelDemoSubscriptionForPaidUpgrade(
  orgId: string,
  stripeSubscriptionId: string,
  reason: string
): Promise<void> {
  try {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(stripeSubscriptionId);
  } catch (err) {
    if (!isStripeResourceMissing(err)) {
      console.warn(
        "[company-billing] demo cancel for upgrade failed:",
        orgId,
        stripeSubscriptionId,
        err
      );
      throw new ForbiddenError(COMPANY_BILLING_USE_PORTAL_MESSAGE);
    }
  }
  await clearAbandonedIncompleteSubscriptionBinding(
    orgId,
    stripeSubscriptionId,
    reason
  );
  await logActivityEntryAsync({
    orgId,
    action: "Company Billing Demo Cleared For Upgrade",
    entityType: "Settings",
    entityId: orgId,
    description:
      "Canceled free Demo Stripe subscription so paid Checkout can start",
    metadata: {
      domain: "company-billing",
      reason,
      stripeSubscriptionId,
    },
  });
}

export async function markOrganizationPastDue(
  orgId: string,
  options?: {
    adoptSubscriptionId?: string | null;
    /** Required to adopt — incomplete Checkout must never bind via payment_failed. */
    stripeStatus?: string | null;
  }
): Promise<void> {
  const id = asIdString(orgId);
  if (!id) return;
  const storefrontOrgId = await getStorefrontOrgId();
  if (id === storefrontOrgId) return;

  const adopt =
    typeof options?.adoptSubscriptionId === "string"
      ? options.adoptSubscriptionId.trim()
      : "";
  const stripeStatus =
    typeof options?.stripeStatus === "string"
      ? options.stripeStatus.trim()
      : "";
  if (adopt) {
    // First payment_failed can arrive before checkout apply binds a *live* sub.
    // Never adopt incomplete / incomplete_expired — that locks Checkout and
    // later incomplete_expired events would wrongfully suspend the tenant.
    if (!isApplicableStripeSubscriptionStatus(stripeStatus)) {
      console.warn(
        "[company-billing] skip past_due adopt — non-applicable status",
        id,
        adopt,
        stripeStatus || "(missing)"
      );
    } else {
      await retainStripeSubscriptionBinding(id, adopt);
    }
  }

  const afterBind = await prisma.organization.findUnique({
    where: { id },
    select: { stripeSubscriptionId: true },
  });
  const boundId = afterBind?.stripeSubscriptionId?.trim() || "";
  if (!boundId) return;

  // If adopt lost a race to another live binding, do not past_due the winner.
  if (
    adopt &&
    isApplicableStripeSubscriptionStatus(stripeStatus) &&
    boundId !== adopt
  ) {
    console.warn(
      "[company-billing] skip past_due — adopt lost to live sibling binding",
      id,
      "bound=",
      boundId,
      "event=",
      adopt
    );
    await bestEffortCancelStripeSubscription(adopt);
    return;
  }

  // Grace for active tenants with a bound subscription (ignore blank ids).
  // Include `none` so binding-lag after Checkout still enters dunning grace.
  const result = await prisma.organization.updateMany({
    where: {
      id,
      isDefault: false,
      status: "active",
      stripeSubscriptionId: boundId,
      subscriptionStatus: {
        in: ["active", "trialing", "past_due", "none"],
      },
    },
    data: { subscriptionStatus: "past_due" },
  });
  if (result.count === 0) return;

  await logActivityEntryAsync({
    orgId: id,
    action: "Company Subscription Past Due",
    entityType: "Settings",
    entityId: id,
    description: "Invoice payment failed — grace period (not suspended)",
    metadata: {
      domain: "company-billing",
      ...(adopt &&
      isApplicableStripeSubscriptionStatus(stripeStatus) &&
      boundId === adopt
        ? { adoptedSubscriptionId: adopt }
        : {}),
    },
  });

  try {
    const { notifyCompanyPastDue } = await import(
      "@/lib/companySubscriptionNotices"
    );
    await notifyCompanyPastDue(id);
  } catch (err) {
    console.warn("[company-billing] past_due notice failed:", err);
  }
}

export async function findOrgIdByStripeCustomerId(
  customerId: string | null | undefined
): Promise<string | null> {
  const id = typeof customerId === "string" ? customerId.trim() : "";
  if (!id) return null;
  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId: id },
    select: { id: true, isDefault: true },
  });
  if (!org || org.isDefault) return null;
  return org.id;
}

export async function findOrgIdByStripeSubscriptionId(
  subscriptionId: string | null | undefined
): Promise<string | null> {
  const id = typeof subscriptionId === "string" ? subscriptionId.trim() : "";
  if (!id) return null;
  const org = await prisma.organization.findFirst({
    where: { stripeSubscriptionId: id },
    select: { id: true, isDefault: true },
  });
  if (!org || org.isDefault) return null;
  return org.id;
}

/** Cancel Stripe subscription. Returns true when canceled or already gone. */
export async function bestEffortCancelStripeSubscription(
  stripeSubscriptionId: string | null | undefined
): Promise<boolean> {
  const id = typeof stripeSubscriptionId === "string" ? stripeSubscriptionId.trim() : "";
  if (!id) return true;
  try {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(id);
    return true;
  } catch (err) {
    // Config missing / network / Stripe down → false so callers retain binding.
    if (isStripeAlreadyCanceled(err) || isStripeResourceMissing(err)) {
      return true;
    }
    console.warn("[company-billing] Stripe cancel failed (best-effort):", err);
    return false;
  }
}

/**
 * Stripe statuses that still represent a billable / blocking subscription.
 * Align with isApplicableStripeSubscriptionStatus for live rows — unpaid/paused
 * map to past_due on apply and must NOT be treated as dead (ops-unlock must not
 * clear the binding; Checkout must not start a sibling).
 */
export function isLiveStripeSubscriptionStatus(status: string): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused"
  );
}

/**
 * After a winning apply, cancel other live subscriptions on the same customer
 * so concurrent Checkout sessions cannot leave an orphan still charging.
 * Retries once and audits if siblings remain live.
 */
async function bestEffortCancelOtherLiveSubscriptions(
  customerId: string | null | undefined,
  keepSubscriptionId: string,
  orgId?: string
): Promise<void> {
  const keep = keepSubscriptionId.trim();
  const cid = typeof customerId === "string" ? customerId.trim() : "";
  if (!cid || !keep) return;

  const cancelSiblings = async (): Promise<string[]> => {
    const stripe = getStripe();
    const listed = await stripe.subscriptions.list({
      customer: cid,
      status: "all",
      limit: 20,
    });
    for (const row of listed.data) {
      if (row.id === keep) continue;
      if (!isLiveStripeSubscriptionStatus(row.status)) continue;
      await bestEffortCancelStripeSubscription(row.id);
    }
    // Re-list to confirm what is still live after cancel attempts.
    const after = await stripe.subscriptions.list({
      customer: cid,
      status: "all",
      limit: 20,
    });
    return after.data
      .filter(
        (row) =>
          row.id !== keep && isLiveStripeSubscriptionStatus(row.status)
      )
      .map((row) => row.id);
  };

  try {
    let remaining = await cancelSiblings();
    if (remaining.length > 0) {
      remaining = await cancelSiblings();
    }
    if (remaining.length > 0 && orgId) {
      await logActivityEntryAsync({
        orgId,
        action: "Company Billing Sibling Cancel Incomplete",
        entityType: "Settings",
        entityId: orgId,
        description: `Apply kept ${keep} but other live Stripe subscriptions remain`,
        metadata: {
          domain: "company-billing",
          keepSubscriptionId: keep,
          remainingSubscriptionIds: remaining,
        },
      });
      console.warn(
        "[company-billing] sibling live subs remain after cancel:",
        orgId,
        remaining
      );
    }
  } catch (err) {
    if (err instanceof CompanyBillingConfigError) return;
    console.warn(
      "[company-billing] sibling live sub cancel deferred:",
      err
    );
  }
}

/**
 * Persist Stripe subscription id without activating plan columns.
 * Used when apply refuses a live write (missing period end / unmapped price)
 * or skips while suspended — so expire/checkout still see the binding.
 * Replaces a different binding only when the current id is confirmed non-live
 * or missing in Stripe (never thrash on outages; never replace a live id).
 */
async function retainStripeSubscriptionBinding(
  orgId: string,
  stripeSubscriptionId: string | null | undefined
): Promise<void> {
  const subId =
    typeof stripeSubscriptionId === "string"
      ? stripeSubscriptionId.trim()
      : "";
  if (!subId) return;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true },
  });
  if (!org) return;
  const current = org.stripeSubscriptionId?.trim() || "";
  if (current === subId) return;

  if (current) {
    try {
      const stripe = getStripe();
      const existing = await stripe.subscriptions.retrieve(current);
      if (isLiveStripeSubscriptionStatus(existing.status)) {
        console.warn(
          "[company-billing] keep live subscription binding",
          orgId,
          current,
          "≠",
          subId
        );
        return;
      }
      // Current binding is canceled/incomplete — adopt the newer id.
    } catch (err) {
      if (err instanceof CompanyBillingConfigError) {
        console.warn(
          "[company-billing] keep existing binding — Stripe not configured",
          orgId,
          current,
          "≠",
          subId
        );
        return;
      }
      if (!isStripeResourceMissing(err)) {
        console.warn(
          "[company-billing] keep existing binding — retrieve deferred",
          orgId,
          current,
          "≠",
          subId,
          err
        );
        return;
      }
      // Missing in Stripe — safe to replace.
    }
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { stripeSubscriptionId: subId },
  });
}

/**
 * Cancel the bound id plus any other live subscriptions on the Stripe customer.
 * Prevents orphan Checkout subs (apply skipped) from continuing to charge.
 */
export async function bestEffortCancelLiveStripeSubscriptionsForOrg(input: {
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<boolean> {
  const prefer =
    typeof input.stripeSubscriptionId === "string"
      ? input.stripeSubscriptionId.trim()
      : "";
  const customerId =
    typeof input.stripeCustomerId === "string"
      ? input.stripeCustomerId.trim()
      : "";
  const ids = new Set<string>();
  if (prefer) ids.add(prefer);

  if (customerId) {
    try {
      const stripe = getStripe();
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      for (const row of listed.data) {
        if (isLiveStripeSubscriptionStatus(row.status)) {
          ids.add(row.id);
        }
      }
    } catch (err) {
      if (err instanceof CompanyBillingConfigError) {
        // No Stripe → treat as nothing to cancel when unbound; else try prefer.
        if (!prefer) return true;
      } else {
        console.warn(
          "[company-billing] list live subs for cancel deferred:",
          err
        );
        // Still attempt prefer id below.
      }
    }
  }

  if (ids.size === 0) return true;

  let allOk = true;
  for (const id of ids) {
    const ok = await bestEffortCancelStripeSubscription(id);
    if (!ok) allOk = false;
  }
  return allOk;
}

/**
 * After ops approve unlocks a tenant, sync any retained Stripe subscription:
 * - bound live sub → apply
 * - customer with unbound live sub (apply skipped while suspended) → apply
 * - confirmed missing/canceled sub → clear stripeSubscriptionId
 * Never clears the binding on transient Stripe errors (would allow double Checkout).
 */
export async function syncBoundStripeSubscriptionAfterOpsUnlock(
  orgId: string,
  eventId?: string | null
): Promise<CompanyBillingState | null> {
  const id = requireId(orgId, "orgId");
  await assertRegisteredCompanyBillingOrg(id);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      status: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      isDefault: true,
    },
  });
  if (!org || org.isDefault || org.status !== "active") return null;

  const syncEventId =
    (typeof eventId === "string" && eventId.trim()) ||
    `ops-unlock:${id}:${Date.now()}`;

  const isLiveStatus = (status: string) =>
    isLiveStripeSubscriptionStatus(status);

  /** Live apply retained binding but did not stamp a usable future plan. */
  function liveApplyRefused(sub: StripeSubscriptionLike): boolean {
    if (!isApplicableStripeSubscriptionStatus(sub.status)) return false;
    if (!isLiveStatus(sub.status)) return false;
    const mappedPlan = resolvePlanForSubscriptionApply(
      sub,
      "active",
      null,
      true
    );
    if (!mappedPlan) return true;
    const endsAtSec = periodEndUnixFromSubscription(sub);
    if (typeof endsAtSec !== "number" || !Number.isFinite(endsAtSec)) {
      return true;
    }
    // Past period end: apply refuses stamp — unlock must not succeed.
    return endsAtSec * 1000 <= Date.now();
  }

  async function applyLiveOrFailClosed(
    sub: StripeSubscriptionLike
  ): Promise<CompanyBillingState | null> {
    if (liveApplyRefused(sub)) {
      // Ops grant (Approve + plan stamp) may already be on the row. Do not
      // overwrite it with past_due refuse — Reactivate would be impossible
      // while Stripe stays live+past (reconcile also skips those).
      const current = await prisma.organization.findUnique({
        where: { id },
        select: {
          subscriptionPlan: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
        },
      });
      const opsGrantIntact =
        Boolean(current?.subscriptionPlan?.trim()) &&
        (current?.subscriptionStatus === "active" ||
          current?.subscriptionStatus === "trialing") &&
        current.subscriptionEndsAt != null &&
        current.subscriptionEndsAt.getTime() > Date.now();
      if (opsGrantIntact) {
        console.warn(
          "[company-billing] ops-unlock live apply refused — keeping ops grant + Stripe binding",
          id,
          sub.id
        );
        return getCompanyBillingState(id);
      }
      // Still retain via apply for audit + binding; then fail closed.
      await applyStripeSubscriptionToOrg(id, sub, syncEventId, null);
      console.warn(
        "[company-billing] ops-unlock live apply refused — fail closed",
        id,
        sub.id
      );
      return null;
    }
    const state = await applyStripeSubscriptionToOrg(
      id,
      sub,
      syncEventId,
      null
    );
    const mappedPlan = resolvePlanForSubscriptionApply(
      sub,
      "active",
      null,
      true
    );
    const again = await prisma.organization.findUnique({
      where: { id },
      select: { subscriptionPlan: true, subscriptionEndsAt: true },
    });
    // Match tryRefresh/reconcile: unlock only when Stripe plan is durably future.
    if (
      !mappedPlan ||
      again?.subscriptionPlan !== mappedPlan ||
      !again.subscriptionEndsAt ||
      again.subscriptionEndsAt.getTime() <= Date.now()
    ) {
      console.warn(
        "[company-billing] ops-unlock post-apply not future-live — fail closed",
        id,
        sub.id
      );
      return null;
    }
    return state;
  }

  let confirmedDeadBinding = false;

  try {
    const stripe = getStripe();
    const subId = org.stripeSubscriptionId?.trim() || "";
    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        if (isLiveStatus(sub.status)) {
          return applyLiveOrFailClosed(sub);
        }
        // canceled / incomplete / etc. — safe to clear local binding.
        // unpaid/paused stay live via isLiveStripeSubscriptionStatus above.
        confirmedDeadBinding = true;
      } catch (err) {
        if (isStripeResourceMissing(err)) {
          confirmedDeadBinding = true;
        } else {
          console.warn(
            "[company-billing] ops-unlock retrieve deferred — keeping binding",
            id,
            err
          );
          return null;
        }
      }
    } else {
      const customerId = org.stripeCustomerId?.trim() || "";
      if (!customerId) return null;
      try {
        const listed = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 20,
        });
        const live = listed.data.find((row) => isLiveStatus(row.status));
        if (live) {
          return applyLiveOrFailClosed(live);
        }
        // No live sub on customer and no bound id — nothing to clear.
        return getCompanyBillingState(id);
      } catch (err) {
        console.warn(
          "[company-billing] ops-unlock list deferred — keeping binding",
          id,
          err
        );
        return null;
      }
    }
  } catch (err) {
    if (err instanceof CompanyBillingConfigError) {
      console.warn(
        "[company-billing] skip ops-unlock Stripe sync — Stripe not configured",
        id
      );
      return null;
    }
    // apply / unexpected — never unbind on failure.
    console.warn(
      "[company-billing] ops-unlock sync failed — keeping binding",
      id,
      err
    );
    return null;
  }

  if (!confirmedDeadBinding) return getCompanyBillingState(id);

  const priorSubId = org.stripeSubscriptionId?.trim() || null;

  await prisma.organization.update({
    where: { id },
    data: { stripeSubscriptionId: null },
  });
  await normalizeUnboundPastDueGrace(id);
  await logActivityEntryAsync({
    orgId: id,
    action: "Company Billing Cleared Stale Subscription",
    entityType: "Settings",
    entityId: id,
    description: `Cleared non-live stripeSubscriptionId after ops unlock`,
    metadata: {
      domain: "company-billing",
      eventId: syncEventId,
      stripeSubscriptionId: priorSubId,
    },
  });

  // Dead binding cleared — adopt any other live sub on the same customer
  // (Checkout/retain while suspended can leave a stale bound id).
  const customerId = org.stripeCustomerId?.trim() || "";
  if (customerId) {
    try {
      const stripe = getStripe();
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      const live = listed.data.find((row) => isLiveStatus(row.status));
      if (live) {
        try {
          return await applyLiveOrFailClosed(live);
        } catch (err) {
          // Apply failed after clear — restore prior id so approve fail-closed
          // can re-suspend instead of leaving active + unbound.
          if (priorSubId) {
            await prisma.organization.update({
              where: { id },
              data: { stripeSubscriptionId: priorSubId },
            });
          }
          console.warn(
            "[company-billing] ops-unlock post-clear apply failed — restored binding",
            id,
            err
          );
          return null;
        }
      }
    } catch (err) {
      if (priorSubId) {
        await prisma.organization.update({
          where: { id },
          data: { stripeSubscriptionId: priorSubId },
        });
      }
      console.warn(
        "[company-billing] ops-unlock post-clear list deferred — restored binding",
        id,
        err
      );
      return null;
    }
  }

  return getCompanyBillingState(id);
}

export { mapStripePriceIdToPlan, resolveStripePriceId };
