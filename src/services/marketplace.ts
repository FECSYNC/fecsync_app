/**
 * Client helpers for marketplace / franchise park Connect payouts (World B).
 * Never touches company SaaS billing (World A).
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type { QueryClient } from "@tanstack/react-query";
import { hqKeys } from "@/services/hq";
import { venueLocationKeys } from "@/services/venueLocations";

/** Mirrors ParkMarketplaceAccountDto from src/lib/marketplace/parkAccount.ts */
export type ParkMarketplaceAccountDto = {
  orgId: string;
  locationId: string;
  locationName: string;
  isFranchise: boolean;
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

export type OrgMarketplaceAccountDto = {
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
  publishedActivePackageCount?: number;
  orgSlug?: string | null;
};

export type MarketplaceBookingListRow = {
  id: string;
  packageId: string;
  packageTitle: string;
  packageSlug: string;
  locationId: string | null;
  customerEmail: string;
  customerName: string | null;
  amountMinor: number;
  currency: string;
  platformFeeMinor: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  refundedMinor: number;
  refundableMinor: number;
  hasPaymentIntent: boolean;
};

export const marketplaceKeys = {
  all: ["admin", "marketplace"] as const,
  account: () => [...marketplaceKeys.all, "account"] as const,
  parkAccounts: () => [...marketplaceKeys.all, "park-accounts"] as const,
  parkAccount: (locationId: string) =>
    [...marketplaceKeys.parkAccounts(), locationId] as const,
  bookings: (locationId?: string | null) =>
    [
      ...marketplaceKeys.all,
      "bookings",
      locationId?.trim() || "all",
    ] as const,
};

export async function listMarketplaceBookings(opts?: {
  take?: number;
  locationId?: string | null;
}): Promise<MarketplaceBookingListRow[]> {
  const params = new URLSearchParams();
  if (opts?.take != null) params.set("take", String(opts.take));
  if (opts?.locationId?.trim()) {
    params.set("locationId", opts.locationId.trim());
  }
  const q = params.toString();
  const raw = await api<
    MaybeWrapped<{ bookings: MarketplaceBookingListRow[] }>
  >(`/api/admin/marketplace/bookings${q ? `?${q}` : ""}`, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return Array.isArray(data?.bookings) ? data.bookings : [];
}

export async function getOrgMarketplaceAccount(): Promise<OrgMarketplaceAccountDto | null> {
  const raw = await api<
    MaybeWrapped<{ account: OrgMarketplaceAccountDto }>
  >("/api/admin/marketplace/account", {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw)?.account ?? null;
}

export async function listParkMarketplaceAccounts(): Promise<
  ParkMarketplaceAccountDto[]
> {
  const raw = await api<
    MaybeWrapped<{ parks: ParkMarketplaceAccountDto[]; orgId: string }>
  >("/api/admin/marketplace/park-accounts", {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return Array.isArray(data?.parks) ? data.parks : [];
}

export async function getParkMarketplaceAccount(
  locationId: string
): Promise<{
  account: ParkMarketplaceAccountDto;
  chargeReadyReason?: string | null;
}> {
  const raw = await api<
    MaybeWrapped<{
      account: ParkMarketplaceAccountDto;
      chargeReadyReason?: string | null;
    }>
  >(
    `/api/admin/marketplace/park-accounts/${encodeURIComponent(locationId)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.account) throw new Error("Could not load park payouts status");
  return {
    account: data.account,
    chargeReadyReason: data.chargeReadyReason ?? null,
  };
}

export async function startParkConnectOnboard(
  locationId: string
): Promise<{ url: string }> {
  const raw = await api<MaybeWrapped<{ url: string }>>(
    `/api/admin/marketplace/park-accounts/${encodeURIComponent(locationId)}/connect/onboard`,
    { method: "POST", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.url) throw new Error("Redirect URL missing");
  return { url: data.url };
}

export async function refreshParkConnectLink(
  locationId: string
): Promise<{ url: string }> {
  const raw = await api<MaybeWrapped<{ url: string }>>(
    `/api/admin/marketplace/park-accounts/${encodeURIComponent(locationId)}/connect/refresh`,
    { method: "POST", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.url) throw new Error("Redirect URL missing");
  return { url: data.url };
}

export async function syncParkConnectAccount(
  locationId: string
): Promise<ParkMarketplaceAccountDto> {
  const raw = await api<
    MaybeWrapped<{ account: ParkMarketplaceAccountDto }>
  >(
    `/api/admin/marketplace/park-accounts/${encodeURIComponent(locationId)}/connect/sync`,
    { method: "POST", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.account) throw new Error("Sync returned no account");
  return data.account;
}

export async function createParkConnectLoginLink(
  locationId: string
): Promise<{ url: string }> {
  const raw = await api<MaybeWrapped<{ url: string }>>(
    `/api/admin/marketplace/park-accounts/${encodeURIComponent(locationId)}/connect/login-link`,
    { method: "POST", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.url) throw new Error("Redirect URL missing");
  return { url: data.url };
}

/** Invalidate park + org marketplace payout caches, HQ, and venues badges. */
export function invalidateMarketplacePayoutQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
  void queryClient.invalidateQueries({ queryKey: hqKeys.all });
  void queryClient.invalidateQueries({ queryKey: venueLocationKeys.all });
}
