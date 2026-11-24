/**
 * Pro-rata upgrade/downgrade math (Feature 08 Phase 2).
 *
 * Default policy (documented):
 * - Upgrade: charge remaining-fraction × (newPrice − oldPrice), immediate plan switch.
 * - Downgrade: credit remaining-fraction × (oldPrice − newPrice) to creditBalanceMinor,
 *   immediate plan switch (not a Stripe refund).
 */
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";

export type ProrationInput = {
  oldPriceMajor: number;
  newPriceMajor: number;
  periodStart: Date;
  periodEnd: Date;
  asOf?: Date;
};

export type ProrationResult = {
  /** Positive = charge guest; negative = credit guest (major currency units). */
  amountDueMajor: number;
  fractionRemaining: number;
  remainingMs: number;
  totalMs: number;
};

export function computeProration(input: ProrationInput): ProrationResult {
  const asOf = input.asOf ?? new Date();
  const totalMs = input.periodEnd.getTime() - input.periodStart.getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PRORATION_FAILED,
      "Invalid membership period for proration"
    );
  }
  const remainingMs = Math.max(0, input.periodEnd.getTime() - asOf.getTime());
  const fractionRemaining = Math.min(1, remainingMs / totalMs);
  const delta = input.newPriceMajor - input.oldPriceMajor;
  const raw = delta * fractionRemaining;
  const amountDueMajor = Math.round(raw * 100) / 100;
  return {
    amountDueMajor,
    fractionRemaining,
    remainingMs,
    totalMs,
  };
}

/** Major units → minor (cents). */
export function majorToMinor(major: number): number {
  return Math.round(major * 100);
}

export function minorToMajor(minor: number): number {
  return Math.round(minor) / 100;
}
