/**
 * Party location scope: venue ownership + archived guard + HQ / park lock.
 * orgId always comes from the actor; a locationId from the client is only a
 * picker value and is validated here.
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId, requireId } from "@/lib/ids";
import {
  applyTicketingLocationScope,
  assertLocationInHqScope,
  rejectClientOrgFields,
  requireActorVenue,
  LOCATION_REQUIRED,
  LOCATION_OUT_OF_SCOPE,
  PRIVILEGED_ORG_FIELD,
  type TicketingActor,
} from "@/lib/ticketing/common";

export type PartyScope = {
  orgId: string;
  locationId?: string;
  locationIds?: string[];
  parkLocked?: boolean;
};

/** Reject orgId / organizationId in a JSON body (400 via bookingValidationResponse). */
export function rejectBodyOrgId(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON");
  }
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return b;
}

export function rejectQueryOrgId(params: URLSearchParams): void {
  if (params.has("orgId") || params.has("organizationId")) {
    throw new Error(PRIVILEGED_ORG_FIELD);
  }
}

/**
 * Archived-venue guard for every party create (packages, rooms, menu items,
 * sessions, parties). Venue must belong to the org and be active.
 */
export async function assertVenueWritable(orgId: string, locationId: string) {
  return requireActorVenue(orgId, requireId(locationId, "locationId"));
}

/**
 * Resolve the venue for a party write. Explicit picker values are checked
 * against org, archived status, and the actor's HQ / park scope; when absent,
 * a single scoped venue is used.
 */
export async function resolvePartyLocationId(
  actor: TicketingActor,
  scope: PartyScope,
  raw: unknown,
  opts?: { allowArchived?: boolean }
): Promise<string> {
  let locationId: string | null = null;
  if (typeof raw === "string" && raw.trim()) {
    if (!isValidId(raw.trim())) throw new Error("Invalid locationId");
    locationId = raw.trim();
  } else if (scope.locationId) {
    locationId = scope.locationId;
  } else if (scope.parkLocked && scope.locationIds?.length === 1) {
    locationId = scope.locationIds[0]!;
  }
  if (!locationId) throw new Error(LOCATION_REQUIRED);
  await requireActorVenue(scope.orgId, locationId, {
    allowArchived: opts?.allowArchived,
  });
  await assertLocationInHqScope(actor, locationId);
  return locationId;
}

/** Prisma `locationId` fragment for party list queries (scope + optional filter). */
export function partyLocationWhere(
  scope: PartyScope,
  requested?: string | null
): { locationId?: string | { in: string[] } } {
  const where: { locationId?: string | { in: string[] } } = {};
  applyTicketingLocationScope(scope, where);
  const filter = typeof requested === "string" ? requested.trim() : "";
  if (filter) {
    if (!isValidId(filter)) throw new Error("Invalid locationId");
    if (typeof where.locationId === "string") {
      if (where.locationId !== filter) throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    } else if (where.locationId && typeof where.locationId === "object") {
      if (!where.locationId.in.includes(filter)) {
        throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
      }
      where.locationId = filter;
    } else {
      where.locationId = filter;
    }
  }
  return where;
}

/** True when a park-stamped row is visible to this scope. */
export function locationInPartyScope(scope: PartyScope, locationId: string): boolean {
  if (scope.parkLocked) {
    const allowed = scope.locationId
      ? [scope.locationId]
      : scope.locationIds ?? [];
    return allowed.includes(locationId);
  }
  if (scope.locationId) return scope.locationId === locationId;
  return true;
}
