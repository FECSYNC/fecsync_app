/**
 * Member photo + custom membership ID helpers (Feature 08 Phase 3).
 */
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  assertGuestMembershipVisibleToActor,
  assertSafeHttpsPhotoUrl,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { assertGuestMembershipMutableByActor } from "@/lib/memberships/members";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { ensureMembershipScanCodes } from "@/lib/memberships/entitlementEngine";
import type { GuestMembershipDto } from "@/lib/memberships/types";
import { toGuestMembershipDto } from "@/lib/memberships/members";

const MAX_CUSTOM_ID_LEN = 64;

function assertCustomId(raw: string): string {
  const id = raw.trim();
  if (!id || id.length > MAX_CUSTOM_ID_LEN) {
    throw new Error(`customMembershipId must be 1–${MAX_CUSTOM_ID_LEN} characters`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) {
    throw new Error(
      "customMembershipId may only use letters, numbers, and . _ : -"
    );
  }
  return id;
}

async function loadMemberForMedia(
  actor: MembershipsActor,
  guestMembershipId: string
) {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(guestMembershipId, "guestMembershipId");
  const member = await prisma.guestMembership.findFirst({
    where: { id, orgId },
  });
  if (!member) throw new ForbiddenError("Guest membership not found");
  await assertGuestMembershipVisibleToActor(actor, member);
  return { orgId, member };
}

export async function updateMemberPhoto(
  actor: MembershipsActor,
  guestMembershipId: string,
  body: unknown
): Promise<GuestMembershipDto> {
  // Photo is an identity mutation — same sell/home mutable scope as custom ID.
  await assertGuestMembershipMutableByActor(actor, guestMembershipId);
  const { member } = await loadMemberForMedia(actor, guestMembershipId);
  const id = member.id;
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const photoUrl =
    rec.photoUrl === null
      ? null
      : typeof rec.photoUrl === "string"
        ? assertSafeHttpsPhotoUrl(rec.photoUrl)
        : undefined;
  if (photoUrl === undefined) {
    throw new Error("photoUrl is required (string or null to clear)");
  }

  const alsoGuest = rec.alsoUpdateGuestProfile === true;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.guestMembership.update({
      where: { id },
      data: { photoUrl },
    });
    if (alsoGuest) {
      await tx.guestProfile.update({
        where: { id: member.guestProfileId },
        data: { photoUrl },
      });
    }
    return row;
  });

  logStaffActivityEntry(actor, {
    action: "memberships.member.photo",
    entityType: "GuestMembership",
    entityId: id,
    description: photoUrl ? "Updated member photo" : "Cleared member photo",
  });

  return toGuestMembershipDto(await ensureMembershipScanCodes(updated));
}

export async function updateCustomMembershipId(
  actor: MembershipsActor,
  guestMembershipId: string,
  body: unknown
): Promise<GuestMembershipDto> {
  // Custom IDs are identity mutations — sell/home park mutable scope.
  await assertGuestMembershipMutableByActor(actor, guestMembershipId);
  const { orgId, member } = await loadMemberForMedia(actor, guestMembershipId);
  const id = member.id;
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (typeof rec.customMembershipId !== "string") {
    throw new Error("customMembershipId is required");
  }
  const customMembershipId = assertCustomId(rec.customMembershipId);

  try {
    const updated = await prisma.guestMembership.update({
      where: { id },
      data: {
        customMembershipId,
        barcodeOrCode: customMembershipId,
        qrPayload: JSON.stringify({
          type: "membership",
          orgId,
          guestMembershipId: id,
          customMembershipId,
        }),
      },
    });
    logStaffActivityEntry(actor, {
      action: "memberships.member.custom_id",
      entityType: "GuestMembership",
      entityId: id,
      description: `Assigned custom membership id ${customMembershipId}`,
    });
    return toGuestMembershipDto(updated);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new MembershipBillingError(
        MembershipErrorCodes.CUSTOM_ID_CONFLICT,
        "customMembershipId is already in use for this organization"
      );
    }
    throw err;
  }
}

export async function lookupByCustomMembershipId(
  actor: MembershipsActor,
  customMembershipId: string
): Promise<GuestMembershipDto | null> {
  const orgId = await assertMembershipsStaff(actor);
  const code = customMembershipId.trim();
  if (!code) return null;
  const row = await prisma.guestMembership.findFirst({
    where: {
      orgId,
      customMembershipId: { equals: code, mode: "insensitive" },
    },
  });
  if (!row) return null;
  await assertGuestMembershipVisibleToActor(actor, row);
  return toGuestMembershipDto(await ensureMembershipScanCodes(row));
}
