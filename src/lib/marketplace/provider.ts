/**
 * MarketplacePaymentsProvider — PSP abstraction.
 * v1 = Stripe Connect Express (destination charges).
 * Phase B = Paystack split — implement without rewriting ledger tables.
 */

import type Stripe from "stripe";

export type MarketplaceConnectOnboardResult = {
  accountId: string;
  url: string;
};

export type MarketplaceDestinationCheckoutInput = {
  amountMinor: number;
  currency: string;
  applicationFeeMinor: number;
  connectedAccountId: string;
  customerEmail: string;
  productName: string;
  productDescription?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type MarketplaceRefundInput = {
  paymentIntentId: string;
  amountMinor?: number;
  refundApplicationFee?: boolean;
  reason?: string;
  idempotencyKey?: string;
};

export interface MarketplacePaymentsProvider {
  readonly id: "stripe_connect" | "paystack" | "manual";

  createExpressAccount(opts: {
    orgId: string;
    email?: string | null;
    country?: string | null;
    businessName?: string | null;
  }): Promise<{ accountId: string }>;

  createAccountLink(opts: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  createLoginLink(accountId: string): Promise<{ url: string }>;

  retrieveAccount(accountId: string): Promise<Stripe.Account>;

  createDestinationCheckoutSession(
    input: MarketplaceDestinationCheckoutInput
  ): Promise<Stripe.Checkout.Session>;

  createRefund(input: MarketplaceRefundInput): Promise<Stripe.Refund>;
}
