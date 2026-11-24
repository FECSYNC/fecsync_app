/**
 * Client-safe soft-gate copy for plan-capped creates.
 * Must stay in sync with BILLING_REQUIRED_MESSAGE / planLimitReachedMessage
 * in src/lib/planLimits.ts (client must not import that prisma-backed module).
 */

export const BILLING_REQUIRED_MESSAGE =
  "Subscribe to a plan before using this feature. Open Billing to choose a package.";

/** True when an API error message is the billing-required gate (not a plan cap). */
export function isBillingRequiredMessage(message: string): boolean {
  return message.includes("Subscribe to a plan before using this feature");
}

export function planLimitReachedClientMessage(
  resource: string,
  planResolved?: string | null
): string {
  return `Plan limit reached for ${resource} on the ${
    planResolved?.trim() || "current"
  } plan`;
}

type SoftGateUsage = {
  billingEntitled?: boolean;
  planResolved?: string | null;
};

/**
 * Unpaid approve-without-plan exposes meters as limit=0. That is not a true
 * plan cap — treat as billing-required when entitled is false OR when the
 * soft-gate only knows atLimit + zeroCap (list DTO omitted billingEntitled).
 */
export function isUnpaidPlanSoftGate(
  usage: SoftGateUsage | null | undefined,
  opts?: { atLimit?: boolean; zeroCap?: boolean }
): boolean {
  if (usage?.billingEntitled === false) return true;
  if (opts?.atLimit && opts?.zeroCap && usage?.billingEntitled !== true) {
    return true;
  }
  return false;
}

/**
 * Message when a create is blocked by billing or plan cap.
 * Unpaid / approve-without-plan → billing required (not "starter cap").
 * Entitled + at meter limit → plan limit reached.
 */
export function softGateBlockedMessage(
  usage: SoftGateUsage | null | undefined,
  resource: string,
  opts: {
    atLimit: boolean;
    usageReady?: boolean;
    loadingMessage?: string;
    /** True when resolved cap is 0 (unpaid meters), not a real starter floor. */
    zeroCap?: boolean;
  }
): string | null {
  if (opts.usageReady === false) {
    return (
      opts.loadingMessage ??
      "Plan usage is still loading — try again in a moment"
    );
  }
  if (isUnpaidPlanSoftGate(usage, opts)) {
    return BILLING_REQUIRED_MESSAGE;
  }
  if (opts.atLimit) {
    return planLimitReachedClientMessage(resource, usage?.planResolved);
  }
  return null;
}

/** Inline hint under meters / empty states (no loading toast wording). */
export function softGateInlineHint(
  usage: SoftGateUsage | null | undefined,
  resource: string,
  atLimit: boolean,
  opts?: { zeroCap?: boolean }
): string | null {
  if (isUnpaidPlanSoftGate(usage, { atLimit, zeroCap: opts?.zeroCap })) {
    return BILLING_REQUIRED_MESSAGE;
  }
  if (atLimit) {
    return planLimitReachedClientMessage(resource, usage?.planResolved);
  }
  return null;
}
