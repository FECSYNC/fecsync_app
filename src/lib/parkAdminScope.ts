/**
 * Park-admin assignment scope (MembershipVenueAssignment) — SSOT.
 *
 * Effective authority order:
 * 1. Platform software owner / FECSYNC storefront ops → company-wide, all parks
 * 2. Membership platform_admin OR companyWideView with NO assignments → company-wide
 * 3. One+ MembershipVenueAssignment rows → PARK-LOCKED to that set
 * 4. Else (no assignments, not CWV, not platform_admin) → own-records /
 *    Layer-2 visibility only — not park-locked and not silent all-park admin.
 *
 * Never trust client orgId/locationId. Enterprise HQ entitlement is independent —
 * park lock works on Growth/Starter without Enterprise.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  actorHasCompanyWideView,
  requireActorOrgId,
} from "@/lib/staffOrg";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";
import {
  getCachedLocationScope,
  setCachedLocationScope,
  clearCachedLocationScopesForOrg,
} from "@/lib/ticketing/staffGateCache";

export const PARK_OUTSIDE_ASSIGNMENT =
  "Outside your park assignment";
export const PARK_ASSIGNMENT_REQUIRED =
  "Park admins must be assigned to at least one venue";
export const PARK_CONTEXT_ALL_DENIED =
  "Park-locked admins cannot select All locations";
export const PARK_ASSIGN_REQUIRES_CWV =
  "Assigning park venues requires company-wide (or platform_admin) authority";
export const PARK_LAST_ADMIN_LOCK =
  "Cannot park-lock the last company-wide admin — keep at least one company-wide seat";

export type ParkAdminActor = {
  orgId?: string | null;
  sub?: string;
  companyWideView?: boolean | null;
  preset?: string | null;
  membershipRole?: string | null;
  storefrontOrgId?: string | null;
};

export type AssignedLocationDto = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type EffectiveParkScope = {
  orgId: string;
  /** Effective selected park; null only when company-wide (All locations). */
  locationId: string | null;
  companyWideView: boolean;
  /** True when a single-park filter is applied (preference or forced single assignment). */
  locationScoped: boolean;
  /** True when actor may ONLY operate inside assignedLocationIds. */
  parkLocked: boolean;
  assignedLocationIds: string[];
  assignedLocations: AssignedLocationDto[];
  hqSelectedLocationId: string | null;
  membershipId: string | null;
  rolePreset: string | null;
  /**
   * Franchise park manager (Step 2). True only when Membership.franchiseParkManager
   * and park-locked — never for platform_admin / company-wide seats.
   */
  franchiseParkManager: boolean;
};

function isPlatformAdminPreset(actor: ParkAdminActor): boolean {
  return (
    actor.preset === "platform_admin" ||
    actor.membershipRole === "platform_admin"
  );
}

/**
 * Load active venue assignments for a membership; drop archived/orphan rows.
 */
export async function loadActiveAssignmentsForMembership(
  membershipId: string,
  orgId: string
): Promise<AssignedLocationDto[]> {
  if (!isValidId(membershipId) || !isValidId(orgId)) return [];

  const rows = await prisma.membershipVenueAssignment.findMany({
    where: { membershipId, orgId },
    select: {
      id: true,
      locationId: true,
      location: {
        select: { id: true, name: true, slug: true, status: true, orgId: true },
      },
    },
  });

  const active: AssignedLocationDto[] = [];
  const staleIds: string[] = [];

  for (const row of rows) {
    const loc = row.location;
    if (
      !loc ||
      loc.orgId !== orgId ||
      loc.status !== "active" ||
      loc.id !== row.locationId
    ) {
      staleIds.push(row.id);
      continue;
    }
    active.push({
      id: loc.id,
      name: loc.name,
      slug: loc.slug,
      status: loc.status,
    });
  }

  if (staleIds.length) {
    await prisma.membershipVenueAssignment
      .deleteMany({ where: { id: { in: staleIds } } })
      .catch(() => {});
    // Stale rows (archived venue / wrong org) removed outside archive txn —
    // bust scope caches so JWT/session consumers do not keep dead parks.
    clearCachedLocationScopesForOrg(orgId);
  }

  return active;
}

