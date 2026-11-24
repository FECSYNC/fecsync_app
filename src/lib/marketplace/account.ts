/**
 * Stripe Connect Express account lifecycle for marketplace payouts (World B).
 *
 * SEPARATION: Never read/write Organization.stripeCustomerId /
 * stripeSubscriptionId here. Those belong to World A (company_subscription).
 */

import type {
  MarketplaceOnboardingStatus,
  OrganizationMarketplaceAccount,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertOrganizationActive,
  getStorefrontOrgId,
} from "@/lib/org";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";
import { getStripe } from "@/lib/stripe";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { getMarketplaceCurrencyDefault, getMarketplaceConnectCountryDefault } from "@/lib/marketplace/fees";
import {
  MARKETPLACE_SOFT_HOLD_MESSAGE,
  MARKETPLACE_STOREFRONT_MESSAGE,
} from "@/lib/marketplace/assertChargeReady";
import type { MarketplacePaymentsProvider } from "@/lib/marketplace/provider";
import type Stripe from "stripe";

export const MARKETPLACE_CONNECT_ADMIN_ONLY_MESSAGE =
  "Only the company platform admin can manage payouts onboarding";
export const MARKETPLACE_CONNECT_INCOMPLETE_MESSAGE =
  "Complete Connect onboarding before opening the Express Dashboard";

function connectRefreshUrl(): string {
  const env = process.env.STRIPE_CONNECT_REFRESH_URL?.trim();
  if (env) return env;
  return `${publicAppBaseUrl()}/admin/payouts?connect=refresh`;
}

function connectReturnUrl(): string {
  const env = process.env.STRIPE_CONNECT_RETURN_URL?.trim();
  if (env) return env;
  return `${publicAppBaseUrl()}/admin/payouts?connect=return`;
}

export function deriveOnboardingStatus(account: {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
}): MarketplaceOnboardingStatus {
  const disabled = account.requirements?.disabled_reason?.trim();
  if (disabled) return "disabled";
  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ];
  if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
    return "complete";
  }
  if (due.length > 0 && account.details_submitted) return "restricted";
  if (account.details_submitted || due.length > 0) return "pending";
  return "not_started";
}

/** Redact Stripe requirements to safe JSON (no account numbers). */
export function redactRequirementsDue(
  account: Stripe.Account
): { currently_due: string[]; past_due: string[]; disabled_reason: string | null } {
  return {
    currently_due: [...(account.requirements?.currently_due ?? [])],
    past_due: [...(account.requirements?.past_due ?? [])],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  };
}

function extractBankDisplay(account: Stripe.Account): {
  payoutBankLast4: string | null;
  payoutBankName: string | null;
} {
  const ext = account.external_accounts?.data?.[0] as
    | (Stripe.BankAccount | Stripe.Card)
    | undefined;
  if (!ext) return { payoutBankLast4: null, payoutBankName: null };
  if (ext.object === "bank_account") {
    return {
      payoutBankLast4: ext.last4 ?? null,
      payoutBankName: ext.bank_name ?? null,
    };
  }
  if (ext.object === "card") {
    return {
      payoutBankLast4: ext.last4 ?? null,
      payoutBankName: ext.brand ?? "card",
    };
  }
  return { payoutBankLast4: null, payoutBankName: null };
}

async function assertMarketplaceTenantOrg(orgId: string) {
  const id = requireId(orgId, "orgId");
  const storefrontId = await getStorefrontOrgId();
  if (id === storefrontId) {
    throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      name: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionPlan: true,
    },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
  }
  await assertNotDemoPlanLocked(id);
  if (
    isSoftBillingHoldRow({
      status: org.status,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionEndsAt: org.subscriptionEndsAt,
      subscriptionPlan: org.subscriptionPlan,
    })
  ) {
    throw new ForbiddenError(MARKETPLACE_SOFT_HOLD_MESSAGE);
  }
  await assertOrganizationActive(id);
  await assertCompanyBillingEntitled(id);
  return org;
}

export type MarketplaceAccountDto = {
  orgId: string;
  provider: string;
  onboardingStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  payoutBankLast4: string | null;
  payoutBankName: string | null;
  defaultCurrency: string;
  disabledReason: string | null;
  hasConnectedAccount: boolean;
  chargeReady: boolean;
  requirementsDue: unknown;
};

