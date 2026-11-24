/**
 * Client-only preference: landing /register-company?plan= hint for Billing UI.
 * Never entitles creates — Billing / ops stamp / Checkout remain the unlock.
 */
import type { SubscriptionPlanId } from "@/lib/subscriptionPlans";
import { isSubscriptionPlanId } from "@/lib/subscriptionPlans";

export const COMPANY_PLAN_HINT_STORAGE_KEY = "harewa_company_plan_hint";

export function readCompanyPlanHint(): SubscriptionPlanId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COMPANY_PLAN_HINT_STORAGE_KEY)?.trim();
    if (!raw) return null;
    return isSubscriptionPlanId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeCompanyPlanHint(plan: SubscriptionPlanId | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!plan) {
      localStorage.removeItem(COMPANY_PLAN_HINT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(COMPANY_PLAN_HINT_STORAGE_KEY, plan);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCompanyPlanHint(): void {
  writeCompanyPlanHint(null);
}
