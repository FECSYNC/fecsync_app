/**
 * Shared ticketing staff gates + venue ownership helpers.
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertOrganizationActive } from "@/lib/org";
import { assertTicketingEnabled } from "@/lib/ticketing/assertTicketingEnabled";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";
import {
  actorLocationScope,
  type ActorLocationScopeActor,
} from "@/lib/actorLocationScope";
import { assignedLocationFilter } from "@/lib/parkAdminScope";
import {
  getCachedStaffGate,
  setCachedStaffGate,
} from "@/lib/ticketing/staffGateCache";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";

export type TicketingActor = ActorLocationScopeActor & {
  orgId?: string | null;
  sub?: string;
  storefrontOrgId?: string | null;
};

export const LOCATION_REQUIRED = "Venue location is required";
export const LOCATION_NOT_FOUND = "Venue location not found";
export const LOCATION_ARCHIVED =
  "This venue is archived — choose an active venue";
export const LOCATION_OUT_OF_SCOPE =
  "Outside your park assignment";
export const PRODUCT_NOT_FOUND = "Admission product not found";
export const RESOURCE_NOT_FOUND = "Capacity resource not found";
export const SESSION_NOT_FOUND = "Ticket session not found";
export const ACCOUNT_NOT_FOUND = "Booking account not found";
export const PRIVILEGED_ORG_FIELD =
  "orgId cannot be set from the client — it is taken from your session";

export async function assertTicketingStaffMutate(
  actor: TicketingActor
): Promise<string> {
  const orgId = requireActorOrgId(actor);
  const sub =
    typeof actor.sub === "string" && actor.sub.trim() ? actor.sub.trim() : "";
  const cacheKey = `mutate:${orgId}:${sub}`;
  if (getCachedStaffGate(cacheKey)) {
    return orgId;
  }

  if (await resolveIsPlatformSoftwareOwner(actor)) {
    // Software owner on storefront host — full ticketing without company seat.
    await assertOrganizationActive(orgId);
    setCachedStaffGate(cacheKey);
    return orgId;
  }

  // assertTicketingEnabled → assertModuleEnabled already runs Active + Billing +
  // Demo + plan moduleHints. Avoid stacking duplicate org reads on every list GET.
  await assertTicketingEnabled(orgId, actor);
  setCachedStaffGate(cacheKey);
  return orgId;
}

export async function assertTicketingStaffRead(
  actor: TicketingActor
): Promise<string> {
  // Same gates — Demo / storefront / unpaid must not browse catalog either.
  return assertTicketingStaffMutate(actor);
}

/** Load active venue owned by actor org or throw. */
export async function requireActorVenue(
  orgId: string,
  locationId: string,
  opts?: { allowArchived?: boolean }
) {
  const id = requireId(locationId, "locationId");
  const venue = await prisma.venueLocation.findFirst({
    where: { id, orgId },
  });
  if (!venue) {
    throw new ForbiddenError(LOCATION_NOT_FOUND);
  }
  if (!opts?.allowArchived && venue.status === "archived") {
    throw new ForbiddenError(LOCATION_ARCHIVED);
  }
  return venue;
}

/**
 * When park-locked or HQ preference is set, park-stamped rows must match.
 * Company-wide actors may see null-location rows (e.g. some B2B accounts).
 * Park-locked actors may NOT see/mutate outside their assigned set (incl. null).
 */
export async function assertLocationInHqScope(
  actor: TicketingActor,
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
  const scope = await locationScopeFilter(actor);
  if (!scope.locationId) return;
  if (locationId == null || locationId === "") return;
  if (locationId !== scope.locationId) {
    throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
  }
}

/**
 * Mutates on park-stamped ticketing rows fail closed when the venue is archived.
 * Pass `allowArchived: true` for wind-down only (soft-archive product, close session).
 */
export async function assertVenueActiveForTicketingMutate(
  orgId: string,
  locationId: string,
  opts?: { allowArchived?: boolean }
): Promise<void> {
  await requireActorVenue(orgId, locationId, opts);
}

export function rejectClientOrgFields(body: Record<string, unknown>): void {
  if (
    Object.prototype.hasOwnProperty.call(body, "orgId") ||
    Object.prototype.hasOwnProperty.call(body, "organizationId")
  ) {
    throw new Error(PRIVILEGED_ORG_FIELD);
  }
}

export async function locationScopeFilter(
  actor: TicketingActor
): Promise<{
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

/**
 * Stamp Prisma `locationId` from park / HQ scope via assignedLocationFilter (SSOT).
 * Park-locked with zero assigned venues → `{ in: [] }` (fail-closed, never org-wide).
 */
export function applyTicketingLocationScope(
  scope: {
    locationId?: string;
    locationIds?: string[];
    parkLocked?: boolean;
  },
  where: { locationId?: string | { in: string[] } }
): void {
  const fragment = assignedLocationFilter(
    {
      parkLocked: scope.parkLocked === true,
      locationId: scope.locationId ?? null,
      locationScoped: Boolean(scope.locationId),
      assignedLocationIds:
        scope.locationIds ??
        (scope.locationId ? [scope.locationId] : []),
    },
    "locationId"
  );
  Object.assign(where, fragment);
}

export function parseOptionalId(
  raw: unknown,
  field: string
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !isValidId(raw)) {
    throw new Error(`Invalid ${field}`);
  }
  return raw;
}