export function toMarketplaceAccountDto(
  row: OrganizationMarketplaceAccount | null,
  orgId: string,
  chargeReady: boolean
): MarketplaceAccountDto {
  if (!row) {
    return {
      orgId,
      provider: "stripe_connect",
      onboardingStatus: "not_started",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      payoutBankLast4: null,
      payoutBankName: null,
      defaultCurrency: getMarketplaceCurrencyDefault(),
      disabledReason: null,
      hasConnectedAccount: false,
      chargeReady: false,
      requirementsDue: null,
    };
  }
  return {
    orgId: row.orgId,
    provider: row.provider,
    onboardingStatus: row.onboardingStatus,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    payoutBankLast4: row.payoutBankLast4,
    payoutBankName: row.payoutBankName,
    defaultCurrency: row.defaultCurrency,
    disabledReason: row.disabledReason,
    hasConnectedAccount: Boolean(row.stripeConnectedAccountId?.trim()),
    chargeReady,
    requirementsDue: row.requirementsDue,
  };
}

export async function getMarketplaceAccountForOrg(
  orgId: string
): Promise<OrganizationMarketplaceAccount | null> {
  return prisma.organizationMarketplaceAccount.findUnique({
    where: { orgId: requireId(orgId, "orgId") },
  });
}

/** Apply Stripe Account flags onto OrganizationMarketplaceAccount (webhook + sync). */
export async function syncMarketplaceAccountFromStripe(
  orgId: string,
  stripeAccount: Stripe.Account
): Promise<OrganizationMarketplaceAccount> {
  const id = requireId(orgId, "orgId");
  const bank = extractBankDisplay(stripeAccount);
  const onboardingStatus = deriveOnboardingStatus(stripeAccount);
  const requirementsDue = redactRequirementsDue(stripeAccount);
  const disabledReason =
    stripeAccount.requirements?.disabled_reason?.trim() || null;

  return prisma.organizationMarketplaceAccount.upsert({
    where: { orgId: id },
    create: {
      orgId: id,
      provider: "stripe_connect",
      stripeConnectedAccountId: stripeAccount.id,
      chargesEnabled: Boolean(stripeAccount.charges_enabled),
      payoutsEnabled: Boolean(stripeAccount.payouts_enabled),
      detailsSubmitted: Boolean(stripeAccount.details_submitted),
      requirementsDue,
      payoutBankLast4: bank.payoutBankLast4,
      payoutBankName: bank.payoutBankName,
      defaultCurrency:
        stripeAccount.default_currency?.toLowerCase() ||
        getMarketplaceCurrencyDefault(),
      onboardingStatus,
      disabledReason,
    },
    update: {
      stripeConnectedAccountId: stripeAccount.id,
      chargesEnabled: Boolean(stripeAccount.charges_enabled),
      payoutsEnabled: Boolean(stripeAccount.payouts_enabled),
      detailsSubmitted: Boolean(stripeAccount.details_submitted),
      requirementsDue,
      payoutBankLast4: bank.payoutBankLast4,
      payoutBankName: bank.payoutBankName,
      defaultCurrency:
        stripeAccount.default_currency?.toLowerCase() ||
        getMarketplaceCurrencyDefault(),
      onboardingStatus,
      disabledReason,
    },
  });
}

/** Resolve orgId from Connect account id (webhook account.updated). */
export async function findOrgIdByConnectedAccountId(
  connectedAccountId: string
): Promise<string | null> {
  const acct = connectedAccountId?.trim();
  if (!acct) return null;
  const row = await prisma.organizationMarketplaceAccount.findUnique({
    where: { stripeConnectedAccountId: acct },
    select: { orgId: true },
  });
  return row?.orgId ?? null;
}

export const stripeConnectMarketplaceProvider: MarketplacePaymentsProvider = {
  id: "stripe_connect",

  async createExpressAccount(opts) {
    const stripe = getStripe();
    const account = await stripe.accounts.create(
      {
        type: "express",
        country: (opts.country || getMarketplaceConnectCountryDefault()).toUpperCase().slice(0, 2),
        email: opts.email?.trim() || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: opts.businessName?.trim() || undefined,
        },
        metadata: {
          orgId: opts.orgId,
          type: "marketplace_connect",
        },
      },
      { idempotencyKey: `marketplace-express:${opts.orgId}` }
    );
    return { accountId: account.id };
  },

  async createAccountLink(opts) {
    const stripe = getStripe();
    const link = await stripe.accountLinks.create({
      account: opts.accountId,
      refresh_url: opts.refreshUrl,
      return_url: opts.returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url };
  },

  async createLoginLink(accountId) {
    const stripe = getStripe();
    const link = await stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  },

  async retrieveAccount(accountId) {
    return getStripe().accounts.retrieve(accountId, {
      expand: ["external_accounts"],
    });
  },

  async createDestinationCheckoutSession(input) {
    const stripe = getStripe();
    return stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: input.customerEmail,
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: {
                name: input.productName,
                description: input.productDescription || undefined,
              },
            },
            quantity: 1,
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: input.metadata,
        payment_intent_data: {
          application_fee_amount: input.applicationFeeMinor,
          transfer_data: {
            destination: input.connectedAccountId,
          },
          metadata: input.metadata,
        },
      },
      { idempotencyKey: `mkt-checkout:${input.idempotencyKey}` }
    );
  },

  async createRefund(input) {
    const stripe = getStripe();
    const params: Stripe.RefundCreateParams = {
      payment_intent: input.paymentIntentId,
      refund_application_fee: input.refundApplicationFee !== false,
    };
    if (typeof input.amountMinor === "number") {
      params.amount = Math.floor(input.amountMinor);
    }
    if (input.reason) {
      params.reason = "requested_by_customer";
      params.metadata = { reason: input.reason.slice(0, 200) };
    }
    return stripe.refunds.create(
      params,
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined
    );
  },
};

