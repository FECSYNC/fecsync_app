/**
 * Family / group membership links (Feature 08 Phase 3 — beta).
 * Sell path (Phase 2) already creates dependents; this manages post-sale links.
 */
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  assertGuestMembershipVisibleToActor,
  assertLocationInMembershipScope,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { assertGuestMembershipMutableByActor } from "@/lib/memberships/members";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";

export type FamilyLinkDto = {
  id: string;
  guestMembershipId: string;
  guestProfileId: string;
  role: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  createdAt: string;
};

export async function listFamilyLinks(
  actor: MembershipsActor,
  guestMembershipId: string
): Promise<FamilyLinkDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(guestMembershipId, "guestMembershipId");
  const member = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    include: {
      plan: { select: { familyAllowed: true } },
      familyLinks: {
        include: {
          guestProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!member) throw new ForbiddenError("Guest membership not found");
  await assertGuestMembershipVisibleToActor(actor, member);

  return member.familyLinks.map((f) => ({
    id: f.id,
    guestMembershipId: f.guestMembershipId,
    guestProfileId: f.guestProfileId,
    role: f.role,
    firstName: f.guestProfile.firstName,
    lastName: f.guestProfile.lastName,
    photoUrl: f.guestProfile.photoUrl,
    createdAt: f.createdAt.toISOString(),
  }));
}

/**
 * Replace dependents for a family-allowed plan (beta).
 * Body: { guestProfileIds: string[] } — primary is never listed as dependent.
 */
export async function setFamilyLinks(
  actor: MembershipsActor,
  guestMembershipId: string,
  body: unknown
): Promise<FamilyLinkDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(guestMembershipId, "guestMembershipId");
  const member = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    include: { plan: true },
  });
  if (!member) throw new ForbiddenError("Guest membership not found");
  // Family roster is a membership structure change — sell/home park scope, not visiting-only.
  await assertGuestMembershipMutableByActor(actor, id);

  if (!member.plan.familyAllowed) {
    throw new MembershipBillingError(
      MembershipErrorCodes.FAMILY_NOT_ALLOWED,
      "Plan does not allow family members"
    );
  }

  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rawIds = Array.isArray(rec.guestProfileIds) ? rec.guestProfileIds : [];
  const guestProfileIds = rawIds
    .filter((x): x is string => typeof x === "string" && isValidId(x))
    .filter((x) => x !== member.guestProfileId)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, 20);

  const entitlements =
    member.plan.entitlements &&
    typeof member.plan.entitlements === "object" &&
    !Array.isArray(member.plan.entitlements)
      ? (member.plan.entitlements as Record<string, unknown>)
      : {};
  // Sold snapshot wins over live plan — upgrade refreshes the snapshot.
  const sold =
    member.familyEntitlements &&
    typeof member.familyEntitlements === "object" &&
    !Array.isArray(member.familyEntitlements)
      ? (member.familyEntitlements as Record<string, unknown>)
      : null;
  const guestCountRaw =
    sold && typeof sold.guestCount === "number" && Number.isFinite(sold.guestCount)
      ? sold.guestCount
      : entitlements.guestCount;
  const guestCount =
    typeof guestCountRaw === "number" && Number.isFinite(guestCountRaw)
      ? Math.max(1, Math.floor(guestCountRaw))
      : null;
  if (guestCount != null && guestProfileIds.length + 1 > guestCount) {
    throw new MembershipBillingError(
      MembershipErrorCodes.FAMILY_NOT_ALLOWED,
      `Family size exceeds plan guestCount (${guestCount} including primary)`
    );
  }

  if (guestProfileIds.length > 0) {
    const found = await prisma.guestProfile.findMany({
      where: { orgId, id: { in: guestProfileIds } },
      select: { id: true, locationId: true },
    });
    if (found.length !== guestProfileIds.length) {
      throw new MembershipBillingError(
        MembershipErrorCodes.GUEST_NOT_FOUND,
        "One or more family guests were not found"
      );
    }
    // Park-locked desks cannot attach guests stamped outside their parks.
    for (const g of found) {
      if (g.locationId) {
        await assertLocationInMembershipScope(actor, g.locationId);
      }
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.membershipFamilyLink.deleteMany({
        where: { orgId, guestMembershipId: id },
      });
      if (guestProfileIds.length > 0) {
        await tx.membershipFamilyLink.createMany({
          data: guestProfileIds.map((guestProfileId) => ({
            orgId,
            guestMembershipId: id,
            guestProfileId,
            role: "dependent" as const,
          })),
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 8_000,
      timeout: 20_000,
    }
  );

  logStaffActivityEntry(actor, {
    action: "memberships.family.set",
    entityType: "GuestMembership",
    entityId: id,
    description: `Updated family links (beta) — ${guestProfileIds.length} dependent(s)`,
  });

  return listFamilyLinks(actor, id);
}

export async function addFamilyLink(
  actor: MembershipsActor,
  guestMembershipId: string,
  guestProfileId: string
): Promise<FamilyLinkDto[]> {
  const existing = await listFamilyLinks(actor, guestMembershipId);
  const ids = existing.map((f) => f.guestProfileId);
  if (!ids.includes(guestProfileId)) ids.push(guestProfileId);
  return setFamilyLinks(actor, guestMembershipId, { guestProfileIds: ids });
}

export async function removeFamilyLink(
  actor: MembershipsActor,
  guestMembershipId: string,
  guestProfileId: string
): Promise<FamilyLinkDto[]> {
  const existing = await listFamilyLinks(actor, guestMembershipId);
  const ids = existing
    .map((f) => f.guestProfileId)
    .filter((id) => id !== guestProfileId);
  return setFamilyLinks(actor, guestMembershipId, { guestProfileIds: ids });
}
