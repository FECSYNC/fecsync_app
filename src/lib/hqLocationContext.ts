/**
 * Enterprise HQ location scope preference (Membership-scoped).
 * null / unset = All locations (company-wide HQ view).
 * Never trust client orgId — stamp from actor Membership for actor.orgId.
 */
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertEnterpriseHqEnabled } from "@/lib/enterpriseHq";
import { assertRegisteredCompanyVenueOrg } from "@/lib/venueLocations";
import {
  resolveEffectiveParkScope,
} from "@/lib/parkAdminScope";
import { clearCachedLocationScope } from "@/lib/ticketing/staffGateCache";

export const HQ_LOCATION_NOT_FOUND =
  "Selected venue was not found in this company";
export const HQ_LOCATION_ARCHIVED =
  "Archived venues cannot be selected as HQ location context";
export const HQ_LOCATION_MEMBERSHIP_REQUIRED =
  "Active membership required to set HQ location context";

export type HqLocationContextActor = {
  orgId?: string | null;
  sub?: string;
  preset?: string | null;
  membershipRole?: string | null;
  storefrontOrgId?: string | null;
};

export type HqLocationContextDto = {
  orgId: string;
  /** null = All locations (company-wide). */
  locationId: string | null;
  location: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
};

async function loadActorMembership(actor: HqLocationContextActor) {
  const orgId = requireActorOrgId(actor);
  const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
  if (!userId || !isValidId(userId)) {
    throw new ForbiddenError(HQ_LOCATION_MEMBERSHIP_REQUIRED);
  }
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: {
      id: true,
      status: true,
      hqSelectedLocationId: true,
    },
  });
  if (!membership || membership.status !== "active") {
    throw new ForbiddenError(HQ_LOCATION_MEMBERSHIP_REQUIRED);
  }
  return { orgId, userId, membership };
}

/**
 * Read current HQ location scope for the actor's membership in actor.orgId.
 * Clears stale ids (deleted / wrong-org / archived) back to All locations.
 *
 * Locks the venue row first (same order as setHqLocationContext) so concurrent
 * archive/SET cannot return a stale active preference. Clears only with a
 * conditional updateMany so a newer selection is never clobbered.
 */
export async function getHqLocationContext(
  actor: HqLocationContextActor
): Promise<HqLocationContextDto> {
  const orgId = requireActorOrgId(actor);
  await assertEnterpriseHqEnabled(orgId, actor);
  await assertRegisteredCompanyVenueOrg(orgId, actor);

  const { membership } = await loadActorMembership(actor);
  if (!membership.hqSelectedLocationId) {
    return { orgId, locationId: null, location: null };
  }

  return prisma.$transaction(
    async (tx) => {
      const snap = await tx.membership.findUnique({
        where: { id: membership.id },
        select: { hqSelectedLocationId: true },
      });
      const preferredId = snap?.hqSelectedLocationId ?? null;
      if (!preferredId) {
        return { orgId, locationId: null, location: null };
      }

      // Venue first — matches setHqLocationContext lock order (avoid deadlocks).
      const lockedVenue = await tx.$queryRaw<
        { id: string; name: string; slug: string; status: string }[]
      >`
        SELECT id, name, slug, status::text AS status
        FROM venue_locations
        WHERE id = ${preferredId} AND "orgId" = ${orgId}
        FOR UPDATE
      `;

      // Re-read preference after the venue lock so a concurrent SET is visible.
      const after = await tx.membership.findUnique({
        where: { id: membership.id },
        select: { hqSelectedLocationId: true },
      });
      const currentPref = after?.hqSelectedLocationId ?? null;
      if (!currentPref) {
        return { orgId, locationId: null, location: null };
      }

      if (currentPref !== preferredId) {
        // Pref moved to another venue while we locked the old one — resolve the
        // new id without clearing (another pass can heal if that id is stale).
        const moved = await tx.venueLocation.findFirst({
          where: { id: currentPref, orgId, status: "active" },
          select: { id: true, name: true, slug: true, status: true },
        });
        if (!moved) {
          await tx.membership.updateMany({
            where: {
              id: membership.id,
              hqSelectedLocationId: currentPref,
            },
            data: { hqSelectedLocationId: null },
          });
          return { orgId, locationId: null, location: null };
        }
        return { orgId, locationId: moved.id, location: moved };
      }

      const row = lockedVenue[0];
      if (!row || row.status !== "active") {
        await tx.membership.updateMany({
          where: {
            id: membership.id,
            hqSelectedLocationId: preferredId,
          },
          data: { hqSelectedLocationId: null },
        });
        return { orgId, locationId: null, location: null };
      }

      return {
        orgId,
        locationId: row.id,
        location: {
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status,
        },
      };
    },
    {
      maxWait: 10_000,
      timeout: 15_000,
    }
  );
}

