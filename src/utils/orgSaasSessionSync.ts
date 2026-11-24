/**
 * Shared Company SaaS session fingerprints + cross-tab sync keys.
 * Keep AuthBootstrap, AdminLayout, Tailor layout, and authStore aligned.
 */
import { clearHqLocationContextSyncStorage } from "@/utils/hqLocationContextSync";

/** Cross-tab: company profile session fields after profile edits. */
export const COMPANY_PROFILE_SESSION_SYNC_KEY =
  "harewa-company-profile-session";

/** Cross-tab: org billing / status fields after /me catch-up. */
export const COMPANY_BILLING_SESSION_SYNC_KEY =
  "harewa-company-billing-session";

export type OrgBillingSessionFields = {
  orgStatus?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: string | null;
  billingSoftHold?: boolean | null;
  billingGraceEndsAt?: string | null;
  /** Soft user lock — cross-tab /me catch-up. */
  accountSuspended?: boolean | null;
  /** Entitled Enterprise HQ soft-gate — cross-tab /me catch-up. */
  enterpriseHqEnabled?: boolean | null;
};

export type OrgProfileSessionFields = {
  profileCompleteness?: number | null;
  hasLogo?: boolean | null;
  companyLogoUrl?: string | null;
  companyDisplayName?: string | null;
  legalName?: string | null;
  tradingName?: string | null;
};

/** Billing / org unlock fields — full SaaS invalidate (incl. plan-cap lists). */
export function orgBillingFingerprint(
  user: OrgBillingSessionFields | null | undefined
): string {
  if (!user) return "";
  return [
    user.orgStatus ?? "",
    user.subscriptionPlan ?? "",
    user.subscriptionStatus ?? "",
    user.subscriptionEndsAt ?? "",
    user.billingSoftHold ? "1" : "0",
    user.billingGraceEndsAt ?? "",
    user.accountSuspended ? "1" : "0",
    user.enterpriseHqEnabled ? "1" : "0",
  ].join("|");
}

/**
 * Profile branding fields — invalidate profile/billing meters only
 * (`planCaps: false`). Includes display names so rename-only edits refresh RQ.
 */
export function orgProfileFingerprint(
  user: OrgProfileSessionFields | null | undefined
): string {
  if (!user) return "";
  return [
    user.profileCompleteness ?? "",
    user.hasLogo ? "1" : "0",
    user.companyLogoUrl ?? "",
    user.companyDisplayName ?? "",
    user.legalName ?? "",
    user.tradingName ?? "",
  ].join("|");
}

/** Drop company cross-tab sync payloads on logout / account clear. */
export function clearCompanySaasSessionSyncStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(COMPANY_PROFILE_SESSION_SYNC_KEY);
    localStorage.removeItem(COMPANY_BILLING_SESSION_SYNC_KEY);
  } catch {
    /* ignore */
  }
  clearHqLocationContextSyncStorage();
}
