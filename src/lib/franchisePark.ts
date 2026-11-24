/**
 * Franchise park helpers (Step 2) — Option A under one Organization.
 *
 * Franchise = VenueLocation.isFranchise + park profile fields.
 * Managers = Membership.franchiseParkManager + park-lock via MembershipVenueAssignment.
 * Company SaaS billing / plan meters / HQ company meters stay on Organization.
 * Never trust client franchise flags for authorization.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  resolveEffectiveParkScope,
  type EffectiveParkScope,
  type ParkAdminActor,
} from "@/lib/parkAdminScope";

export const FRANCHISE_MANAGER_REQUIRED =
  "Franchise park manager authority is required";
export const FRANCHISE_INVITE_PARK_REQUIRED =
  "Franchise invites must assign at least one park inside your franchise parks";
export const FRANCHISE_INVITE_OUTSIDE_PARKS =
  "Cannot assign parks outside your franchise park assignment";
export const FRANCHISE_INVITE_NO_CWV =
  "Franchise park managers cannot grant company-wide authority";
export const FRANCHISE_INVITE_NO_PLATFORM_ADMIN =
  "Franchise park managers cannot invite platform admins";
export const FRANCHISE_MANAGER_NOT_PLATFORM_ADMIN =
  "Franchise park managers cannot be platform admins";
export const FRANCHISE_MANAGER_REQUIRES_PARK_LOCK =
  "Franchise park managers must be park-locked to at least one park";
export const FRANCHISE_ROSTER_OUTSIDE =
  "Outside your franchise park staff roster";
export const FRANCHISE_INVITE_EXISTING_COMPANY_WIDE =
  "Franchise park managers cannot re-invite company-wide or platform admin seats";
export const FRANCHISE_INVITE_EXISTING_SISTER_PARK =
  "Franchise park managers cannot re-invite staff assigned only to other parks";
export const FRANCHISE_VENUE_NOT_MANAGEABLE =
  "Franchise park managers may only edit franchise profile fields on assigned franchise parks";
export const FRANCHISE_PROFILE_FIELDS_ONLY =
  "Franchise park managers may only update franchise park profile fields";

export type FranchiseParkScope = EffectiveParkScope;

/**
 * Resolve park scope (includes franchiseParkManager from Membership).
 */
export async function resolveFranchiseParkScope(
  actor: ParkAdminActor
): Promise<FranchiseParkScope> {
  return resolveEffectiveParkScope(actor);
}

export function isFranchiseParkManager(scope: FranchiseParkScope): boolean {
  return scope.franchiseParkManager === true && scope.parkLocked === true;
}

/**
 * Company HQ staff-admin surfaces stay blocked for normal park-locked seats.
 * Franchise park managers may pass for controlled invite/roster paths only.
 */
export async function assertCompanyWideStaffAdminOrFranchiseManager(
  actor: ParkAdminActor,
  message: string
): Promise<FranchiseParkScope> {
  const scope = await resolveFranchiseParkScope(actor);
  if (!scope.parkLocked) return scope;
  if (isFranchiseParkManager(scope)) return scope;
  throw new ForbiddenError(message);
}

export async function assertIsFranchiseParkManager(
  actor: ParkAdminActor
): Promise<FranchiseParkScope> {
  const scope = await resolveFranchiseParkScope(actor);
  if (!isFranchiseParkManager(scope)) {
    throw new ForbiddenError(FRANCHISE_MANAGER_REQUIRED);
  }
  return scope;
}

/**
 * Normalize invite locationIds for a franchise manager: must be non-empty,
 * subset of manager assigned parks, ignore client orgId.
 */
export function normalizeFranchiseInviteLocationIds(
  managerScope: FranchiseParkScope,
  rawLocationIds: unknown
): string[] {
  if (!isFranchiseParkManager(managerScope)) {
    throw new ForbiddenError(FRANCHISE_MANAGER_REQUIRED);
  }
  const allowed = new Set(managerScope.assignedLocationIds);
  const requested = Array.isArray(rawLocationIds)
    ? rawLocationIds
        .filter((id): id is string => typeof id === "string" && isValidId(id))
        .map((id) => id.trim())
    : [];
  const unique = [...new Set(requested)];
  if (unique.length === 0) {
    if (managerScope.assignedLocationIds.length === 0) {
      throw new ForbiddenError(FRANCHISE_INVITE_PARK_REQUIRED);
    }
    return [...managerScope.assignedLocationIds];
  }
  for (const id of unique) {
    if (!allowed.has(id)) {
      throw new ForbiddenError(FRANCHISE_INVITE_OUTSIDE_PARKS);
    }
  }
  return unique;
}

