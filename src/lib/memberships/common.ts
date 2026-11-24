/**
 * Shared Memberships staff gates + venue ownership helpers.
 * Park-lock / HQ preference enforcement mirrors ticketing/common.ts.
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertMembershipsEnabled } from "@/lib/memberships/assert";
import {
  actorLocationScope,
  type ActorLocationScopeActor,
} from "@/lib/actorLocationScope";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";

export type MembershipsActor = ActorLocationScopeActor & {
  orgId?: string | null;
  sub?: string;
};

export const LOCATION_REQUIRED = "Venue location is required";
export const LOCATION_NOT_FOUND = "Venue location not found";
export const LOCATION_ARCHIVED =
  "This venue is archived — choose an active venue";
export const LOCATION_OUT_OF_SCOPE = "Outside your park assignment";
export const PLAN_NOT_FOUND = "Membership plan not found";
export const GUEST_NOT_FOUND = "Guest profile not found";
export const PRIVILEGED_ORG_FIELD =
  "orgId cannot be set from the client — it is taken from your session";
export const PRIVILEGED_GUEST_FIELD =
  "That guest field cannot be set from the client";

const MAX_PHOTO_URL_LEN = 2000;
const PHOTO_URL_RE = /^https:\/\/[^\s]+$/i;

/** Guest/member photo URLs — https only; never javascript: or relative. */
export function assertSafeHttpsPhotoUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_PHOTO_URL_LEN) {
    throw new Error("photoUrl must be an https URL under 2000 characters");
  }
  if (!PHOTO_URL_RE.test(trimmed)) {
    throw new Error("photoUrl must be a valid https URL");
  }
  if (trimmed.toLowerCase().startsWith("https://javascript:")) {
    throw new Error("Invalid photoUrl");
  }
  return trimmed;
}

export async function assertMembershipsStaff(
  actor: MembershipsActor
): Promise<string> {
  const orgId = requireActorOrgId(actor);
  await assertMembershipsEnabled(orgId);
  return orgId;
}

export function rejectClientOrgFields(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const rec = body as Record<string, unknown>;
  if ("orgId" in rec || "organizationId" in rec) {
    throw new ForbiddenError(PRIVILEGED_ORG_FIELD);
  }
}

/** Reject billing / ban fields clients must never stamp in Phase 1. */
export function rejectPrivilegedGuestFields(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const rec = body as Record<string, unknown>;
  const blocked = [
    "stripeCustomerId",
    "bannedAt",
    "bannedReason",
    "createdById",
    "id",
  ] as const;
  for (const key of blocked) {
    if (key in rec) {
      throw new ForbiddenError(PRIVILEGED_GUEST_FIELD);
    }
  }
}

/** Load venue owned by actor org or throw. */
export async function requireActorVenue(
  orgId: string,
  locationId: string,
  opts?: { allowArchived?: boolean }
) {
  const id = requireId(locationId, "locationId");
  const venue = await prisma.venueLocation.findFirst({
    where: { id, orgId },
  });
  if (!venue) throw new ForbiddenError(LOCATION_NOT_FOUND);
  if (!opts?.allowArchived && venue.status === "archived") {
    throw new ForbiddenError(LOCATION_ARCHIVED);
  }
  return venue;
}

/**
 * When park-locked or HQ preference is set, park-stamped rows must match.
 * Park-locked actors may NOT see/mutate outside their assigned set (incl. null).
 */
export async function assertLocationInMembershipScope(
  actor: MembershipsActor,
  locationId: string | null | undefined
): Promise<void> {
  const full = await actorLocationScope(actor);
  if (full.parkLocked) {
    if (locationId == null || locationId === "") {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    if (!full.assignedLocationIds.includes(locationId)) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    return;
  }
  if (full.locationScoped && full.locationId) {
    if (locationId == null || locationId === "") return;
    if (locationId !== full.locationId) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
  }
}

/** Org ownership + park-lock / HQ preference fail-closed. */
export async function requireActorVenueInScope(
  actor: MembershipsActor,
  locationId: string,
  opts?: { allowArchived?: boolean }
) {
  const orgId = requireActorOrgId(actor);
  const venue = await requireActorVenue(orgId, locationId, opts);
  await assertLocationInMembershipScope(actor, locationId);
  return venue;
}

/**
 * Multi-venue visibility: park-locked / HQ-scoped actors may see a membership
 * when sell park, home park, OR an eligible redeem park is in their scope.
 * Money mutations stay stricter via assertGuestMembershipMutableByActor.
 */
export async function assertGuestMembershipVisibleToActor(
  actor: MembershipsActor,
  member: {
    orgId: string;
    planId: string;
    locationId: string;
    homeLocationId: string;
  }
): Promise<void> {
  const full = await actorLocationScope(actor);
  if (!full.parkLocked && !(full.locationScoped && full.locationId)) {
    return;
  }

  const allowed = new Set<string>([member.locationId, member.homeLocationId]);
  const eligible = await prisma.membershipVenueEligibility.findMany({
    where: {
      orgId: member.orgId,
      planId: member.planId,
      eligible: true,
    },
    select: { locationId: true },
  });
  for (const row of eligible) allowed.add(row.locationId);

  if (full.parkLocked) {
    const assigned = full.assignedLocationIds ?? [];
    if (assigned.some((id) => allowed.has(id))) return;
    throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
  }
  if (full.locationScoped && full.locationId) {
    if (allowed.has(full.locationId)) return;
    throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
  }
}

/**
 * Load GuestMembership in actor.orgId and enforce multi-venue visibility.
 * Use before verify/redeem/discount responses that return member PII/codes.
 */
export async function requireVisibleGuestMembership(
  actor: MembershipsActor,
  guestMembershipId: string
): Promise<{
  id: string;
  orgId: string;
  planId: string;
  locationId: string;
  homeLocationId: string;
}> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(guestMembershipId, "guestMembershipId");
  const row = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      orgId: true,
      planId: true,
      locationId: true,
      homeLocationId: true,
    },
  });
  if (!row) throw new ForbiddenError("Guest membership not found");
  await assertGuestMembershipVisibleToActor(actor, row);
  return row;
}

/** Park-lock / HQ scope filter for location-scoped membership lists. */
export async function locationScopeFilter(actor: MembershipsActor): Promise<{
  orgId: string;
  locationId?: string;
  locationIds?: string[];
  parkLocked?: boolean;
}> {
  const orgId = requireActorOrgId(actor);
  const scope = await actorLocationScope(actor);
  if (scope.parkLocked) {
    if (scope.locationId) {
      return {
        orgId,
        locationId: scope.locationId,
        locationIds: scope.assignedLocationIds,
        parkLocked: true,
      };
    }
    return {
      orgId,
      locationIds: scope.assignedLocationIds,
      parkLocked: true,
    };
  }
  if (scope.locationScoped && scope.locationId) {
    return { orgId, locationId: scope.locationId, parkLocked: false };
  }
  return { orgId, parkLocked: false };
}

/** @deprecated Prefer assertLocationInMembershipScope for park-lock sets. */
export function assertLocationInScope(
  scopeLocationId: string | null | undefined,
  rowLocationId: string | null | undefined
): void {
  if (!scopeLocationId) return;
  if (rowLocationId && rowLocationId !== scopeLocationId) {
    throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
  }
}