/**
 * Set HQ location scope. Pass null / omit to select All locations.
 * Validates venue belongs to actor.orgId and is active when a locationId is provided.
 * Set path locks the venue row so a concurrent archive cannot leave a stale pref.
 */
export async function setHqLocationContext(
  actor: HqLocationContextActor,
  locationId: string | null
): Promise<HqLocationContextDto> {
  const orgId = requireActorOrgId(actor);
  await assertEnterpriseHqEnabled(orgId, actor);
  await assertRegisteredCompanyVenueOrg(orgId, actor);

  // Park-locked seats: reuse park-context validation (never All; only assigned).
  // HQ routes also assertNotParkLockedCompanyHq — refuse here for defense in depth.
  const parkScope = await resolveEffectiveParkScope(actor);
  if (parkScope.parkLocked) {
    throw new ForbiddenError(
      "Park-locked admins must use park-context, not Enterprise HQ location-context"
    );
  }

  const { membership } = await loadActorMembership(actor);

  if (locationId == null || locationId === "") {
    // Idempotent clear — updateMany avoids P2025 if the seat was revoked mid-request.
    await prisma.membership.updateMany({
      where: {
        id: membership.id,
        hqSelectedLocationId: { not: null },
      },
      data: { hqSelectedLocationId: null },
    });
    const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
    if (userId) {
      clearCachedLocationScope(`parkScope:${orgId}:${userId}`);
      clearCachedLocationScope(`scope:${orgId}:${userId}`);
    }
    return { orgId, locationId: null, location: null };
  }

  let id: string;
  try {
    id = requireId(locationId, "locationId");
  } catch {
    throw new ForbiddenError(HQ_LOCATION_NOT_FOUND);
  }

  return prisma.$transaction(
    async (tx) => {
      // Serialize against archive of this venue in the same org.
      const locked = await tx.$queryRaw<
        { id: string; name: string; slug: string; status: string }[]
      >`
        SELECT id, name, slug, status::text AS status
        FROM venue_locations
        WHERE id = ${id} AND "orgId" = ${orgId}
        FOR UPDATE
      `;
      if (!locked.length) {
        throw new ForbiddenError(HQ_LOCATION_NOT_FOUND);
      }
      const row = locked[0];
      if (row.status !== "active") {
        throw new ForbiddenError(HQ_LOCATION_ARCHIVED);
      }
      const location = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
      };

      // Re-read seat inside the tx (status may have changed; avoid stale skip/write).
      const seat = await tx.membership.findUnique({
        where: { id: membership.id },
        select: { id: true, status: true, hqSelectedLocationId: true },
      });
      if (!seat || seat.status !== "active") {
        throw new ForbiddenError(HQ_LOCATION_MEMBERSHIP_REQUIRED);
      }
      if (seat.hqSelectedLocationId !== location.id) {
        const updated = await tx.membership.updateMany({
          where: { id: seat.id, status: "active" },
          data: { hqSelectedLocationId: location.id },
        });
        if (updated.count === 0) {
          throw new ForbiddenError(HQ_LOCATION_MEMBERSHIP_REQUIRED);
        }
      }
      return { orgId, locationId: location.id, location };
    },
    {
      maxWait: 10_000,
      timeout: 15_000,
    }
  ).then((dto) => {
    const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
    if (userId) {
      clearCachedLocationScope(`parkScope:${orgId}:${userId}`);
      clearCachedLocationScope(`scope:${orgId}:${userId}`);
    }
    return dto;
  });
}

export function parseHqLocationContextBody(body: unknown): {
  locationId: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON");
  }
  const o = body as Record<string, unknown>;
  // Never accept client orgId / userId / membershipId as authority.
  // Actor JWT + Membership (userId_orgId) are SSOT — those keys are ignored.
  if (!("locationId" in o) || o.locationId == null || o.locationId === "") {
    return { locationId: null };
  }
  if (typeof o.locationId !== "string") {
    throw new Error("locationId must be a string or null");
  }
  const trimmed = o.locationId.trim();
  if (!trimmed) return { locationId: null };
  // Reject non-id shapes early (same fail-closed as requireId on set).
  if (!isValidId(trimmed)) {
    throw new ForbiddenError(HQ_LOCATION_NOT_FOUND);
  }
  return { locationId: trimmed };
}