/**
 * Resolve effective park scope for staff APIs and UI.
 * Cached briefly via staffGateCache (same TTL as HQ location scope).
 */
export async function resolveEffectiveParkScope(
  actor: ParkAdminActor
): Promise<EffectiveParkScope> {
  const orgId = requireActorOrgId(actor);
  const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
  const cacheKey = `parkScope:${orgId}:${userId}`;
  const cached = getCachedLocationScope<EffectiveParkScope>(cacheKey);
  if (cached) return cached;

  const finish = (scope: EffectiveParkScope): EffectiveParkScope => {
    setCachedLocationScope(cacheKey, scope);
    return scope;
  };

  const companyWideView = actorHasCompanyWideView(actor);
  const softwareOwner = await resolveIsPlatformSoftwareOwner(actor);

  if (softwareOwner) {
    return finish({
      orgId,
      locationId: null,
      companyWideView: true,
      locationScoped: false,
      parkLocked: false,
      assignedLocationIds: [],
      assignedLocations: [],
      hqSelectedLocationId: null,
      membershipId: null,
      rolePreset: "platform_admin",
      franchiseParkManager: false,
    });
  }

  if (!userId || !isValidId(userId)) {
    return finish({
      orgId,
      locationId: null,
      companyWideView,
      locationScoped: false,
      parkLocked: false,
      assignedLocationIds: [],
      assignedLocations: [],
      hqSelectedLocationId: null,
      membershipId: null,
      rolePreset: null,
      franchiseParkManager: false,
    });
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: {
      id: true,
      status: true,
      hqSelectedLocationId: true,
      rolePreset: true,
      companyWideView: true,
      franchiseParkManager: true,
    },
  });

  if (!membership || membership.status !== "active") {
    return finish({
      orgId,
      locationId: null,
      companyWideView,
      locationScoped: false,
      parkLocked: false,
      assignedLocationIds: [],
      assignedLocations: [],
      hqSelectedLocationId: null,
      membershipId: null,
      rolePreset: null,
      franchiseParkManager: false,
    });
  }

  const assignedLocations = await loadActiveAssignmentsForMembership(
    membership.id,
    orgId
  );
  const assignedLocationIds = assignedLocations.map((l) => l.id);
  const preferredRaw = membership.hqSelectedLocationId;
  const preferredId =
    preferredRaw && isValidId(preferredRaw) ? preferredRaw : null;

  async function clearStalePreference(id: string) {
    await prisma.membership.updateMany({
      where: { id: membership!.id, hqSelectedLocationId: id },
      data: { hqSelectedLocationId: null },
    });
  }

  // Heal HQ preference when pointing at archived/wrong-org venue.
  if (preferredId) {
    const venue = await prisma.venueLocation.findFirst({
      where: { id: preferredId, orgId, status: "active" },
      select: { id: true },
    });
    if (!venue) {
      await clearStalePreference(preferredId);
    }
  }

  const hqSelectedLocationId = preferredId
    ? (
        await prisma.venueLocation.findFirst({
          where: { id: preferredId, orgId, status: "active" },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const isOrgPlatformAdmin =
    membership.rolePreset === "platform_admin" || isPlatformAdminPreset(actor);

  // Company-wide: platform_admin OR CWV with no park assignments.
  // Franchise manager flag is meaningless without park-lock — force false.
  if (
    isOrgPlatformAdmin ||
    (companyWideView && assignedLocationIds.length === 0)
  ) {
    return finish({
      orgId,
      locationId: hqSelectedLocationId,
      companyWideView: true,
      locationScoped: Boolean(hqSelectedLocationId),
      parkLocked: false,
      assignedLocationIds: [],
      assignedLocations: [],
      hqSelectedLocationId,
      membershipId: membership.id,
      rolePreset: membership.rolePreset,
      franchiseParkManager: false,
    });
  }

  // CWV true BUT has assignments → still park-locked (explicit assignment wins).
  // Non-CWV with assignments → park-locked.
  if (assignedLocationIds.length > 0) {
    let effectiveId: string;
    if (assignedLocationIds.length === 1) {
      effectiveId = assignedLocationIds[0];
      // Heal preference to the only assigned park when mismatched.
      if (hqSelectedLocationId !== effectiveId) {
        await prisma.membership.updateMany({
          where: { id: membership.id, status: "active" },
          data: { hqSelectedLocationId: effectiveId },
        });
      }
    } else if (
      hqSelectedLocationId &&
      assignedLocationIds.includes(hqSelectedLocationId)
    ) {
      effectiveId = hqSelectedLocationId;
    } else {
      effectiveId = assignedLocationIds[0];
      if (hqSelectedLocationId && hqSelectedLocationId !== effectiveId) {
        await prisma.membership.updateMany({
          where: {
            id: membership.id,
            hqSelectedLocationId: hqSelectedLocationId,
          },
          data: { hqSelectedLocationId: effectiveId },
        });
      } else if (!hqSelectedLocationId) {
        await prisma.membership.updateMany({
          where: { id: membership.id, status: "active" },
          data: { hqSelectedLocationId: effectiveId },
        });
      }
    }

    const franchiseParkManager =
      membership.franchiseParkManager === true &&
      membership.rolePreset !== "platform_admin";

    return finish({
      orgId,
      locationId: effectiveId,
      companyWideView: false,
      locationScoped: true,
      parkLocked: true,
      assignedLocationIds,
      assignedLocations,
      hqSelectedLocationId: effectiveId,
      membershipId: membership.id,
      rolePreset: membership.rolePreset,
      franchiseParkManager,
    });
  }

  // No assignments, not CWV, not platform_admin — own-records (Layer-2), not
  // park-locked. Park filters do not apply; staffOwnProductFilter / similar
  // ownership scopes still limit catalog visibility.
  return finish({
    orgId,
    locationId: null,
    companyWideView: false,
    locationScoped: false,
    parkLocked: false,
    assignedLocationIds: [],
    assignedLocations: [],
    hqSelectedLocationId,
    membershipId: membership.id,
    rolePreset: membership.rolePreset,
    franchiseParkManager: false,
  });
}

export function isParkLockedActor(scope: EffectiveParkScope): boolean {
  return scope.parkLocked === true;
}

export async function assertActorCanAccessLocation(
  actor: ParkAdminActor,
  locationId: string | null | undefined
): Promise<EffectiveParkScope> {
  const scope = await resolveEffectiveParkScope(actor);
  if (!scope.parkLocked) return scope;

  if (locationId == null || locationId === "") {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }
  if (!isValidId(locationId) || !scope.assignedLocationIds.includes(locationId)) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }
  return scope;
}

/** Minimal shape for list/mutate park filters (EffectiveParkScope satisfies this). */
export type ParkScopeFilterInput = {
  parkLocked: boolean;
  locationId: string | null;
  locationScoped: boolean;
  assignedLocationIds: string[];
};

/**
 * Prisma where fragment for park-stamped rows (`locationId` or `venueLocationId`).
 * Park-locked: IN assigned set (never null shared rows unless field allows).
 * Company-wide + preference: exact location when scoped.
 * Company-wide All: no extra filter.
 * SSOT for ticketing/memberships/waivers stamped lists — prefer this over ad-hoc filters.
 */
export function assignedLocationFilter(
  scope: ParkScopeFilterInput,
  field: "locationId" | "venueLocationId" = "locationId"
): Record<string, unknown> {
  if (scope.parkLocked) {
    if (scope.assignedLocationIds.length === 0) {
      // Fail-closed: match nothing.
      return { [field]: { in: [] as string[] } };
    }
    if (scope.locationId) {
      return { [field]: scope.locationId };
    }
    return { [field]: { in: scope.assignedLocationIds } };
  }
  if (scope.locationScoped && scope.locationId) {
    return { [field]: scope.locationId };
  }
  return {};
}

/**
 * Product/Order staff list filter: park-locked hides null (company-shared) rows.
 */
export function venueStampedResourceFilter(
  scope: EffectiveParkScope,
  field: "venueLocationId" | "locationId" = "venueLocationId"
): Record<string, unknown> {
  if (scope.parkLocked) {
    const ids = scope.locationId
      ? [scope.locationId]
      : scope.assignedLocationIds;
    if (ids.length === 0) return { [field]: { in: [] as string[] } };
    return { [field]: { in: ids } };
  }
  if (scope.locationScoped && scope.locationId) {
    // CWV preference: show that park + company-shared (null).
    return {
      OR: [{ [field]: scope.locationId }, { [field]: null }],
    };
  }
  return {};
}

export function assertLocationInAssignedSet(
  scope: EffectiveParkScope,
  locationId: string | null | undefined,
  opts?: { allowNullForCompanyWide?: boolean }
): void {
  if (!scope.parkLocked) {
    if (locationId == null || locationId === "") {
      if (opts?.allowNullForCompanyWide === false) {
        throw new ForbiddenError(PARK_ASSIGNMENT_REQUIRED);
      }
      return;
    }
    return;
  }
  if (locationId == null || locationId === "") {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }
  if (!scope.assignedLocationIds.includes(locationId)) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }
}

