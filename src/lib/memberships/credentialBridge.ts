/**
 * TicketCredential bridge for membership scanners (Feature 08 Phase 3).
 *
 * TicketCredential in this schema is booking-bound (requires bookingId) and has
 * no credentialType field. GuestMembership remains the entitlement SSOT.
 *
 * Scanners should resolve membership codes via GuestMembership.barcodeOrCode /
 * customMembershipId / qrPayload and call entitlementEngine.verifyBenefits /
 * consumeBenefit — do NOT fork remaining-visit math into TicketCredential.
 *
 * When a future schema adds credentialType=membership, use
 * mirrorMembershipCredentialHint() as the payload shape.
 */
import type { GuestMembership } from "@prisma/client";
import { ensureMembershipScanCodes } from "@/lib/memberships/entitlementEngine";

export type MembershipCredentialHint = {
  credentialType: "membership";
  orgId: string;
  guestMembershipId: string;
  code: string;
  qrPayload: string;
  /** Entitlement SSOT — never treat TicketCredential as the source of truth. */
  entitlementSsot: "GuestMembership";
};

export async function mirrorMembershipCredentialHint(
  member: GuestMembership
): Promise<MembershipCredentialHint> {
  const ensured = await ensureMembershipScanCodes(member);
  return {
    credentialType: "membership",
    orgId: ensured.orgId,
    guestMembershipId: ensured.id,
    code: ensured.barcodeOrCode || ensured.customMembershipId,
    qrPayload:
      ensured.qrPayload ||
      JSON.stringify({
        type: "membership",
        orgId: ensured.orgId,
        guestMembershipId: ensured.id,
        customMembershipId: ensured.customMembershipId,
      }),
    entitlementSsot: "GuestMembership",
  };
}
