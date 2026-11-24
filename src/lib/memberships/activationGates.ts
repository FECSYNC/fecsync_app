/**
 * Shared activation gates for agreement + payment settlement (Phase 4).
 * Kept free of circular imports with agreements.ts / billingEngine.ts.
 */
import prisma from "@/lib/prisma";
import { loadEffectiveMembershipSettingsRow } from "@/lib/memberships/settings";

export async function membershipRequiresAgreementGate(input: {
  orgId: string;
  planId: string;
  locationId: string;
}): Promise<boolean> {
  const plan = await prisma.membershipPlan.findFirst({
    where: { id: input.planId, orgId: input.orgId },
    select: { agreementRequired: true },
  });
  if (plan?.agreementRequired) return true;
  const row = await loadEffectiveMembershipSettingsRow(
    input.orgId,
    input.locationId
  );
  return Boolean(row?.requireAgreementBeforeActive);
}

export async function membershipAgreementBlocksActivation(member: {
  orgId: string;
  planId: string;
  locationId: string;
  homeLocationId: string;
  agreementSignedAt: Date | null;
}): Promise<boolean> {
  if (member.agreementSignedAt) return false;
  return membershipRequiresAgreementGate({
    orgId: member.orgId,
    planId: member.planId,
    locationId: member.homeLocationId || member.locationId,
  });
}

/** True when a succeeded payment attempt exists (collected / paid invoice). */
export async function membershipPaymentSettled(input: {
  orgId: string;
  guestMembershipId: string;
}): Promise<boolean> {
  const row = await prisma.membershipPaymentAttempt.findFirst({
    where: {
      orgId: input.orgId,
      guestMembershipId: input.guestMembershipId,
      status: "succeeded",
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * After a successful payment, activate only when agreement gate is clear.
 * Mirrors sell / recover / webhook — unsigned agreement-required stays pending.
 */
export async function resolvePostPaymentMembershipStatus(member: {
  orgId: string;
  planId: string;
  locationId: string;
  homeLocationId: string;
  agreementSignedAt: Date | null;
}): Promise<"active" | "pending"> {
  if (await membershipAgreementBlocksActivation(member)) return "pending";
  return "active";
}