/**
 * Actor may manage venue assignments only when company-wide / platform_admin / software owner.
 */
export async function assertCanManageVenueAssignments(
  actor: ParkAdminActor
): Promise<EffectiveParkScope> {
  const scope = await resolveEffectiveParkScope(actor);
  if (await resolveIsPlatformSoftwareOwner(actor)) return scope;
  // Step 2: franchise park managers may assign parks only inside their set
  // (enforced by the venue-assignments route + locationIds intersection).
  if (scope.parkLocked && scope.franchiseParkManager) {
    return scope;
  }
  if (scope.parkLocked) {
    throw new ForbiddenError(PARK_ASSIGN_REQUIRES_CWV);
  }
  if (
    !scope.companyWideView &&
    scope.rolePreset !== "platform_admin" &&
    !isPlatformAdminPreset(actor)
  ) {
    throw new ForbiddenError(PARK_ASSIGN_REQUIRES_CWV);
  }
  return scope;
}

/**
 * Replace-set assignments for a membership. Validates venues active + same org.
 * Caller must already have users:park_assign + assertCanManageVenueAssignments.
 */
export async function replaceMembershipVenueAssignments(input: {
  membershipId: string;
  orgId: string;
  locationIds: string[];
  /** When true, refuse if this would park-lock the last org platform_admin. */
  protectLastPlatformAdmin?: boolean;
}): Promise<AssignedLocationDto[]> {
  const { membershipId, orgId } = input;
  const uniqueIds = [
    ...new Set(
      input.locationIds
        .filter((id): id is string => typeof id === "string" && isValidId(id))
        .map((id) => id.trim())
    ),
  ];

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, orgId },
    select: {
      id: true,
      userId: true,
      rolePreset: true,
      companyWideView: true,
      status: true,
      hqSelectedLocationId: true,
    },
  });
  if (!membership) {
    throw new ForbiddenError("Membership not found");
  }
  if (membership.status === "revoked" || membership.status === "suspended") {
    throw new ForbiddenError(
      "Cannot assign parks to a revoked or suspended membership"
    );
  }

  // Non-empty input that yields zero valid ids would otherwise silently clear parks.
  if (input.locationIds.length > 0 && uniqueIds.length === 0) {
    throw new ForbiddenError(
      "One or more venues are invalid, archived, or outside this company"
    );
  }

  if (membership.rolePreset === "platform_admin" && uniqueIds.length > 0) {
    throw new ForbiddenError(
      "platform_admin seats stay company-wide — demote the role before assigning parks"
    );
  }

  if (uniqueIds.length > 0) {
    const venues = await prisma.venueLocation.findMany({
      where: {
        id: { in: uniqueIds },
        orgId,
        status: "active",
      },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (venues.length !== uniqueIds.length) {
      throw new ForbiddenError(
        "One or more venues are invalid, archived, or outside this company"
      );
    }
  }

  // Empty set clears park lock (CWV → company-wide; non-CWV → own-records).
  // Preference cleared below so sticky park filter cannot linger.

  // Park-locking this seat (adding ≥1 assignment) must not remove the last
  // company-wide operator who can still manage assignments / venues.
  if (uniqueIds.length > 0 && input.protectLastPlatformAdmin !== false) {
    const existingAssignmentCount = await prisma.membershipVenueAssignment.count(
      {
        where: { membershipId: membership.id },
      }
    );
    const currentlyCompanyWide =
      membership.rolePreset === "platform_admin" ||
      (membership.companyWideView === true && existingAssignmentCount === 0);
    if (currentlyCompanyWide) {
      const otherCwAdmins = await prisma.membership.count({
        where: {
          orgId,
          status: "active",
          id: { not: membership.id },
          OR: [
            { rolePreset: "platform_admin" },
            {
              companyWideView: true,
              venueAssignments: { none: {} },
            },
          ],
        },
      });
      if (otherCwAdmins === 0) {
        throw new ForbiddenError(PARK_LAST_ADMIN_LOCK);
      }
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.membershipVenueAssignment.deleteMany({
        where: { membershipId: membership.id },
      });
      if (uniqueIds.length > 0) {
        // Re-check active inside the txn (archive may have raced the pre-check).
        const stillActive = await tx.venueLocation.findMany({
          where: {
            id: { in: uniqueIds },
            orgId,
            status: "active",
          },
          select: { id: true },
        });
        if (stillActive.length !== uniqueIds.length) {
          throw new ForbiddenError(
            "One or more venues are invalid, archived, or outside this company"
          );
        }
        await tx.membershipVenueAssignment.createMany({
          data: uniqueIds.map((locationId) => ({
            membershipId: membership.id,
            orgId,
            locationId,
          })),
        });
        // Keep current preference when it remains in the new set; otherwise first assigned.
        const prevPref =
          membership.hqSelectedLocationId &&
          isValidId(membership.hqSelectedLocationId)
            ? membership.hqSelectedLocationId
            : null;
        const nextPref =
          prevPref && uniqueIds.includes(prevPref) ? prevPref : uniqueIds[0];
        await tx.membership.update({
          where: { id: membership.id },
          data: { hqSelectedLocationId: nextPref },
        });
      } else {
        // Unlock to company-wide / unassigned — clear sticky park preference (All)
        // and franchise manager (requires park-lock).
        await tx.membership.update({
          where: { id: membership.id },
          data: {
            hqSelectedLocationId: null,
            franchiseParkManager: false,
          },
        });
      }
    },
    { maxWait: 10_000, timeout: 15_000 }
  );

  clearCachedLocationScopesForOrg(orgId);
  return loadActiveAssignmentsForMembership(membership.id, orgId);
}

/** Clear assignments pointing at an archived venue (call inside archive txn).
 * Returns distinct userIds that lost an assignment (caller should invalidate sessions).
 * Also clears franchiseParkManager on seats left with zero active assignments.
 */
export async function clearAssignmentsForVenue(
  tx: {
    membershipVenueAssignment: {
      findMany: (args: {
        where: { locationId: string; orgId: string };
        select: {
          membershipId: true;
          membership: { select: { userId: true } };
        };
      }) => Promise<
        Array<{ membershipId: string; membership: { userId: string } }>
      >;
      deleteMany: (args: {
        where: { locationId: string; orgId: string };
      }) => Promise<unknown>;
      count: (args: {
        where: { membershipId: string; orgId: string };
      }) => Promise<number>;
    };
    membership: {
      updateMany: (args: {
        where: { id: { in: string[] }; orgId: string };
        data: { franchiseParkManager: false };
      }) => Promise<unknown>;
    };
  },
  orgId: string,
  locationId: string
): Promise<string[]> {
  const rows = await tx.membershipVenueAssignment.findMany({
    where: { locationId, orgId },
    select: {
      membershipId: true,
      membership: { select: { userId: true } },
    },
  });
  const membershipIds = [...new Set(rows.map((r) => r.membershipId))];
  await tx.membershipVenueAssignment.deleteMany({
    where: { locationId, orgId },
  });
  const clearedManagerIds: string[] = [];
  for (const mid of membershipIds) {
    const remaining = await tx.membershipVenueAssignment.count({
      where: { membershipId: mid, orgId },
    });
    if (remaining === 0) clearedManagerIds.push(mid);
  }
  if (clearedManagerIds.length > 0) {
    await tx.membership.updateMany({
      where: { id: { in: clearedManagerIds }, orgId },
      data: { franchiseParkManager: false },
    });
  }
  return [...new Set(rows.map((r) => r.membership.userId))];
}