/**
 * Membership ids visible on a franchise manager's park-local roster:
 * active assignment intersecting the manager's parks.
 */
export async function listFranchiseRosterMembershipIds(
  orgId: string,
  managerAssignedLocationIds: string[]
): Promise<string[]> {
  if (!isValidId(orgId) || managerAssignedLocationIds.length === 0) return [];
  const rows = await prisma.membershipVenueAssignment.findMany({
    where: {
      orgId,
      locationId: { in: managerAssignedLocationIds },
      location: { status: "active", orgId },
    },
    select: { membershipId: true },
    distinct: ["membershipId"],
  });
  return rows.map((r) => r.membershipId);
}

export async function assertMembershipInFranchiseRoster(
  orgId: string,
  membershipId: string,
  managerAssignedLocationIds: string[]
): Promise<void> {
  if (!isValidId(membershipId)) {
    throw new ForbiddenError(FRANCHISE_ROSTER_OUTSIDE);
  }
  const hit = await prisma.membershipVenueAssignment.findFirst({
    where: {
      membershipId,
      orgId,
      locationId: { in: managerAssignedLocationIds },
      location: { status: "active", orgId },
    },
    select: { id: true },
  });
  if (!hit) {
    throw new ForbiddenError(FRANCHISE_ROSTER_OUTSIDE);
  }
}

/**
 * Franchise re-invite of an existing seat must not demote company-wide /
 * platform_admin seats or steal sister-park-only assignments via replace-set.
 * New users (no membership) and orphan park-unlocked non-CWV seats may proceed.
 */
export async function assertFranchiseInviteExistingSeat(input: {
  orgId: string;
  membership: {
    id: string;
    rolePreset: string;
    companyWideView: boolean;
  };
  managerAssignedLocationIds: string[];
}): Promise<void> {
  const { membership, orgId, managerAssignedLocationIds } = input;
  if (membership.rolePreset === "platform_admin" || membership.companyWideView) {
    throw new ForbiddenError(FRANCHISE_INVITE_EXISTING_COMPANY_WIDE);
  }
  if (!isValidId(membership.id) || managerAssignedLocationIds.length === 0) {
    throw new ForbiddenError(FRANCHISE_INVITE_PARK_REQUIRED);
  }
  const assigned = await prisma.membershipVenueAssignment.findMany({
    where: {
      membershipId: membership.id,
      orgId,
      location: { status: "active", orgId },
    },
    select: { locationId: true },
  });
  if (assigned.length === 0) return;
  const allowed = new Set(managerAssignedLocationIds);
  const overlaps = assigned.some((a) => allowed.has(a.locationId));
  if (!overlaps) {
    throw new ForbiddenError(FRANCHISE_INVITE_EXISTING_SISTER_PARK);
  }
}

/** Invariants when granting franchiseParkManager on a seat. */
export function assertFranchiseManagerSeatInvariants(input: {
  rolePreset: string;
  franchiseParkManager: boolean;
  assignedLocationIds: string[];
}): void {
  if (!input.franchiseParkManager) return;
  if (input.rolePreset === "platform_admin") {
    throw new ForbiddenError(FRANCHISE_MANAGER_NOT_PLATFORM_ADMIN);
  }
  if (input.assignedLocationIds.length === 0) {
    throw new ForbiddenError(FRANCHISE_MANAGER_REQUIRES_PARK_LOCK);
  }
}

/**
 * Durable capability pack for franchise park managers (hardening).
 * Granting franchiseParkManager must unlock park staff invite/roster + park
 * Connect without smoke scripts manually seeding users:invite.
 * users:park_assign + users:manage_roles are park-scoped by members APIs
 * (sister parks / CWV / platform_admin still forbidden).
 */
export const FRANCHISE_MANAGER_CAPABILITY_PERMISSIONS = [
  "users:read",
  "users:invite",
  "users:park_assign",
  "users:manage_roles",
  "payouts:read",
  "payouts:manage",
] as const;

