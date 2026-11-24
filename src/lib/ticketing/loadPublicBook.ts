import { notFound } from "next/navigation";
import {
  resolvePublicBookingVenue,
  resolvePublicBookingVenueBySlug,
} from "@/lib/ticketing/publicVenue";
import { isTicketingError } from "@/lib/ticketing/errors";

async function catchNotPublished<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isTicketingError(e) && e.status === 404) notFound();
    throw e;
  }
}

/** Resolve `/book/{venueSlug}` — preferred guest URL (no company slug). */
export async function loadPublicBookByVenueSlug(venueSlug: string) {
  // Guard empty / reserved path segments that would otherwise 404 the page.
  const slug = String(venueSlug || "")
    .trim()
    .toLowerCase();
  if (!slug || slug === "checkout" || slug === "p" || slug === "party") {
    notFound();
  }
  return catchNotPublished(() => resolvePublicBookingVenueBySlug(slug));
}

/** Resolve legacy `/book/{orgSlug}/{venueSlug}` for redirects / APIs. */
export function loadPublicBookByOrgVenue(orgSlug: string, venueSlug: string) {
  return catchNotPublished(() =>
    resolvePublicBookingVenue(orgSlug, venueSlug)
  );
}
