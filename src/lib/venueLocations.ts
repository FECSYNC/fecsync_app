/**
 * VenueLocation helpers — multi-park foundation under Organization.
 *
 * Choice: do NOT auto-create a venue on company register or first approve.
 * Operators create the first location from /admin/venues after Billing entitlement.
 * Storefront / DEFAULT_ORG has no venue-location requirement.
 */
import type { VenueLocation, VenueLocationStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  assertWithinPlanLimit,
  BILLING_REQUIRED_MESSAGE,
  isCompanyBillingCreateEntitled,
  planLimitReachedMessage,
} from "@/lib/planLimits";
import { getPlanLimits, isSubscriptionPlanId } from "@/lib/subscriptionPlans";
import { assertOrganizationActive, getStorefrontOrgId, ORG_SUSPENDED_MESSAGE } from "@/lib/org";
import { VENUE_STOREFRONT_MESSAGE } from "@/lib/venueLocationMeter";
import { isTransientDbError } from "@/lib/commerceSerialize";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import {
  actorLocationScope,
  venueLocationScopeWhere,
} from "@/lib/actorLocationScope";
import type { PlatformOwnerActor } from "@/lib/platformSoftwareOwner";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";
import {
  assertActorCanAccessLocation,
  clearAssignmentsForVenue,
  resolveEffectiveParkScope,
} from "@/lib/parkAdminScope";
import { clearCachedLocationScopesForOrg } from "@/lib/ticketing/staffGateCache";

export const VENUE_NAME_REQUIRED = "Venue name is required";
export const VENUE_NAME_TOO_LONG = "Venue name is too long";
export const VENUE_SLUG_INVALID = "Venue slug is invalid";
export const VENUE_SLUG_TAKEN = "Venue slug already in use for this company";
export const VENUE_PRIVILEGED_FIELD =
  "Venue id, status, and archivedAt cannot be set by the client";
/** Re-export for callers / smokes — SSOT lives in venueLocationMeter. */
export { VENUE_STOREFRONT_MESSAGE };

export type VenueLocationActor = PlatformOwnerActor & {
  orgId?: string | null;
  sub?: string;
};

export type VenueLocationDto = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: VenueLocationStatus;
  archivedAt: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string | null;
  publicBookingEnabled: boolean;
  /** Franchise unit under the parent Organization (Option A). */
  isFranchise: boolean;
  franchiseDisplayName: string | null;
  franchiseSupportPhone: string | null;
  franchiseSupportEmail: string | null;
  franchiseCode: string | null;
  franchiseNotes: string | null;
  /** Organization.slug — still used by public booking APIs after venue resolve. */
  orgSlug?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateVenueLocationInput = {
  name: string;
  slug?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  /** Company-wide admins only — mark park as franchise unit. */
  isFranchise?: boolean;
  franchiseDisplayName?: string | null;
  franchiseSupportPhone?: string | null;
  franchiseSupportEmail?: string | null;
  franchiseCode?: string | null;
  franchiseNotes?: string | null;
};

export type UpdateVenueLocationInput = {
  name?: string;
  slug?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  publicBookingEnabled?: boolean;
  /** Company-wide admins only. */
  isFranchise?: boolean;
  franchiseDisplayName?: string | null;
  franchiseSupportPhone?: string | null;
  franchiseSupportEmail?: string | null;
  franchiseCode?: string | null;
  franchiseNotes?: string | null;
};

export const VENUE_NOT_FOUND = "Venue location not found";
export const VENUE_UPDATE_EMPTY = "No venue fields to update";

function normalizeVenueSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function requireVenueName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error(VENUE_NAME_REQUIRED);
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length < 2) throw new Error(VENUE_NAME_REQUIRED);
  if (name.length > 120) throw new Error(VENUE_NAME_TOO_LONG);
  return name;
}

function requireVenueSlug(raw: unknown, fallbackFromName: string): string {
  const source =
    typeof raw === "string" && raw.trim() ? raw : fallbackFromName;
  const slug = normalizeVenueSlug(source);
  if (!slug || slug.length < 2) throw new Error(VENUE_SLUG_INVALID);
  return slug;
}

function optionalTrim(raw: unknown, max = 200): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  return v.slice(0, max);
}

/**
 * Venue locations are company-tenant only — except platform software owner
 * on the storefront host (may create/manage venues without a company login).
 */
