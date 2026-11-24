/**
 * Check-In → Memberships entitlement bridge (Feature 08 Phase 3).
 *
 * Check-In Feature is not shipped in this repo (no `/api/check-in/*` yet).
 * These exports are the intentional integration surface for that epic —
 * call them instead of inventing a second remaining-visit path. Until then,
 * Venue Manager redeem uses `/api/admin/memberships/redeem` → entitlementEngine
 * directly (same SSOT).
 */
import {
  verifyBenefits,
  consumeBenefit,
  redeemVisit,
  undoConsumeBenefit,
  type ConsumeBenefitInput,
  type VerifyBenefitsResult,
  type ConsumeBenefitResult,
} from "@/lib/memberships/entitlementEngine";

export async function checkInVerifyMembership(
  guestMembershipId: string,
  locationId: string,
  orgId: string
): Promise<VerifyBenefitsResult> {
  return verifyBenefits(guestMembershipId, locationId, { orgId });
}

export async function checkInRedeemMembership(
  input: Omit<ConsumeBenefitInput, "source"> & { source?: ConsumeBenefitInput["source"] }
): Promise<ConsumeBenefitResult> {
  return redeemVisit({ ...input, source: input.source ?? "checkin" });
}

export async function checkInUndoMembershipRedeem(
  input: Parameters<typeof undoConsumeBenefit>[0]
) {
  return undoConsumeBenefit({ ...input, source: input.source ?? "checkin" });
}

export { verifyBenefits, consumeBenefit, redeemVisit, undoConsumeBenefit };
