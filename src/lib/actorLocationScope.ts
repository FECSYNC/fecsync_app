/**
 * Staff location scope for company admin (Enterprise HQ preference + park assignments).
 *
 * Resolves `{ orgId, locationId, companyWideView, locationScoped, parkLocked,
 * assignedLocationIds }` from the actor JWT + Membership preference
 * (`hqSelectedLocationId`) + MembershipVenueAssignment rows.
 * Never trusts client orgId/locationId.
 *
 * Policy:
 * - Platform software owner / FECSYNC storefront ops → All parks (company-wide).
 * - Org `platform_admin` OR `companyWideView` with NO assignments → company-wide.
 *   May use HQ preference as a VIEW FILTER when Enterprise entitled (or via
 *   park-context preference for Growth multi-venue CWV).
 * - One+ MembershipVenueAssignment → PARK-LOCKED to that set (Growth/Starter OK;
 *   does not require Enterprise). Never `locationId: null` "All".
 * - Park-stamped modules (ticketing, products, orders, booking packages, venues)
 *   MUST apply this scope on list/detail/mutate — not UI-only filters.
 * - `companyWideView` remains Layer-2 ownership visibility and does not by itself
 *   expand park assignments.
 *
 * See `src/lib/parkAdminScope.ts` (SSOT helpers) and docs/enterprise-hq-controls.md.
 */
import {
  resolveEffectiveParkScope,
  type EffectiveParkScope,
  type ParkAdminActor,
} from "@/lib/parkAdminScope";

export type ActorLocationScope = {
  orgId: string;
  /** null = All locations (company-wide only; never for park-locked). */
  locationId: string | null;
  /** Layer 2 VISIBILITY — independent of park preference. */
  companyWideView: boolean;
  /** True when a park filter is applied. */
  locationScoped: boolean;
  /** True when actor may only operate inside assignedLocationIds. */
  parkLocked: boolean;
  assignedLocationIds: string[];
};

export type ActorLocationScopeActor = ParkAdminActor;

/**
 * Shared location scope for list helpers and rollups.
 * Delegates to resolveEffectiveParkScope (assignments + HQ preference + owner bypass).
 */
export async function actorLocationScope(
  actor: ActorLocationScopeActor
): Promise<ActorLocationScope> {
  const scope = await resolveEffectiveParkScope(actor);
  return toActorLocationScope(scope);
}

export function toActorLocationScope(scope: EffectiveParkScope): ActorLocationScope {
  return {
    orgId: scope.orgId,
    locationId: scope.locationId,
    companyWideView: scope.companyWideView,
    locationScoped: scope.locationScoped,
    parkLocked: scope.parkLocked,
    assignedLocationIds: scope.assignedLocationIds,
  };
}

/**
 * Prisma `where` fragment for VenueLocation lists.
 * Park-locked: only assigned active venues (optionally narrowed to effective id).
 * Company-wide + preference: single active venue.
 * Always require `active` so a TOCTOU archive after scope resolve cannot return
 * an archived row as the "selected park" list.
 */
export function venueLocationScopeWhere(
  scope: ActorLocationScope
):
  | { id: string; status: "active" }
  | { id: { in: string[] }; status: "active" }
  | Record<string, never> {
  if (scope.parkLocked) {
    const ids =
      scope.locationId && scope.assignedLocationIds.includes(scope.locationId)
        ? [scope.locationId]
        : scope.assignedLocationIds;
    if (ids.length === 0) {
      return { id: { in: [] }, status: "active" };
    }
    if (ids.length === 1) {
      return { id: ids[0], status: "active" };
    }
    return { id: { in: ids }, status: "active" };
  }
  return scope.locationId
    ? { id: scope.locationId, status: "active" }
    : {};
}
