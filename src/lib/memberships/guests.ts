/**
 * GuestProfile CRM hub helpers (Feature 08 Phase 1 — minimal search/create).
 * Not shop Profile. Not staff Membership.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { verifyBenefits } from "@/lib/memberships/entitlementEngine";
import {
  assertMembershipsStaff,
  assertGuestMembershipVisibleToActor,
  assertLocationInMembershipScope,
  assertSafeHttpsPhotoUrl,
  locationScopeFilter,
  rejectClientOrgFields,
  rejectPrivilegedGuestFields,
  requireActorVenueInScope,
  GUEST_NOT_FOUND,
  type MembershipsActor,
} from "@/lib/memberships/common";
import type { GuestProfileDto } from "@/lib/memberships/types";

function displayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function toDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  userId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  photoUrl: string | null;
  postalCode: string | null;
  stripeCustomerId: string | null;
  bannedAt: Date | null;
  bannedReason: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GuestProfileDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: displayName(row.firstName, row.lastName),
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.dateOfBirth?.toISOString() ?? null,
    photoUrl: row.photoUrl,
    postalCode: row.postalCode,
    hasStripeCustomer: Boolean(row.stripeCustomerId?.trim()),
    bannedAt: row.bannedAt?.toISOString() ?? null,
    bannedReason: row.bannedReason,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function searchGuestProfiles(
  actor: MembershipsActor,
  opts?: { q?: string; locationId?: string | null; take?: number }
): Promise<GuestProfileDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const scope = await locationScopeFilter(actor);
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);

  const where: Prisma.GuestProfileWhereInput = { orgId };
  if (opts?.locationId) {
    if (!isValidId(opts.locationId)) {
      throw new Error("locationId is invalid");
    }
    await requireActorVenueInScope(actor, opts.locationId, {
      allowArchived: true,
    });
    where.locationId = opts.locationId;
  } else if (scope.parkLocked) {
    if (scope.locationIds?.length) {
      where.OR = [
        { locationId: null },
        { locationId: { in: scope.locationIds } },
      ];
    } else if (scope.locationId) {
      where.OR = [
        { locationId: null },
        { locationId: scope.locationId },
      ];
    } else {
      // Assignments cleared mid-session — empty list, not org-wide leak.
      where.id = "__none__";
    }
  } else if (scope.locationId) {
    where.OR = [{ locationId: null }, { locationId: scope.locationId }];
  }

  const q = opts?.q?.trim();
  if (q) {
    where.AND = [
      {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          {
            guestMemberships: {
              some: {
                customMembershipId: { contains: q, mode: "insensitive" },
              },
            },
          },
        ],
      },
    ];
  }

  const rows = await prisma.guestProfile.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take,
  });
  return rows.map(toDto);
}

export async function createGuestProfile(
  actor: MembershipsActor,
  body: unknown
): Promise<{ guest: GuestProfileDto; accountNote?: string }> {
  const orgId = await assertMembershipsStaff(actor);
  rejectClientOrgFields(body);
  rejectPrivilegedGuestFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  const firstName =
    typeof b.firstName === "string" ? b.firstName.trim() : "";
  const lastName = typeof b.lastName === "string" ? b.lastName.trim() : "";
  if (!firstName) throw new Error("firstName is required");
  if (!lastName) throw new Error("lastName is required");

  let locationId: string | null = null;
  if (b.locationId != null && b.locationId !== "") {
    if (typeof b.locationId !== "string" || !isValidId(b.locationId)) {
      throw new Error("locationId is invalid");
    }
    await requireActorVenueInScope(actor, b.locationId);
    locationId = b.locationId;
  }

  // Park-locked seats cannot create unscoped CRM rows — stamp assigned park.
  const scope = await locationScopeFilter(actor);
  if (scope.parkLocked) {
    if (!locationId) {
      if (scope.locationId) {
        locationId = scope.locationId;
      } else if (scope.locationIds?.length === 1) {
        locationId = scope.locationIds[0]!;
      } else {
        throw new ForbiddenError(
          "Park-locked seats must assign a home venue on guest profiles"
        );
      }
    }
    await requireActorVenueInScope(actor, locationId);
  }

  // Optional link to an existing User by id — never create User / reopen signup.
  // Shop customers (role client, no staff Membership) are allowed; staff seats OK too.
  // Conflict: one GuestProfile per user per org.
  let userId: string | null = null;
  if (b.userId != null && b.userId !== "") {
    if (typeof b.userId !== "string" || !isValidId(b.userId)) {
      throw new Error("userId is invalid");
    }
    const clientUser = await prisma.user.findFirst({
      where: {
        id: b.userId,
        accountDeleted: false,
        accountSuspended: false,
      },
      select: { id: true },
    });
    if (!clientUser) {
      throw new ForbiddenError("User account not found or unavailable");
    }
    const already = await prisma.guestProfile.findFirst({
      where: { orgId, userId: clientUser.id },
      select: { id: true },
    });
    if (already) {
      throw new ForbiddenError(
        "That account is already linked to another guest profile in this company"
      );
    }
    userId = b.userId;
  }

  const createdById =
    typeof actor.sub === "string" && isValidId(actor.sub) ? actor.sub : null;

  const row = await prisma.guestProfile.create({
    data: {
      orgId,
      locationId,
      userId,
      firstName: firstName.slice(0, 100),
      lastName: lastName.slice(0, 100),
      email:
        typeof b.email === "string" && b.email.trim()
          ? b.email.trim().toLowerCase().slice(0, 254)
          : null,
      phone:
        typeof b.phone === "string" && b.phone.trim()
          ? b.phone.trim().slice(0, 40)
          : null,
      postalCode:
        typeof b.postalCode === "string" && b.postalCode.trim()
          ? b.postalCode.trim().slice(0, 20)
          : null,
      notes:
        typeof b.notes === "string" && b.notes.trim()
          ? b.notes.trim().slice(0, 2000)
          : null,
      photoUrl:
        typeof b.photoUrl === "string" && b.photoUrl.trim()
          ? assertSafeHttpsPhotoUrl(b.photoUrl)
          : null,
      createdById,
      // stripeCustomerId intentionally null — Phase 2 billing creates it.
    },
  });

  logStaffActivityEntry(actor, {
    action: "guest_profile.create",
    entityType: "GuestProfile",
    entityId: row.id,
    description: `Created guest profile “${displayName(row.firstName, row.lastName)}”`,
  });

  // Optional desk password → invite-only online account + email credentials.
  const password =
    typeof b.password === "string" ? b.password.trim() : "";
  if (password) {
    if (userId) {
      throw new Error(
        "Cannot set a password when linking an existing userId — leave password blank"
      );
    }
    try {
      const { provisionGuestDashboardWithPassword } = await import(
        "@/lib/memberships/guestInvite"
      );
      const provisioned = await provisionGuestDashboardWithPassword(actor, {
        guestProfileId: row.id,
        password,
        sendCredentialsEmail: b.sendCredentialsEmail !== false,
      });
      const refreshed = await prisma.guestProfile.findFirst({
        where: { id: row.id },
      });
      return {
        guest: toDto(refreshed ?? row),
        accountNote: provisioned.note,
      };
    } catch (provisionErr) {
      // Guest CRM row already exists — do not fail the whole create as a 500.
      const msg =
        provisionErr instanceof Error
          ? provisionErr.message
          : "Could not create online login";
      console.warn(
        "[memberships/guests] desk password provision failed after guest create:",
        msg
      );
      return {
        guest: toDto(row),
        accountNote: `Guest profile created, but online account failed (${msg}). Use Invite dashboard or retry with password.`,
      };
    }
  }

  // If email matches an existing customer account, link immediately (no User create).
  if (!row.userId && row.email) {
    try {
      const { tryAutoLinkGuestProfileByEmail } = await import(
        "@/lib/memberships/guestInvite"
      );
      const linked = await tryAutoLinkGuestProfileByEmail(row.id);
      if (linked.linked && linked.userId) {
        const refreshed = await prisma.guestProfile.findFirst({
          where: { id: row.id },
        });
        if (refreshed) {
          return {
            guest: toDto(refreshed),
            accountNote:
              "Guest created and linked to existing customer account",
          };
        }
      }
    } catch {
      /* soft — create still succeeds */
    }
  }

  return { guest: toDto(row) };
}

