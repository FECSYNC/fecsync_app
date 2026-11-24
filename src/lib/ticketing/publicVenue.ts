/**
 * Public venue resolution for guest booking.
 * Guest URLs are `/book/{venueSlug}` (no company slug). APIs may still pass
 * orgSlug+venueSlug after the page resolves the venue.
 * JWT orgId is never write authority — bind to published venue only.
 */
import prisma from "@/lib/prisma";
import { TicketingError, PUBLIC_VENUE_NOT_PUBLISHED } from "@/lib/ticketing/errors";

const orgPublicSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  isDefault: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
} as const;

/**
 * Preferred public entry: venue slug alone.
 * If several published venues share a slug, prefer a non-storefront org;
 * if still ambiguous, 404 (use a more unique venue slug).
 */
export async function resolvePublicBookingVenueBySlug(venueSlug: string) {
  const slug = venueSlug.trim().toLowerCase();
  if (!slug) {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }

  const matches = await prisma.venueLocation.findMany({
    where: {
      slug,
      status: "active",
      publicBookingEnabled: true,
      org: { status: "active" },
    },
    include: { org: { select: orgPublicSelect } },
    take: 8,
  });
  if (matches.length === 0) {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }

  let venue = matches.length === 1 ? matches[0] : null;
  if (!venue) {
    const nonDefault = matches.filter((m) => !m.org.isDefault);
    venue = nonDefault.length === 1 ? nonDefault[0] : null;
  }
  if (!venue) {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }

  return { org: venue.org, venue };
}

export async function resolvePublicBookingVenue(
  orgSlug: string,
  venueSlug: string
) {
  const org = await prisma.organization.findFirst({
    where: { slug: orgSlug.trim().toLowerCase() },
    select: orgPublicSelect,
  });
  if (!org || org.status !== "active") {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }

  const venue = await prisma.venueLocation.findFirst({
    where: {
      orgId: org.id,
      slug: venueSlug.trim().toLowerCase(),
      status: "active",
      publicBookingEnabled: true,
    },
  });
  if (!venue) {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }

  return { org, venue };
}

export function toPublicVenueDto(
  org: { id: string; slug: string; name: string },
  venue: {
    id: string;
    slug: string;
    name: string;
    addressLine1: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    timezone: string | null;
  }
) {
  return {
    orgSlug: org.slug,
    orgName: org.name,
    venueId: venue.id,
    venueSlug: venue.slug,
    name: venue.name,
    addressLine1: venue.addressLine1,
    city: venue.city,
    region: venue.region,
    country: venue.country,
    timezone: venue.timezone,
  };
}