export async function startMarketplaceConnectOnboarding(opts: {
  orgId: string;
  actorIsPlatformAdmin: boolean;
}): Promise<{ url: string; accountId: string }> {
  if (!opts.actorIsPlatformAdmin) {
    throw new ForbiddenError(MARKETPLACE_CONNECT_ADMIN_ONLY_MESSAGE);
  }
  const org = await assertMarketplaceTenantOrg(opts.orgId);
  const profile = await prisma.companyProfile.findUnique({
    where: { orgId: org.id },
    select: {
      supportEmail: true,
      billingEmail: true,
      legalName: true,
      tradingName: true,
      country: true,
    },
  });

  let row = await getMarketplaceAccountForOrg(org.id);
  let accountId = row?.stripeConnectedAccountId?.trim() || "";

  if (!accountId) {
    const created = await stripeConnectMarketplaceProvider.createExpressAccount({
      orgId: org.id,
      email: profile?.billingEmail || profile?.supportEmail || null,
      country: getMarketplaceConnectCountryDefault(profile?.country),
      businessName:
        profile?.legalName || profile?.tradingName || org.name || null,
    });
    accountId = created.accountId;
    row = await prisma.organizationMarketplaceAccount.upsert({
      where: { orgId: org.id },
      create: {
        orgId: org.id,
        provider: "stripe_connect",
        stripeConnectedAccountId: accountId,
        onboardingStatus: "pending",
        defaultCurrency: getMarketplaceCurrencyDefault(),
      },
      update: {
        stripeConnectedAccountId: accountId,
        onboardingStatus:
          row?.onboardingStatus === "complete" ? "complete" : "pending",
      },
    });
  }

  const link = await stripeConnectMarketplaceProvider.createAccountLink({
    accountId,
    refreshUrl: connectRefreshUrl(),
    returnUrl: connectReturnUrl(),
  });
  return { url: link.url, accountId };
}

export async function refreshMarketplaceConnectLink(opts: {
  orgId: string;
  actorIsPlatformAdmin: boolean;
}): Promise<{ url: string }> {
  if (!opts.actorIsPlatformAdmin) {
    throw new ForbiddenError(MARKETPLACE_CONNECT_ADMIN_ONLY_MESSAGE);
  }
  await assertMarketplaceTenantOrg(opts.orgId);
  const row = await getMarketplaceAccountForOrg(opts.orgId);
  const accountId = row?.stripeConnectedAccountId?.trim();
  if (!accountId) {
    return startMarketplaceConnectOnboarding(opts);
  }
  const link = await stripeConnectMarketplaceProvider.createAccountLink({
    accountId,
    refreshUrl: connectRefreshUrl(),
    returnUrl: connectReturnUrl(),
  });
  return { url: link.url };
}

export async function createMarketplaceExpressLoginLink(opts: {
  orgId: string;
  actorIsPlatformAdmin: boolean;
}): Promise<{ url: string }> {
  if (!opts.actorIsPlatformAdmin) {
    throw new ForbiddenError(MARKETPLACE_CONNECT_ADMIN_ONLY_MESSAGE);
  }
  await assertMarketplaceTenantOrg(opts.orgId);
  const row = await getMarketplaceAccountForOrg(opts.orgId);
  const accountId = row?.stripeConnectedAccountId?.trim();
  if (!accountId || row?.onboardingStatus !== "complete") {
    throw new ForbiddenError(MARKETPLACE_CONNECT_INCOMPLETE_MESSAGE);
  }
  return stripeConnectMarketplaceProvider.createLoginLink(accountId);
}

export async function syncMarketplaceAccountFromProvider(
  orgId: string
): Promise<OrganizationMarketplaceAccount> {
  await assertMarketplaceTenantOrg(orgId);
  const row = await getMarketplaceAccountForOrg(orgId);
  const accountId = row?.stripeConnectedAccountId?.trim();
  if (!accountId) {
    throw new ForbiddenError("No Connect account to sync — start onboarding first");
  }
  const stripeAccount =
    await stripeConnectMarketplaceProvider.retrieveAccount(accountId);
  return syncMarketplaceAccountFromStripe(orgId, stripeAccount);
}