export async function getGuestProfile(
  actor: MembershipsActor,
  guestId: string
): Promise<GuestProfileDto> {
  const orgId = await assertMembershipsStaff(actor);
  if (!isValidId(guestId)) throw new ForbiddenError(GUEST_NOT_FOUND);
  const row = await prisma.guestProfile.findFirst({
    where: { id: guestId, orgId },
  });
  if (!row) throw new ForbiddenError(GUEST_NOT_FOUND);
  if (row.locationId) {
    await assertLocationInMembershipScope(actor, row.locationId);
  }
  return toDto(row);
}

export type GuestProfileMembershipSummary = {
  id: string;
  customMembershipId: string;
  status: string;
  planId: string;
  planName: string;
  homeLocation: { id: string; name: string } | null;
  cancelAtPeriodEnd: boolean;
  cancelReason: string | null;
  currentPeriodEnd: string | null;
  remainingEntries: number | null;
  visitStatus: string | null;
  dunningFailCount: number;
  agreementSignedAt: string | null;
};

/** Guest CRM hub detail: profile + memberships visible to this desk seat. */
export async function getGuestProfileDetail(
  actor: MembershipsActor,
  guestId: string
): Promise<{
  guest: GuestProfileDto;
  memberships: GuestProfileMembershipSummary[];
}> {
  const guest = await getGuestProfile(actor, guestId);
  const rows = await prisma.guestMembership.findMany({
    where: { orgId: guest.orgId, guestProfileId: guest.id },
    include: {
      plan: { select: { id: true, name: true } },
      homeLocation: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const memberships: GuestProfileMembershipSummary[] = [];
  const visible: typeof rows = [];
  for (const m of rows) {
    try {
      await assertGuestMembershipVisibleToActor(actor, m);
      visible.push(m);
    } catch {
      /* park-locked desk may not see every membership */
    }
  }

  // Parallel lean verifies — avoid sequential N+1 latency on CRM hub.
  const verified = await Promise.all(
    visible.map(async (m) => {
      let remainingEntries: number | null = null;
      let visitStatus: string | null = m.visitStatus ?? null;
      try {
        const v = await verifyBenefits(m.id, m.homeLocationId, {
          orgId: m.orgId,
          lean: true,
        });
        remainingEntries = v.remainingEntries;
        visitStatus = v.visitStatus;
      } catch {
        /* entitlements soft-fail for CRM list */
      }
      return {
        id: m.id,
        customMembershipId: m.customMembershipId,
        status: m.status,
        planId: m.planId,
        planName: m.plan.name,
        homeLocation: m.homeLocation,
        cancelAtPeriodEnd: m.cancelAtPeriodEnd,
        cancelReason: m.cancelReason,
        currentPeriodEnd: m.currentPeriodEnd?.toISOString() ?? null,
        remainingEntries,
        visitStatus,
        dunningFailCount: m.dunningFailCount,
        agreementSignedAt: m.agreementSignedAt?.toISOString() ?? null,
      } satisfies GuestProfileMembershipSummary;
    })
  );
  memberships.push(...verified);

  return { guest, memberships };
}
