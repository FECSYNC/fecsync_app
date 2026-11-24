/**
 * GuestProfile ↔ User ownership helpers (Feature 08 Phase 4).
 * Shared by selfServe + agreements to avoid circular imports with billingEngine.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { assertMembershipsEnabled } from "@/lib/memberships/assert";
import type { GuestMembership, MembershipPlan } from "@prisma/client";

export type GuestSelfServeActor = {
  sub: string;
  orgId?: string | null;
  email?: string | null;
};

export async function requireLinkedGuestProfiles(
  actor: GuestSelfServeActor
): Promise<{ userId: string; guestProfileIds: string[] }> {
  const userId = requireId(actor.sub, "userId");
  const rows = await prisma.guestProfile.findMany({
    where: { userId },
    select: { id: true },
  });
  const guestProfileIds = rows.map((r) => r.id);
  if (guestProfileIds.length === 0) {
    throw new MembershipBillingError(
      MembershipErrorCodes.NOT_LINKED_TO_GUEST,
      "No GuestProfile is linked to this account — ask the park desk to link you, or use the link flow with a matching email"
    );
  }
  return { userId, guestProfileIds };
}

export async function assertOwnGuestMembership(
  actor: GuestSelfServeActor,
  guestMembershipId: string
): Promise<
  GuestMembership & {
    plan: MembershipPlan;
    guestProfile: {
      id: string;
      email: string | null;
      firstName: string;
      lastName: string;
      userId: string | null;
    };
  }
> {
  const id = requireId(guestMembershipId, "guestMembershipId");
  const { userId } = await requireLinkedGuestProfiles(actor);
  const member = await prisma.guestMembership.findFirst({
    where: {
      id,
      guestProfile: { userId },
    },
    include: {
      plan: true,
      guestProfile: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          userId: true,
        },
      },
    },
  });
  if (!member) {
    throw new ForbiddenError("Guest membership not found");
  }
  await assertMembershipsEnabled(member.orgId);
  return member;
}

/**
 * Explicit link: authenticated user claims an unlinked GuestProfile when email matches.
 * Never creates a new GuestProfile or User (no /signup).
 */
export async function linkGuestProfileToUser(
  actor: GuestSelfServeActor,
  input: { guestProfileId: string; orgId: string }
): Promise<{ guestProfileId: string; orgId: string }> {
  const userId = requireId(actor.sub, "userId");
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");
  const orgId = requireId(input.orgId, "orgId");
  await assertMembershipsEnabled(orgId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user?.email?.trim()) {
    throw new MembershipBillingError(
      MembershipErrorCodes.NOT_LINKED_TO_GUEST,
      "Account email is required to link a guest profile"
    );
  }
  const emailNorm = user.email.trim().toLowerCase();

  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
  });
  if (!guest) {
    throw new ForbiddenError("Guest profile not found");
  }
  if (guest.userId && guest.userId !== userId) {
    throw new ForbiddenError("Guest profile is linked to another account");
  }
  if (guest.userId === userId) {
    return { guestProfileId, orgId };
  }
  if (!guest.email?.trim() || guest.email.trim().toLowerCase() !== emailNorm) {
    throw new MembershipBillingError(
      MembershipErrorCodes.NOT_LINKED_TO_GUEST,
      "Guest profile email must match your account email to link"
    );
  }
  if (guest.bannedAt) {
    throw new ForbiddenError("Guest profile is banned");
  }

  // Optimistic claim — fail closed if another account linked between read and write.
  const claimed = await prisma.guestProfile.updateMany({
    where: { id: guest.id, orgId, userId: null },
    data: { userId },
  });
  if (claimed.count !== 1) {
    const again = await prisma.guestProfile.findFirst({
      where: { id: guest.id, orgId },
      select: { userId: true },
    });
    if (again?.userId === userId) {
      return { guestProfileId, orgId };
    }
    throw new ForbiddenError("Guest profile is linked to another account");
  }

  logStaffActivityEntry(
    { sub: userId, orgId },
    {
      action: "memberships.guest.link_self",
      entityType: "GuestProfile",
      entityId: guest.id,
      description: "Guest linked GuestProfile to online account",
    }
  );

  return { guestProfileId, orgId };
}
