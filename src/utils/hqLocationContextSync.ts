/**
 * Cross-tab sync for Enterprise HQ location preference.
 * Billing entitlement already rides COMPANY_BILLING_SESSION_SYNC_KEY;
 * park scope is Membership-scoped and must broadcast separately.
 */

export const HQ_LOCATION_CONTEXT_SYNC_KEY = "harewa-hq-location-context";

export type HqLocationContextSyncPayload = {
  orgId: string;
  locationId: string | null;
  at: number;
};

export function broadcastHqLocationContextChange(input: {
  orgId: string;
  locationId: string | null;
}): void {
  if (typeof window === "undefined") return;
  try {
    const payload: HqLocationContextSyncPayload = {
      orgId: input.orgId,
      locationId: input.locationId,
      at: Date.now(),
    };
    localStorage.setItem(HQ_LOCATION_CONTEXT_SYNC_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearHqLocationContextSyncStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(HQ_LOCATION_CONTEXT_SYNC_KEY);
  } catch {
    /* ignore */
  }
}

export function parseHqLocationContextSync(
  raw: string | null
): HqLocationContextSyncPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HqLocationContextSyncPayload>;
    if (typeof parsed.orgId !== "string" || !parsed.orgId.trim()) return null;
    const locationId =
      parsed.locationId == null || parsed.locationId === ""
        ? null
        : String(parsed.locationId);
    return {
      orgId: parsed.orgId.trim(),
      locationId,
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
    };
  } catch {
    return null;
  }
}
