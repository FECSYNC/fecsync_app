/**
 * When to surface a Renew CTA / popup for company SaaS packages.
 * Aligns with Billing UI, dashboard modal, and Step 3 email/in-app
 * reminds (14 / 7 / 3 / 1). Stripe still auto-charges when PM is valid;
 * this is the in-app + email nudge before auto-suspend at period end.
 */

/** Show Renew when period end is within this many days (inclusive). */
export const BILLING_RENEW_WINDOW_DAYS = 14;

export function isWithinBillingRenewWindow(
  daysUntilRenewal: number | null | undefined
): boolean {
  return (
    typeof daysUntilRenewal === "number" &&
    Number.isFinite(daysUntilRenewal) &&
    daysUntilRenewal >= 0 &&
    daysUntilRenewal <= BILLING_RENEW_WINDOW_DAYS
  );
}
