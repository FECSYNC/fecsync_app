/**
 * GuestMembership status transition matrix (Phase 2).
 * Invalid transitions throw MembershipBillingError INVALID_TRANSITION.
 */
import type { GuestMembershipStatus } from "@prisma/client";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";

const ALLOWED: Record<GuestMembershipStatus, readonly GuestMembershipStatus[]> =
  {
    // Sell Stripe failure / first invoice fail may land past_due (SSOT: pending|past_due).
    pending: ["active", "past_due", "cancelled", "expired"],
    // active→pending: heal incomplete sell (membership committed before payment ledger).
    active: ["past_due", "paused", "cancelled", "expired", "pending"],
    // past_due must NOT go to paused — pause→resume would restore active without
    // settling payment (bypass dunning / recoverMembershipFromPastDue).
    past_due: ["active", "cancelled", "expired", "pending"],
    // paused→pending: resume while agreement gate still blocks activation.
    paused: ["active", "cancelled", "expired", "pending"],
    cancelled: ["active", "pending"],
    expired: ["active", "pending"],
  };

export function assertMembershipTransition(
  from: GuestMembershipStatus,
  to: GuestMembershipStatus
): void {
  if (from === to) return;
  const ok = ALLOWED[from]?.includes(to);
  if (!ok) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      `Cannot transition membership from ${from} to ${to}`
    );
  }
}

/** Benefits are redeemable only while active (entitlementEngine also gates past_due/paused/etc.). */
export function membershipBenefitsActive(
  status: GuestMembershipStatus
): boolean {
  return status === "active";
}
