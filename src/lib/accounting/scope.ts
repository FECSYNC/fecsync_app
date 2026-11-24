/**
 * Accounting location scope. Park-locked actors never see company-level
 * (locationId null) ledger rows; HQ park preference narrows to that park.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import type { ActorLocationScope } from "@/lib/actorLocationScope";
import { acctError, ACCT } from "@/lib/accounting/errors";
import type { AccountingCtx, ScopeFilter, Db } from "@/lib/accounting/types";

export function buildScope(scope: ActorLocationScope): ScopeFilter {
  if (scope.parkLocked) {
    const ids =
      scope.locationId && scope.assignedLocationIds.includes(scope.locationId)
        ? [scope.locationId]
        : [...scope.assignedLocationIds];
    return { allLocations: false, locationIds: ids, parkLocked: true };
  }
  if (scope.locationId) {
    return { allLocations: false, locationIds: [scope.locationId], parkLocked: false };
  }
  return { allLocations: true, locationIds: [], parkLocked: false };
}

/** Reject client-supplied tenant ids (orgId always comes from the actor). */
export function rejectBodyOrgId(
  body: unknown,
  searchParams?: URLSearchParams | null
): void {
  if (searchParams && (searchParams.has("orgId") || searchParams.has("organizationId"))) {
    throw acctError(ACCT.BODY_ORG_REJECTED);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const rec = body as Record<string, unknown>;
  if ("orgId" in rec || "organizationId" in rec) {
    throw acctError(ACCT.BODY_ORG_REJECTED);
  }
}

export function canSeeCompanyLevel(scope: ScopeFilter): boolean {
  return scope.allLocations;
}

/** Narrow the actor scope to one requested location (must be inside scope). */
export function narrowScope(scope: ScopeFilter, locationId?: string | null): ScopeFilter {
  if (!locationId) return scope;
  if (!isValidId(locationId)) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  if (!scope.allLocations && !scope.locationIds.includes(locationId)) {
    throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  }
  return { allLocations: false, locationIds: [locationId], parkLocked: scope.parkLocked };
}

export function narrowScopeMany(scope: ScopeFilter, locationIds: string[]): ScopeFilter {
  const ids = locationIds.filter(Boolean);
  if (ids.length === 0) return scope;
  for (const id of ids) {
    if (!isValidId(id)) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
    if (!scope.allLocations && !scope.locationIds.includes(id)) {
      throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
    }
  }
  return { allLocations: false, locationIds: ids, parkLocked: scope.parkLocked };
}

/** Prisma where fragment on a nullable `locationId` column. */
export function locationWhere(scope: ScopeFilter): { locationId?: { in: string[] } } {
  if (scope.allLocations) return {};
  return { locationId: { in: scope.locationIds } };
}

export const lineScopeWhere = locationWhere;
export const documentScopeWhere = locationWhere;

/** AccountBalance rows use locationKey ("" = company-level). */
export function locationKeyWhere(scope: ScopeFilter): { locationKey?: { in: string[] } } {
  if (scope.allLocations) return {};
  return { locationKey: { in: scope.locationIds } };
}

export function isLocationVisible(scope: ScopeFilter, locationId: string | null): boolean {
  if (scope.allLocations) return true;
  return locationId != null && scope.locationIds.includes(locationId);
}

/** 404 when a row's location is outside the actor scope (do not leak existence). */
export function assertRowInScope(ctx: AccountingCtx, locationId: string | null): void {
  if (ctx.system) return;
  if (!isLocationVisible(ctx.scope, locationId)) throw acctError(ACCT.NOT_FOUND);
}

/**
 * New documents: the location must belong to the org, be active, and be in
 * scope. Null (company-level) requires a company-wide actor.
 */
export async function assertLocationWritable(
  ctx: AccountingCtx,
  locationId: string | null | undefined,
  db: Db = prisma
): Promise<string | null> {
  if (locationId == null || locationId === "") {
    if (!ctx.system && !ctx.scope.allLocations) {
      throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
    }
    return null;
  }
  if (!isValidId(locationId)) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  const venue = await db.venueLocation.findFirst({
    where: { id: locationId, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!venue) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  if (!ctx.system && !isLocationVisible(ctx.scope, venue.id)) {
    throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  }
  if (venue.status !== "active") throw acctError(ACCT.LOCATION_ARCHIVED);
  return venue.id;
}
