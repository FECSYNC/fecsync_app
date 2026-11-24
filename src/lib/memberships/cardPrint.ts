/**
 * Membership card print payload (Feature 08 Phase 3).
 * Shared by admin print UI and future Check-In / POS print views.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertMembershipsStaff,
  assertGuestMembershipVisibleToActor,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { ensureMembershipScanCodes } from "@/lib/memberships/entitlementEngine";

export type MembershipCardPrintDto = {
  guestMembershipId: string;
  customMembershipId: string;
  barcodeOrCode: string | null;
  qrPayload: string | null;
  memberName: string;
  photoUrl: string | null;
  planName: string;
  physicalPassMessage: string | null;
  planImageUrl: string | null;
  status: string;
  homeLocationName: string | null;
  sellLocationName: string | null;
  orgBrand: {
    companyName: string | null;
    logoUrl: string | null;
  };
};

export async function getMembershipCardPrintData(
  actor: MembershipsActor,
  guestMembershipId: string
): Promise<MembershipCardPrintDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(guestMembershipId, "guestMembershipId");
  const member = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    include: {
      guestProfile: {
        select: { firstName: true, lastName: true, photoUrl: true },
      },
      plan: {
        select: { name: true, physicalPassMessage: true, imageUrl: true },
      },
      homeLocation: { select: { name: true } },
      location: { select: { name: true } },
    },
  });
  if (!member) throw new ForbiddenError("Guest membership not found");
  await assertGuestMembershipVisibleToActor(actor, member);

  const ensured = await ensureMembershipScanCodes(member);
  const company = await prisma.companyProfile.findFirst({
    where: { orgId },
    select: { tradingName: true, legalName: true, logoUrl: true },
  });

  return {
    guestMembershipId: ensured.id,
    customMembershipId: ensured.customMembershipId,
    barcodeOrCode: ensured.barcodeOrCode,
    qrPayload: ensured.qrPayload,
    memberName:
      `${member.guestProfile.firstName} ${member.guestProfile.lastName}`.trim(),
    photoUrl: member.photoUrl || member.guestProfile.photoUrl,
    planName: member.plan.name,
    physicalPassMessage: member.plan.physicalPassMessage,
    planImageUrl: member.plan.imageUrl,
    status: member.status,
    homeLocationName: member.homeLocation?.name ?? null,
    sellLocationName: member.location?.name ?? null,
    orgBrand: {
      companyName: company?.tradingName || company?.legalName || null,
      logoUrl: company?.logoUrl ?? null,
    },
  };
}
