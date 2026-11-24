/**
 * Cross-tab sync for org + franchise park Connect payout readiness.
 * Mirrors hqLocationContextSync / orgSaasSessionSync — sister admin tabs must
 * refresh park-accounts, PayoutsPage, MarketplacePayoutsNudge, venues badges,
 * and HQ readiness without a full reload.
 */

export const MARKETPLACE_PAYOUTS_SYNC_KEY = "harewa-marketplace-payouts-sync";

export type MarketplacePayoutsSyncPayload = {
  orgId: string;
  locationId: string | null;
  at: number;
  reason?: string;
};

export function broadcastMarketplacePayoutsChange(input: {
  orgId: string;
  locationId?: string | null;
  reason?: string;
}): void {
  if (typeof window === "undefined") return;
  try {
    const payload: MarketplacePayoutsSyncPayload = {
      orgId: input.orgId,
      locationId:
        input.locationId == null || input.locationId === ""
          ? null
          : String(input.locationId),
      at: Date.now(),
      ...(input.reason ? { reason: input.reason } : {}),
    };
    localStorage.setItem(MARKETPLACE_PAYOUTS_SYNC_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearMarketplacePayoutsSyncStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(MARKETPLACE_PAYOUTS_SYNC_KEY);
  } catch {
    /* ignore */
  }
}

export function parseMarketplacePayoutsSync(
  raw: string | null
): MarketplacePayoutsSyncPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MarketplacePayoutsSyncPayload>;
    if (typeof parsed.orgId !== "string" || !parsed.orgId.trim()) return null;
    const locationId =
      parsed.locationId == null || parsed.locationId === ""
        ? null
        : String(parsed.locationId);
    return {
      orgId: parsed.orgId.trim(),
      locationId,
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return null;
  }
}