export async function assertRegisteredCompanyVenueOrg(
  orgId: string,
  actor?: PlatformOwnerActor | null
): Promise<void> {
  const id = requireId(orgId, "orgId");
  if (actor && (await resolveIsPlatformSoftwareOwner(actor))) {
    const ownerOrg =
      typeof actor.orgId === "string" ? actor.orgId.trim() : "";
    if (ownerOrg && ownerOrg === id) return;
  }
  const storefrontOrgId = await getStorefrontOrgId();
  if (id === storefrontOrgId) {
    throw new ForbiddenError(VENUE_STOREFRONT_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { isDefault: true },
  });
  // Missing org (deleted mid-session) — fail closed; do not mislabel as storefront.
  if (!org) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  if (org.isDefault) {
    throw new ForbiddenError(VENUE_STOREFRONT_MESSAGE);
  }
}

export function toVenueLocationDto(
  row: VenueLocation,
  orgSlug?: string | null
): VenueLocationDto {
  const fr = row as VenueLocation & {
    isFranchise?: boolean;
    franchiseDisplayName?: string | null;
    franchiseSupportPhone?: string | null;
    franchiseSupportEmail?: string | null;
    franchiseCode?: string | null;
    franchiseNotes?: string | null;
    publicBookingEnabled?: boolean;
  };
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    timezone: row.timezone,
    publicBookingEnabled: Boolean(fr.publicBookingEnabled),
    isFranchise: Boolean(fr.isFranchise),
    franchiseDisplayName: fr.franchiseDisplayName ?? null,
    franchiseSupportPhone: fr.franchiseSupportPhone ?? null,
    franchiseSupportEmail: fr.franchiseSupportEmail ?? null,
    franchiseCode: fr.franchiseCode ?? null,
    franchiseNotes: fr.franchiseNotes ?? null,
    orgSlug: orgSlug ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ListVenueLocationsOptions = {
  /**
   * When true (default), apply location preference so a selected park narrows
   * the Venues console list. Pass false for switchers that need every *allowed*
   * venue. Park-locked actors ALWAYS stay inside their assigned set (RBAC wall).
   */
  applyLocationScope?: boolean;
};

export async function listVenueLocations(
  actor: VenueLocationActor,
  options?: ListVenueLocationsOptions
): Promise<VenueLocationDto[]> {
  const orgId = requireActorOrgId(actor);
  const ownerHost = await resolveIsPlatformSoftwareOwner(actor);
  await assertRegisteredCompanyVenueOrg(orgId, actor);
  await assertOrganizationActive(orgId);
  // Match Fresh Demo lock — venue reads are not a Demo-allowed surface either.
  // Platform software owner on the host org is never Demo-locked.
  if (!ownerHost) await assertNotDemoPlanLocked(orgId);

  const preferScope = options?.applyLocationScope !== false;
  const scope = await actorLocationScope(actor);

  // Park-locked: always RBAC-filter to assigned set (even when switcher asks scope=all).
  // Company-wide: preference filter only when applyLocationScope is true.
  const scopeWhere = scope.parkLocked
    ? venueLocationScopeWhere({
        ...scope,
        // Switcher wants all assigned parks, not only the effective preference.
        locationId:
          preferScope && scope.locationId ? scope.locationId : null,
        locationScoped: preferScope ? scope.locationScoped : false,
      })
    : preferScope
      ? venueLocationScopeWhere(scope)
      : {};

  let rows = await prisma.venueLocation.findMany({
    where: {
      orgId,
      ...scopeWhere,
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  // Race: CWV preference resolved active then archive emptied list — heal to All.
  // Never expand park-locked actors to company-wide.
  if (
    !scope.parkLocked &&
    preferScope &&
    scope.locationScoped &&
    scope.locationId &&
    rows.length === 0
  ) {
    const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
    if (userId && isValidId(userId)) {
      await prisma.membership.updateMany({
        where: {
          userId,
          orgId,
          hqSelectedLocationId: scope.locationId,
        },
        data: { hqSelectedLocationId: null },
      });
    }
    rows = await prisma.venueLocation.findMany({
      where: { orgId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
  }

  const orgSlug = await resolveOrgSlug(orgId);

  return rows.map((row) => toVenueLocationDto(row, orgSlug));
}

/**
 * Create a venue under actor.orgId.
 * Plan cap is re-checked inside a locked transaction so concurrent creates
 * cannot overshoot the entitled venues limit. Retries Serializable conflicts
 * (P2034) a few times — same pattern as measurement campaign joins.
 */
export async function createVenueLocation(
  actor: VenueLocationActor,
  input: CreateVenueLocationInput
): Promise<VenueLocationDto> {
  const orgId = requireActorOrgId(actor);
  const ownerHost = await resolveIsPlatformSoftwareOwner(actor);
  await assertRegisteredCompanyVenueOrg(orgId, actor);
  await assertOrganizationActive(orgId);
  // Match Fresh Demo lock — venue mutations are not a Demo-allowed surface.
  if (!ownerHost) await assertNotDemoPlanLocked(orgId);

  const parkScope = await resolveEffectiveParkScope(actor);
  if (parkScope.parkLocked) {
    throw new ForbiddenError(
      "Park-locked admins cannot create sister venues — ask a company admin"
    );
  }

  const name = requireVenueName(input.name);
  const slug = requireVenueSlug(input.slug, name);

  // Fast-fail billing / storefront / cap before opening a write tx.
  // Owner host: unlimited venues on the storefront org (no company seat).
  if (!ownerHost) await assertWithinPlanLimit(orgId, "venues");

  const addressLine1 = optionalTrim(input.addressLine1);
  const addressLine2 = optionalTrim(input.addressLine2);
  const city = optionalTrim(input.city, 120);
  const region = optionalTrim(input.region, 120);
  const postalCode = optionalTrim(input.postalCode, 40);
  const country = optionalTrim(input.country, 120);
  const timezone = optionalTrim(input.timezone, 80);
  const isFranchise = Boolean(input.isFranchise);
  const franchiseDisplayName = optionalTrim(input.franchiseDisplayName, 120);
  const franchiseSupportPhone = optionalTrim(input.franchiseSupportPhone, 40);
  const franchiseSupportEmail = optionalTrim(input.franchiseSupportEmail, 200);
  const franchiseCode = optionalTrim(input.franchiseCode, 80);
  const franchiseNotes = optionalTrim(input.franchiseNotes, 2000);

  const runCreate = async (): Promise<VenueLocation> => {
    return prisma.$transaction(
      async (tx) => {
        // Serialize venue creates per company so the active-count check is stable.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE
        `;
        if (!locked.length) {
          // Org deleted between Fresh and write — fail closed.
          throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, orgId);
        }

        const lockedOrg = await tx.organization.findUnique({
          where: { id: orgId },
          select: {
            status: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            subscriptionPlan: true,
          },
        });
        if (!lockedOrg) {
          throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, orgId);
        }
        if (
          !ownerHost &&
          !isCompanyBillingCreateEntitled({
            subscriptionStatus: lockedOrg.subscriptionStatus,
            subscriptionEndsAt: lockedOrg.subscriptionEndsAt,
            orgStatus: lockedOrg.status,
          })
        ) {
          throw new ForbiddenError(BILLING_REQUIRED_MESSAGE);
        }
        if (!ownerHost) {
          const rawPlan =
            lockedOrg.subscriptionPlan?.trim().toLowerCase() || null;
          const planResolved =
            rawPlan && isSubscriptionPlanId(rawPlan) ? rawPlan : "starter";
          const cap = getPlanLimits(planResolved).venues;
          if (cap != null) {
            const used = await tx.venueLocation.count({
              where: { orgId, status: "active" },
            });
            if (used + 1 > cap) {
              throw new ForbiddenError(
                planLimitReachedMessage("venues", planResolved)
              );
            }
          }
        }

        return tx.venueLocation.create({
          data: {
            orgId,
            name,
            slug,
            status: "active",
            addressLine1,
            addressLine2,
            city,
            region,
            postalCode,
            country,
            timezone,
            isFranchise,
            franchiseDisplayName,
            franchiseSupportPhone,
            franchiseSupportEmail,
            franchiseCode,
            franchiseNotes,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000,
      }
    );
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await runCreate();
      return toVenueLocationDto(row);
    } catch (err) {
      lastErr = err;
      if (err instanceof ForbiddenError) throw err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "P2002") {
        throw new Error(VENUE_SLUG_TAKEN);
      }
      // Org vanished (FK) during create — same fail-closed as empty FOR UPDATE.
      if (code === "P2003") {
        throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, orgId);
      }
      // Serialization conflict under concurrent creates — retry.
      if (code === "P2034" && attempt < 2) continue;
      if (isTransientDbError(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to create venue location");
}

export function parseCreateVenueLocationBody(
  body: unknown
): CreateVenueLocationInput {
  // Ignore client-supplied orgId — always actor.orgId. Reject id/status so a
  // client cannot mass-assign archived/active or forge primary keys.
  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (() => {
          const o = body as Record<string, unknown>;
          if ("id" in o || "status" in o || "archivedAt" in o) {
            throw new Error(VENUE_PRIVILEGED_FIELD);
          }
          const { orgId: _ignored, ...rest } = o;
          return rest;
        })()
      : body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid JSON");
  }
  const o = raw as Record<string, unknown>;
  return {
    name: typeof o.name === "string" ? o.name : "",
    slug: typeof o.slug === "string" ? o.slug : undefined,
    addressLine1: typeof o.addressLine1 === "string" ? o.addressLine1 : null,
    addressLine2: typeof o.addressLine2 === "string" ? o.addressLine2 : null,
    city: typeof o.city === "string" ? o.city : null,
    region: typeof o.region === "string" ? o.region : null,
    postalCode: typeof o.postalCode === "string" ? o.postalCode : null,
    country: typeof o.country === "string" ? o.country : null,
    timezone: typeof o.timezone === "string" ? o.timezone : null,
    isFranchise:
      "isFranchise" in o ? Boolean(o.isFranchise) : undefined,
    franchiseDisplayName:
      typeof o.franchiseDisplayName === "string"
        ? o.franchiseDisplayName
        : o.franchiseDisplayName === null
          ? null
          : undefined,
    franchiseSupportPhone:
      typeof o.franchiseSupportPhone === "string"
        ? o.franchiseSupportPhone
        : o.franchiseSupportPhone === null
          ? null
          : undefined,
    franchiseSupportEmail:
      typeof o.franchiseSupportEmail === "string"
        ? o.franchiseSupportEmail
        : o.franchiseSupportEmail === null
          ? null
          : undefined,
    franchiseCode:
      typeof o.franchiseCode === "string"
        ? o.franchiseCode
        : o.franchiseCode === null
          ? null
          : undefined,
    franchiseNotes:
      typeof o.franchiseNotes === "string"
        ? o.franchiseNotes
        : o.franchiseNotes === null
          ? null
          : undefined,
  };
}

async function loadActorVenueOrThrow(
  actor: VenueLocationActor,
  venueId: string
): Promise<VenueLocation> {
  const orgId = requireActorOrgId(actor);
  const ownerHost = await resolveIsPlatformSoftwareOwner(actor);
  await assertRegisteredCompanyVenueOrg(orgId, actor);
  await assertOrganizationActive(orgId);
  // Defense in depth — same Demo fail-closed as Fresh on GET/PATCH/DELETE routes.
  if (!ownerHost) await assertNotDemoPlanLocked(orgId);
  let id: string;
  try {
    id = requireId(venueId, "venueId");
  } catch {
    // Invalid shapes → same client-facing miss as cross-tenant (no 500).
    throw new ForbiddenError(VENUE_NOT_FOUND);
  }
  const row = await prisma.venueLocation.findFirst({
    where: { id, orgId },
  });
  if (!row) {
    throw new ForbiddenError(VENUE_NOT_FOUND);
  }
  // Park-locked: fail-closed outside assignment (404-shaped Forbidden).
  try {
    await assertActorCanAccessLocation(actor, row.id);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      throw new ForbiddenError(VENUE_NOT_FOUND);
    }
    throw err;
  }
  return row;
}

async function resolveOrgSlug(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { slug: true },
  });
  return org?.slug ?? null;
}

export async function getVenueLocation(
  actor: VenueLocationActor,
  venueId: string
): Promise<VenueLocationDto> {
  const row = await loadActorVenueOrThrow(actor, venueId);
  return toVenueLocationDto(row, await resolveOrgSlug(row.orgId));
}

/**
 * Update venue profile fields under actor.orgId.
 * Registered-company Active org (Starter/Growth/Enterprise) — not HQ-only.
 * Create entitlement is not required (matches README: entitlement gates
 * plan-capped creates / reactivate). Status / archivedAt are not client-writable.
 *
 * Franchise park managers (Step 2) may PATCH park-manageable profile fields on
 * assigned franchise venues only — never slug, isFranchise, publish, or lifecycle.
 */
export async function updateVenueLocation(
  actor: VenueLocationActor,
  venueId: string,
  input: UpdateVenueLocationInput
): Promise<VenueLocationDto> {
  const existing = await loadActorVenueOrThrow(actor, venueId);
  const parkScope = await resolveEffectiveParkScope(actor);

  const requestedKeys = Object.keys(input).filter(
    (k) => (input as Record<string, unknown>)[k] !== undefined
  );

  const {
    isFranchiseParkManager,
    isFranchiseManagerVenueUpdate,
    FRANCHISE_VENUE_NOT_MANAGEABLE,
    FRANCHISE_PROFILE_FIELDS_ONLY,
  } = await import("@/lib/franchisePark");

  // Company-wide: full profile + franchise flag.
  // Franchise managers: park-manageable fields on assigned franchise parks only.
  // Other park-locked seats: Step 1 profile edits (no franchise flag / lifecycle).
  if (parkScope.parkLocked && isFranchiseParkManager(parkScope)) {
    if (!isFranchiseManagerVenueUpdate(requestedKeys)) {
      throw new ForbiddenError(FRANCHISE_PROFILE_FIELDS_ONLY);
    }
    const existingFr = existing as VenueLocation & { isFranchise?: boolean };
    if (!existingFr.isFranchise) {
      throw new ForbiddenError(FRANCHISE_VENUE_NOT_MANAGEABLE);
    }
  } else if (parkScope.parkLocked) {
    if (
      input.isFranchise !== undefined ||
      input.slug !== undefined ||
      input.publicBookingEnabled !== undefined
    ) {
      throw new ForbiddenError(
        "Park-locked admins cannot change franchise flag, slug, or publish — ask a company admin"
      );
    }
  }

  const data: Prisma.VenueLocationUpdateInput = {};
  if (input.name !== undefined) {
    data.name = requireVenueName(input.name);
  }
  if (input.slug !== undefined) {
    data.slug = requireVenueSlug(input.slug, existing.name);
  }
  if (input.addressLine1 !== undefined) {
    data.addressLine1 = optionalTrim(input.addressLine1);
  }
  if (input.addressLine2 !== undefined) {
    data.addressLine2 = optionalTrim(input.addressLine2);
  }
  if (input.city !== undefined) {
    data.city = optionalTrim(input.city, 120);
  }
  if (input.region !== undefined) {
    data.region = optionalTrim(input.region, 120);
  }
  if (input.postalCode !== undefined) {
    data.postalCode = optionalTrim(input.postalCode, 40);
  }
  if (input.country !== undefined) {
    data.country = optionalTrim(input.country, 120);
  }
  if (input.timezone !== undefined) {
    data.timezone = optionalTrim(input.timezone, 80);
  }
  if (input.publicBookingEnabled !== undefined) {
    data.publicBookingEnabled = Boolean(input.publicBookingEnabled);
  }
  if (input.isFranchise !== undefined) {
    data.isFranchise = Boolean(input.isFranchise);
  }
  if (input.franchiseDisplayName !== undefined) {
    data.franchiseDisplayName = optionalTrim(input.franchiseDisplayName, 120);
  }
  if (input.franchiseSupportPhone !== undefined) {
    data.franchiseSupportPhone = optionalTrim(input.franchiseSupportPhone, 40);
  }
  if (input.franchiseSupportEmail !== undefined) {
    data.franchiseSupportEmail = optionalTrim(input.franchiseSupportEmail, 200);
  }
  if (input.franchiseCode !== undefined) {
    data.franchiseCode = optionalTrim(input.franchiseCode, 80);
  }
  if (input.franchiseNotes !== undefined) {
    data.franchiseNotes = optionalTrim(input.franchiseNotes, 2000);
  }

  if (Object.keys(data).length === 0) {
    throw new Error(VENUE_UPDATE_EMPTY);
  }

  try {
    const row = await prisma.venueLocation.update({
      where: { id: existing.id },
      data,
    });
    return toVenueLocationDto(row);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "P2002") {
      throw new Error(VENUE_SLUG_TAKEN);
    }
    if (code === "P2025") {
      throw new ForbiddenError(VENUE_NOT_FOUND);
    }
    throw err;
  }
}

/**
 * Soft-archive a venue. Frees the `venues` plan quota (active count only).
 * Idempotent: already archived → heal HQ prefs / archivedAt and return current row.
 * Registered-company Active org (not Enterprise-only; not a plan-capped create).
 *
 * Venue status + Membership HQ prefs that pointed at this venue are updated
 * in one transaction so archive cannot leave stale location-context pointers.
 * Also clears guest park MembershipVenueEligibility, location-scoped
 * MembershipSettings / cancel alternatives, nulls settings.defaultHomeLocationId
 * for this venue, and soft-archives park-specific MembershipPlans (keeps
 * locationId historical stamp — never promotes to org-default via SetNull).
 *
 * Park-locked seats may edit assigned venue profile fields but cannot archive
 * (clears org-wide assignments / HQ prefs / quota) — company-wide lifecycle only.
 */
export async function archiveVenueLocation(
  actor: VenueLocationActor,
  venueId: string
): Promise<VenueLocationDto> {
  const existing = await loadActorVenueOrThrow(actor, venueId);
  const parkScope = await resolveEffectiveParkScope(actor);
  if (parkScope.parkLocked) {
    throw new ForbiddenError(
      "Park-locked admins cannot archive venues — ask a company admin"
    );
  }

  try {
    const { row, affectedUserIds } = await prisma.$transaction(
      async (tx) => {
        // Lock venue first (same order as HQ location-context GET/SET).
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM venue_locations
          WHERE id = ${existing.id} AND "orgId" = ${existing.orgId}
          FOR UPDATE
        `;
        if (!locked.length) {
          throw new ForbiddenError(VENUE_NOT_FOUND);
        }

        const current = await tx.venueLocation.findFirst({
          where: { id: existing.id, orgId: existing.orgId },
        });
        if (!current) {
          throw new ForbiddenError(VENUE_NOT_FOUND);
        }

        let updated = current;
        if (current.status !== "archived" || current.archivedAt == null) {
          updated = await tx.venueLocation.update({
            where: { id: current.id },
            data: {
              status: "archived",
              archivedAt: current.archivedAt ?? new Date(),
            },
          });
        }

        // Always clear HQ prefs (heals retries / prior partial clears).
        const prefHolders = await tx.membership.findMany({
          where: {
            orgId: current.orgId,
            hqSelectedLocationId: current.id,
          },
          select: { userId: true },
        });
        await tx.membership.updateMany({
          where: {
            orgId: current.orgId,
            hqSelectedLocationId: current.id,
          },
          data: { hqSelectedLocationId: null },
        });
        // Drop park assignments pointing at this venue.
        const assignmentUserIds = await clearAssignmentsForVenue(
          tx,
          current.orgId,
          current.id
        );
        // Guest park Memberships: drop eligibility + location settings for this
        // park so archive cannot leave redeem/eligibility pointing at a closed venue.
        // Soft-archive park-specific plans (keep locationId historical stamp —
        // never SetNull/promote to org-default). GuestMembership rows stay
        // (Restrict) — Phase 2+ sell/home stays historical.
        const parkPlans = await tx.membershipPlan.findMany({
          where: {
            orgId: current.orgId,
            locationId: current.id,
            archivedAt: null,
          },
          select: { id: true },
        });
        const parkPlanIds = parkPlans.map((p) => p.id);
        if (parkPlanIds.length > 0) {
          await tx.membershipPlan.updateMany({
            where: { id: { in: parkPlanIds } },
            data: { archivedAt: new Date() },
          });
          await tx.membershipVenueEligibility.deleteMany({
            where: { orgId: current.orgId, planId: { in: parkPlanIds } },
          });
        }
        await tx.membershipVenueEligibility.deleteMany({
          where: { orgId: current.orgId, locationId: current.id },
        });
        await tx.membershipSettings.deleteMany({
          where: { orgId: current.orgId, locationId: current.id },
        });
        await tx.membershipSettings.updateMany({
          where: {
            orgId: current.orgId,
            defaultHomeLocationId: current.id,
          },
          data: { defaultHomeLocationId: null },
        });
        await tx.membershipCancelAlternative.deleteMany({
          where: { orgId: current.orgId, locationId: current.id },
        });
        // GuestProfile.locationId stays until hard-delete (FK SetNull).
        const affectedUserIds = [
          ...new Set([
            ...assignmentUserIds,
            ...prefHolders.map((r) => r.userId),
          ]),
        ];
        return { row: updated, affectedUserIds };
      },
      {
        maxWait: 10_000,
        timeout: 15_000,
      }
    );
    clearCachedLocationScopesForOrg(existing.orgId);
    // Step 3: disable park Connect for new charges (ledger history kept).
    try {
      const { disableParkMarketplaceAccountOnArchive } = await import(
        "@/lib/marketplace/parkAccount"
      );
      await disableParkMarketplaceAccountOnArchive(existing.id);
    } catch (parkDisableErr) {
      console.error(
        "[archiveVenueLocation] park Connect disable failed:",
        parkDisableErr
      );
    }
    // Park-lock / assignment set changed — force affected seats to re-auth so
    // client parkLocked + assignedLocationIds stay synchronized with Membership.
    // Do not fail the archive if session bump errors (data already committed).
    if (affectedUserIds.length > 0) {
      try {
        const { invalidateUserSessions } = await import("@/lib/memberAdmin");
        await Promise.all(
          affectedUserIds.map((userId) => invalidateUserSessions(userId))
        );
      } catch (invalidateErr) {
        console.error(
          "[archiveVenueLocation] session invalidate failed after archive:",
          invalidateErr
        );
      }
    }
    return toVenueLocationDto(row);
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "P2025") {
      throw new ForbiddenError(VENUE_NOT_FOUND);
    }
    throw err;
  }
}

/**
 * Reactivate an archived venue. Burns venues quota — assertWithinPlanLimit.
 * Idempotent: already active → return current row (does not re-check / re-burn quota).
 * Create-style entitlement required when transitioning archived → active.
 *
 * Lock order matches archive / HQ preference: venue row first, then org when
 * burning quota — so concurrent archive is visible before an active DTO returns.
 */
export async function reactivateVenueLocation(
  actor: VenueLocationActor,
  venueId: string
): Promise<VenueLocationDto> {
  const existing = await loadActorVenueOrThrow(actor, venueId);
  const orgId = existing.orgId;
  const ownerHost = await resolveIsPlatformSoftwareOwner(actor);

  const parkScope = await resolveEffectiveParkScope(actor);
  if (parkScope.parkLocked) {
    throw new ForbiddenError(
      "Park-locked admins cannot reactivate venues — ask a company admin"
    );
  }

  // Fast-fail entitlement/cap before opening a write tx (same as create).
  // Idempotent active path still re-checks inside the venue lock.
  if (existing.status !== "active" && !ownerHost) {
    await assertWithinPlanLimit(orgId, "venues");
  }

  const runReactivate = async (): Promise<VenueLocation> => {
    return prisma.$transaction(
      async (tx) => {
        // Venue first — same order as archiveVenueLocation / HQ location-context.
        const lockedVenue = await tx.$queryRaw<
          { id: string; status: string }[]
        >`
          SELECT id, status::text AS status
          FROM venue_locations
          WHERE id = ${existing.id} AND "orgId" = ${orgId}
          FOR UPDATE
        `;
        if (!lockedVenue.length) {
          throw new ForbiddenError(VENUE_NOT_FOUND);
        }

        const current = await tx.venueLocation.findFirst({
          where: { id: existing.id, orgId },
        });
        if (!current) {
          throw new ForbiddenError(VENUE_NOT_FOUND);
        }

        // Concurrent reactivate / retry / already-active — do not burn quota.
        if (current.status === "active") {
          if (current.archivedAt == null) return current;
          return tx.venueLocation.update({
            where: { id: current.id },
            data: { archivedAt: null },
          });
        }

        const lockedOrg = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE
        `;
        if (!lockedOrg.length) {
          throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, orgId);
        }

        const orgRow = await tx.organization.findUnique({
          where: { id: orgId },
          select: {
            status: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            subscriptionPlan: true,
          },
        });
        if (!orgRow) {
          throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, orgId);
        }
        if (
          !ownerHost &&
          !isCompanyBillingCreateEntitled({
            subscriptionStatus: orgRow.subscriptionStatus,
            subscriptionEndsAt: orgRow.subscriptionEndsAt,
            orgStatus: orgRow.status,
          })
        ) {
          throw new ForbiddenError(BILLING_REQUIRED_MESSAGE);
        }
        if (!ownerHost) {
          const rawPlan =
            orgRow.subscriptionPlan?.trim().toLowerCase() || null;
          const planResolved =
            rawPlan && isSubscriptionPlanId(rawPlan) ? rawPlan : "starter";
          const cap = getPlanLimits(planResolved).venues;
          if (cap != null) {
            const used = await tx.venueLocation.count({
              where: { orgId, status: "active" },
            });
            if (used + 1 > cap) {
              throw new ForbiddenError(
                planLimitReachedMessage("venues", planResolved)
              );
            }
          }
        }
        return tx.venueLocation.update({
          where: { id: current.id },
          data: {
            status: "active",
            archivedAt: null,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000,
      }
    );
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await runReactivate();
      clearCachedLocationScopesForOrg(orgId);
      // Step 3: clear archive fail-closed on park Connect (re-sync Stripe when possible).
      if (row.isFranchise) {
        try {
          const { restoreParkMarketplaceAccountAfterReactivate } = await import(
            "@/lib/marketplace/parkAccount"
          );
          await restoreParkMarketplaceAccountAfterReactivate(row.id);
        } catch (restoreErr) {
          console.warn(
            "[reactivateVenueLocation] park Connect restore failed:",
            restoreErr instanceof Error ? restoreErr.message : restoreErr
          );
        }
      }
      return toVenueLocationDto(row);
    } catch (err) {
      lastErr = err;
      if (err instanceof ForbiddenError) throw err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "P2034" && attempt < 2) continue;
      if (isTransientDbError(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to reactivate venue location");
}

export function parseUpdateVenueLocationBody(
  body: unknown
): UpdateVenueLocationInput {
  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (() => {
          const o = body as Record<string, unknown>;
          if ("id" in o || "status" in o || "archivedAt" in o) {
            throw new Error(VENUE_PRIVILEGED_FIELD);
          }
          const { orgId: _ignored, ...rest } = o;
          return rest;
        })()
      : body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid JSON");
  }
  const o = raw as Record<string, unknown>;
  const out: UpdateVenueLocationInput = {};
  if ("name" in o) out.name = typeof o.name === "string" ? o.name : "";
  if ("slug" in o) out.slug = typeof o.slug === "string" ? o.slug : undefined;
  if ("addressLine1" in o) {
    out.addressLine1 =
      typeof o.addressLine1 === "string" ? o.addressLine1 : null;
  }
  if ("addressLine2" in o) {
    out.addressLine2 =
      typeof o.addressLine2 === "string" ? o.addressLine2 : null;
  }
  if ("city" in o) out.city = typeof o.city === "string" ? o.city : null;
  if ("region" in o) out.region = typeof o.region === "string" ? o.region : null;
  if ("postalCode" in o) {
    out.postalCode = typeof o.postalCode === "string" ? o.postalCode : null;
  }
  if ("country" in o) {
    out.country = typeof o.country === "string" ? o.country : null;
  }
  if ("timezone" in o) {
    out.timezone = typeof o.timezone === "string" ? o.timezone : null;
  }
  if ("publicBookingEnabled" in o) {
    out.publicBookingEnabled = Boolean(o.publicBookingEnabled);
  }
  if ("isFranchise" in o) {
    out.isFranchise = Boolean(o.isFranchise);
  }
  if ("franchiseDisplayName" in o) {
    out.franchiseDisplayName =
      typeof o.franchiseDisplayName === "string"
        ? o.franchiseDisplayName
        : null;
  }
  if ("franchiseSupportPhone" in o) {
    out.franchiseSupportPhone =
      typeof o.franchiseSupportPhone === "string"
        ? o.franchiseSupportPhone
        : null;
  }
  if ("franchiseSupportEmail" in o) {
    out.franchiseSupportEmail =
      typeof o.franchiseSupportEmail === "string"
        ? o.franchiseSupportEmail
        : null;
  }
  if ("franchiseCode" in o) {
    out.franchiseCode =
      typeof o.franchiseCode === "string" ? o.franchiseCode : null;
  }
  if ("franchiseNotes" in o) {
    out.franchiseNotes =
      typeof o.franchiseNotes === "string" ? o.franchiseNotes : null;
  }
  return out;
}
