import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type CompanyBillingState = {
  orgId: string;
  orgStatus: string;
  plan: string | null;
  planResolved: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  subscriptionInterval: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  requestedDurationMonths?: number | null;
  pastDue: boolean;
  /** Soft-hold while org status is still active (Fresh soft-deny). */
  billingSoftHold?: boolean;
  /** ISO when Demo demotion becomes eligible (period end + grace). */
  billingGraceEndsAt?: string | null;
  billingGraceDays?: number;
  billingGraceMsRemaining?: number | null;
  billingEntitled: boolean;
  /** Entitled Enterprise HQ soft-gate for company admin UI. */
  enterpriseHqEnabled?: boolean;
  daysUntilRenewal: number | null;
};

export type BillingDurationOption = {
  months: number;
  label: string;
  shortLabel: string;
};

export type BillingDurationQuote = {
  months: number;
  label: string;
  shortLabel: string;
  totalMajor: number | null;
};

export type BillingPlanCard = {
  id: string;
  name: string;
  tagline: string;
  features: string[];
  limits: Record<string, number | null>;
  /** Future module access hints (not enforced until modules ship). */
  moduleHints?: string[];
  displayPriceMonthly: number | null;
  currency: string;
  highlighted: boolean;
  cta: "checkout" | "contact" | "demo";
  checkoutAvailable: boolean;
  contactHref: string | null;
  durationQuotes?: BillingDurationQuote[];
};

type PlansResponse = {
  plans: BillingPlanCard[];
  billing: CompanyBillingState;
  durationOptions?: BillingDurationOption[];
};

type StateResponse = { billing: CompanyBillingState };
type UrlResponse = { url: string };

export type BillingUsageMeter = {
  resource: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
};

export type BillingUsageSnapshot = {
  orgId: string;
  plan: string | null;
  planResolved: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  billingEntitled: boolean;
  /** Plan caps when present (server UsageSnapshot); optional for older clients. */
  limits?: Record<string, number | null>;
  meters: BillingUsageMeter[];
  /** Resources where used > capped limit (keep data; block creates). */
  overLimitResources?: string[];
  /** User ids that currently burn a tailorSeats slot (membership ∪ live studio). */
  tailorSeatOccupantUserIds?: string[];
};

type UsageResponse = { usage: BillingUsageSnapshot };

export async function getBillingPlans(): Promise<PlansResponse> {
  const raw = await api<MaybeWrapped<PlansResponse>>(
    "/api/admin/billing/plans",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.plans || !data?.billing) {
    throw new Error("Failed to load billing plans");
  }
  return data;
}

export async function getBillingState(): Promise<CompanyBillingState> {
  const raw = await api<MaybeWrapped<StateResponse>>(
    "/api/admin/billing/state",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.billing) {
    throw new Error("Failed to load billing state");
  }
  return data.billing;
}

export async function getBillingUsage(): Promise<BillingUsageSnapshot> {
  const raw = await api<MaybeWrapped<UsageResponse>>(
    "/api/admin/billing/usage",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.usage) {
    throw new Error("Failed to load plan usage");
  }
  return data.usage;
}

/** Convenience: one meter from a usage snapshot (null if missing). */
export function usageMeterFor(
  usage: BillingUsageSnapshot | undefined,
  resource: string
): BillingUsageMeter | null {
  return usage?.meters.find((m) => m.resource === resource) ?? null;
}

export async function startBillingCheckout(
  plan: string,
  durationMonths?: number
): Promise<string> {
  const raw = await api<MaybeWrapped<UrlResponse>>(
    "/api/admin/billing/checkout",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        ...(durationMonths != null ? { durationMonths } : {}),
      }),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.url) {
    throw new Error("Checkout URL missing");
  }
  return data.url;
}

export async function openBillingPortal(): Promise<string> {
  const raw = await api<MaybeWrapped<UrlResponse>>(
    "/api/admin/billing/portal",
    {
      method: "POST",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.url) {
    throw new Error("Portal URL missing");
  }
  return data.url;
}