/** @deprecated Prefer FRANCHISE_MANAGER_CAPABILITY_PERMISSIONS */
export const FRANCHISE_MANAGER_PAYOUT_PERMISSIONS =
  FRANCHISE_MANAGER_CAPABILITY_PERMISSIONS;

/**
 * Park-ops permission pack stamped on franchise manager invites when the client
 * sends empty/custom overrides. Does not require the manager to hold the full
 * company ops_manager matrix. Never includes company HQ / CWV / platform_admin.
 */
export const FRANCHISE_PARK_STAFF_PERMISSIONS = [
  "ticketing:read",
  "ticketing_products:read",
  "ticketing_sessions:read",
  "ticketing_addons:read",
  "ticketing_passes:read",
  "ticketing_resources:read",
  "ticketing_settings:read",
  "bookings:read",
  "bookings:calendar_read",
  "bookings:write",
  "bookings:create",
  "bookings:assign",
  "bookings:payments_take",
  "bookings:payments_read",
  "parties:read",
  "parties:write",
  "memberships:read",
  "memberships:write",
  "memberships:sell",
  "waivers:read",
  "waivers:write",
  "waivers:verify",
  "pos:sell",
  "pos:read",
  "pos:checkin",
  "pos:tabs",
] as const;

/** Ensure override includes the full FPM capability pack (deduped, sorted). */
export function ensureFranchiseManagerCapabilityPermissions(
  permissionsOverride: string[] | null | undefined
): string[] {
  const set = new Set<string>(
    Array.isArray(permissionsOverride) ? permissionsOverride.filter(Boolean) : []
  );
  for (const p of FRANCHISE_MANAGER_CAPABILITY_PERMISSIONS) {
    set.add(p);
  }
  return Array.from(set).sort();
}

/** @deprecated Prefer ensureFranchiseManagerCapabilityPermissions */
export function ensureFranchiseManagerPayoutPermissions(
  permissionsOverride: string[] | null | undefined
): string[] {
  return ensureFranchiseManagerCapabilityPermissions(permissionsOverride);
}

const FRANCHISE_INVITE_PERMISSION_ALLOWLIST = new Set<string>([
  ...FRANCHISE_PARK_STAFF_PERMISSIONS,
]);

export const FRANCHISE_INVITE_PERMISSION_DENIED =
  "Franchise invites may only grant park operations permissions";

/**
 * Resolve permissionsOverride for a franchise park manager invite.
 * Empty / missing overrides get the park staff pack so invites are useful.
 * Non-empty overrides must be a subset of the franchise park staff allowlist
 * (managers do not need to hold the full company ops_manager matrix).
 */
export function resolveFranchiseInvitePermissionsOverride(
  permissionsOverride: string[] | null | undefined
): string[] {
  if (!Array.isArray(permissionsOverride) || permissionsOverride.length === 0) {
    return [...FRANCHISE_PARK_STAFF_PERMISSIONS].sort();
  }
  const unique = [...new Set(permissionsOverride.filter(Boolean))];
  for (const p of unique) {
    if (!FRANCHISE_INVITE_PERMISSION_ALLOWLIST.has(p)) {
      throw new ForbiddenError(FRANCHISE_INVITE_PERMISSION_DENIED);
    }
  }
  return unique.sort();
}

/**
 * Franchise manager invite/edit of park staff: always custom + allowlisted pack.
 * Prevents API clients from assigning ops_manager/finance presets or HQ keys.
 */
export function resolveFranchiseStaffSeatGrants(
  permissionsOverride: string[] | null | undefined
): { rolePreset: "custom"; permissionsOverride: string[] } {
  return {
    rolePreset: "custom",
    permissionsOverride: resolveFranchiseInvitePermissionsOverride(
      permissionsOverride
    ),
  };
}

/**
 * Keys franchise park managers may PATCH on assigned franchise VenueLocations.
 * They may not change slug, isFranchise, publicBookingEnabled, or lifecycle.
 */
export const FRANCHISE_MANAGER_VENUE_KEYS = [
  "franchiseDisplayName",
  "franchiseSupportPhone",
  "franchiseSupportEmail",
  "franchiseCode",
  "franchiseNotes",
  "name",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
  "timezone",
] as const;

export function isFranchiseManagerVenueUpdate(keys: string[]): boolean {
  const allowed = new Set<string>(FRANCHISE_MANAGER_VENUE_KEYS);
  return keys.length > 0 && keys.every((k) => allowed.has(k));
}
