/**
 * Shared Digital Waivers staff gates + venue ownership.
 * Park-lock / HQ preference mirrors memberships/common.ts.
 */
import { Prisma } from "@prisma/client";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import {
  actorLocationScope,
  type ActorLocationScopeActor,
} from "@/lib/actorLocationScope";
import {
  assignedLocationFilter,
  resolveEffectiveParkScope,
} from "@/lib/parkAdminScope";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";

export type WaiversActor = ActorLocationScopeActor & {
  orgId?: string | null;
  sub?: string;
};

export const LOCATION_REQUIRED = "Venue location is required";
export const LOCATION_NOT_FOUND = "Venue location not found";
export const LOCATION_ARCHIVED =
  "This venue is archived — choose an active venue";
export const LOCATION_OUT_OF_SCOPE = "Outside your park assignment";
export const PRIVILEGED_ORG_FIELD =
  "orgId cannot be set from the client — it is taken from your session";

export const DOCUMENT_KINDS = [
  "liability_waiver",
  "membership_contract",
  "booking_agreement",
] as const;

export const FORM_KINDS = [
  "custom_form",
  "inquiry",
  "event_form",
  "product_addon_form",
] as const;

export async function assertWaiversStaff(actor: WaiversActor): Promise<string> {
  const orgId = requireActorOrgId(actor);
  await assertWaiversEnabled(orgId);
  return orgId;
}

/** Unique-constraint races become a normal validation error instead of a 500. */
export function rethrowUniqueConflict(err: unknown, message: string): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new Error(message);
  }
  throw err;
}

export function rejectClientOrgFields(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const rec = body as Record<string, unknown>;
  if ("orgId" in rec || "organizationId" in rec) {
    throw new ForbiddenError(PRIVILEGED_ORG_FIELD);
  }
}

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

export async function assertLocationInWaiverScope(
  actor: WaiversActor,
  locationId: string | null | undefined
): Promise<void> {
  const full = await actorLocationScope(actor);
  if (full.parkLocked) {
    // Org-default rows (null) are readable. Mutations use assertMutableWaiverLocation.
    if (locationId == null || locationId === "") return;
    if (!full.assignedLocationIds.includes(locationId)) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    if (full.locationId && locationId !== full.locationId) {
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

/** Park-assigned seats cannot create or edit company-wide (locationId null) rows. */
export async function assertMutableWaiverLocation(
  actor: WaiversActor,
  locationId: string | null | undefined
): Promise<void> {
  const full = await actorLocationScope(actor);
  if (full.parkLocked && (locationId == null || locationId === "")) {
    throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
  }
  await assertLocationInWaiverScope(actor, locationId);
}

export async function requireActorVenueInScope(
  actor: WaiversActor,
  locationId: string,
  opts?: { allowArchived?: boolean }
) {
  const orgId = requireActorOrgId(actor);
  const venue = await requireActorVenue(orgId, locationId, opts);
  await assertLocationInWaiverScope(actor, locationId);
  return venue;
}

/**
 * Park-lock / HQ scope for lists. Org-default rows (locationId null) stay
 * visible so a park can use company-wide templates and settings.
 * Intentionally NOT assignedLocationFilter alone — stamped rows use
 * waiverStampedLocationWhere (SSOT assignedLocationFilter).
 */
export async function waiverListLocationWhere(
  actor: WaiversActor
): Promise<{ locationId?: string | { in: string[] } | null; OR?: object[] }> {
  const scope = await actorLocationScope(actor);
  if (scope.parkLocked) {
    const ids = scope.locationId
      ? [scope.locationId]
      : (scope.assignedLocationIds ?? []);
    return {
      OR: [{ locationId: null }, { locationId: { in: ids } }],
    };
  }
  if (scope.locationScoped && scope.locationId) {
    return {
      OR: [{ locationId: null }, { locationId: scope.locationId }],
    };
  }
  return {};
}

/** Strict park filter for rows that always stamp locationId (kiosk, records). */
export async function waiverStampedLocationWhere(
  actor: WaiversActor
): Promise<{ locationId?: string | { in: string[] } }> {
  const scope = await resolveEffectiveParkScope(actor);
  return assignedLocationFilter(scope, "locationId") as {
    locationId?: string | { in: string[] };
  };
}

export function slugifyWaiverName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "waiver";
}
