/**
 * Thin VenueLocation meter + shared venue policy strings — kept separate so
 * planLimits ↔ venueLocations do not form a circular import.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";

/** Storefront / DEFAULT_ORG must never own VenueLocation rows. */
export const VENUE_STOREFRONT_MESSAGE =
  "FECSYNC storefront organization cannot manage venue locations — use a registered company workspace";

/** Active venues that burn the plan `venues` quota (archived do not). */
export async function countActiveVenueLocations(orgId: string): Promise<number> {
  const id = requireId(orgId, "orgId");
  return prisma.venueLocation.count({
    where: { orgId: id, status: "active" },
  });
}
