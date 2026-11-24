/**
 * Resolve Product.venueLocationId for staff create/update.
 * Never trusts client orgId. Park-locked must stamp an assigned park.
 * Company-wide may leave null (company-shared) or stamp an org venue.
 */
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import prisma from "@/lib/prisma";
import {
  PARK_OUTSIDE_ASSIGNMENT,
  resolveEffectiveParkScope,
  type ParkAdminActor,
} from "@/lib/parkAdminScope";

export async function resolveProductVenueLocationIdForWrite(
  actor: ParkAdminActor,
  orgId: string,
  raw: unknown,
  opts?: { requiredForParkLocked?: boolean }
): Promise<string | null | undefined> {
  // undefined = leave unchanged (update); null = clear / shared
  if (raw === undefined) {
    const scope = await resolveEffectiveParkScope(actor);
    if (scope.parkLocked) {
      if (opts?.requiredForParkLocked !== false) {
        // Prefer selected park; if somehow empty-locked, refuse null stamp.
        const stamp =
          scope.locationId ?? scope.assignedLocationIds[0] ?? null;
        if (!stamp) {
          throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
        }
        return stamp;
      }
    }
    return undefined;
  }

  const scope = await resolveEffectiveParkScope(actor);

  if (raw === null || raw === "") {
    if (scope.parkLocked) {
      throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
    }
    return null;
  }

  if (typeof raw !== "string" || !isValidId(raw)) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }

  const venue = await prisma.venueLocation.findFirst({
    where: { id: raw, orgId, status: "active" },
    select: { id: true },
  });
  if (!venue) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }

  if (scope.parkLocked && !scope.assignedLocationIds.includes(venue.id)) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }

  return venue.id;
}

/** Assert staff may see/mutate a product row under park scope. */
export async function assertProductVenueAccess(
  actor: ParkAdminActor,
  product: { venueLocationId?: string | null }
): Promise<void> {
  const scope = await resolveEffectiveParkScope(actor);
  if (!scope.parkLocked) return;
  if (
    !product.venueLocationId ||
    !scope.assignedLocationIds.includes(product.venueLocationId)
  ) {
    throw new ForbiddenError(PARK_OUTSIDE_ASSIGNMENT);
  }
}
