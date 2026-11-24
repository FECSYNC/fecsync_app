import BookMarketplacePackageClient from '@/components/Public_C/marketplace/BookMarketplacePackageClient';
import { redirect, notFound } from 'next/navigation';
import { publicBookHomePath } from '@/lib/ticketing/publicBookPaths';
import { loadPublicBookByOrgVenue } from '@/lib/ticketing/loadPublicBook';
import { getPublishedBookingPackagePublic } from '@/lib/marketplace/bookingCheckout';
import { isAuthHttpError } from '@/lib/auth/http-error';

/**
 * Dual-purpose two-segment `/book/{a}/{b}`:
 * 1) Marketplace booking package (`orgSlug` + `packageSlug`)
 * 2) Legacy ticketing `/book/{orgSlug}/{venueSlug}` → redirect to `/book/{venueSlug}`
 *
 * Prefer **venue** when the second segment resolves as a VenueLocation (ticketing
 * continuity). Package create/update also rejects venue slug collisions.
 * Marketplace package lookup runs only after venue miss so a marketplace DB
 * error cannot break legacy org/venue redirects.
 *
 * Do not call redirect() inside try/catch — Next.js redirect throws NEXT_REDIRECT.
 *
 * Next.js cannot host both `book/[venueSlug]` and `book/[orgSlug]/[packageSlug]`
 * as sibling dynamic trees. Param folders stay `[venueSlug]/[legacyVenue]`.
 */
export default async function BookTwoSegmentPage({
  params,
}: {
  params: Promise<{ venueSlug: string; legacyVenue: string }>;
}) {
  const { venueSlug: orgKey, legacyVenue: secondSlug } = await params;

  let venueSlug: string | null = null;
  try {
    const loaded = await loadPublicBookByOrgVenue(orgKey, secondSlug);
    venueSlug = loaded.venue.slug;
  } catch {
    venueSlug = null;
  }
  if (venueSlug) {
    redirect(publicBookHomePath(venueSlug));
  }

  try {
    await getPublishedBookingPackagePublic(orgKey, secondSlug);
    return (
      <BookMarketplacePackageClient orgSlug={orgKey} packageSlug={secondSlug} />
    );
  } catch (err) {
    if (!(isAuthHttpError(err) && (err.status === 403 || err.status === 404))) {
      throw err;
    }
  }

  notFound();
}
