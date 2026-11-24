/**
 * Park context API helpers — works for Growth park admins without Enterprise HQ.
 * Persists Membership.hqSelectedLocationId; park-locked may only select assigned parks.
 * Enterprise HQ `/api/admin/hq/location-context` delegates set path validation here
 * when park-locked (Enterprise gate still applies on HQ routes for rollup).
 */
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertRegisteredCompanyVenueOrg } from "@/lib/venueLocations";
import { orgHasEnterpriseHq } from "@/lib/enterpriseHq";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";
import {
  PARK_CONTEXT_ALL_DENIED,
  PARK_OUTSIDE_ASSIGNMENT,
  resolveEffectiveParkScope,
  type AssignedLocationDto,
  type ParkAdminActor,
} from "@/lib/parkAdminScope";
import { clearCachedLocationScope } from "@/lib/ticketing/staffGateCache";

export type ParkContextDto = {
  orgId: string;
  parkLocked: boolean;
  companyWideView: boolean;
  enterpriseHqEnabled: boolean;
  effectiveLocationId: string | null;
  assignedLocations: AssignedLocationDto[];
  hqSelectedLocationId: string | null;
  /** Soft label for UI — name of effective park when locked/scoped. */
  effectiveLocationName: string | null;
};

export async function getParkContext(
  actor: ParkAdminActor
): Promise<ParkContextDto> {
  const orgId = requireActorOrgId(actor);
  const ownerHost = await resolveIsPlatformSoftwareOwner(actor);
  if (!ownerHost) {
    await assertRegisteredCompanyVenueOrg(orgId, actor);
  }

  const scope = await resolveEffectiveParkScope(actor);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      isDefault: true,
      status: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });

  const enterpriseHqEnabled =
    ownerHost ||
    (org != null &&
      orgHasEnterpriseHq({
        isDefault: org.isDefault,
        status: org.status,
        subscriptionPlan: org.subscriptionPlan,
        subscriptionStatus: org.subscriptionStatus,
        subscriptionEndsAt: org.subscriptionEndsAt,
      }));

  let effectiveLocationName: string | null = null;
  if (scope.locationId) {
    const fromAssigned = scope.assignedLocations.find(
      (l) => l.id === scope.locationId
    );
    if (fromAssigned) {
      effectiveLocationName = fromAssigned.name;
    } else {
      const v = await prisma.venueLocation.findFirst({
        where: { id: scope.locationId, orgId },
        select: { name: true },
      });
      effectiveLocationName = v?.name ?? null;
    }
  }

  return {
    orgId,
    parkLocked: scope.parkLocked,
    companyWideView: scope.companyWideView,
    enterpriseHqEnabled: Boolean(enterpriseHqEnabled),
    effectiveLocationId: scope.locationId,
    assignedLocations: scope.assignedLocations,
    hqSelectedLocationId: scope.hqSelectedLocationId,
    effectiveLocationName,
  };
}

/**
 * Set selected park preference. Park-locked: must be in assigned set (never null All).
 * Company-wide: null = All locations; otherwise venue must belong to org and be active.
 */
export async function setParkContext(
  actor: ParkAdminActor,
  locationId: string | null
): Promise<ParkContextDto> {
  const orgId = requireActorOrgId(actor);
  const ownerHost = await resolveIsPlatformSoftwareOwner(actor);
  if (!ownerHost) {
    await assertRegisteredCompanyVenueOrg(orgId, actor);
  }

  const scope = await resolveEffectiveParkScope(actor);
  const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
  if (!userId || !isValidId(userId) || !scope.membershipId) {
    throw new ForbiddenError("Active membership required to set park context");
  }

  if (locationId == null || locationId === "") {
    if (scope.parkLocked) {
      throw new ForbiddenError(PARK_CONTEXT_ALL_DENIED);
    }
    await prisma.membership.updateMany({
      where: {
        id: scope.membershipId,
        hqSelectedLocationId: { not: null },
      },
      data: { hqSelectedLocationId: null },
    });
  } else {
    let id: string;
    try {
      id = requireId(locationId, "locationId");
    } catch {
      throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
    }

    if (scope.parkLocked && !scope.assignedLocationIds.includes(id)) {
      throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
    }

    await prisma.$transaction(
      async (tx) => {
        // Serialize against concurrent archive (same order as HQ location-context).
        const locked = await tx.$queryRaw<
          { id: string; status: string }[]
        >`
          SELECT id, status::text AS status
          FROM venue_locations
          WHERE id = ${id} AND "orgId" = ${orgId}
          FOR UPDATE
        `;
        if (!locked.length || locked[0].status !== "active") {
          throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
        }
        const seat = await tx.membership.findUnique({
          where: { id: scope.membershipId! },
          select: { id: true, status: true },
        });
        if (!seat || seat.status !== "active") {
          throw new ForbiddenError(
            "Active membership required to set park context"
          );
        }
        await tx.membership.updateMany({
          where: { id: seat.id, status: "active" },
          data: { hqSelectedLocationId: locked[0].id },
        });
      },
      { maxWait: 10_000, timeout: 15_000 }
    );
  }

  // Bust location-scope cache so subsequent lists see the new preference.
  clearCachedLocationScope(`parkScope:${orgId}:${userId}`);
  clearCachedLocationScope(`scope:${orgId}:${userId}`);

  return getParkContext(actor);
}

export function parseParkContextBody(body: unknown): {
  locationId: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON");
  }
  const o = body as Record<string, unknown>;
  if (!("locationId" in o) || o.locationId == null || o.locationId === "") {
    return { locationId: null };
  }
  if (typeof o.locationId !== "string") {
    throw new Error("locationId must be a string or null");
  }
  const trimmed = o.locationId.trim();
  if (!trimmed) return { locationId: null };
  if (!isValidId(trimmed)) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }
  return { locationId: trimmed };
}
