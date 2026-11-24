import { redirect } from 'next/navigation';
import { publicBookCheckoutPath } from '@/lib/ticketing/publicBookPaths';
import { loadPublicBookByOrgVenue } from '@/lib/ticketing/loadPublicBook';

/** Legacy `/book/{org}/{venue}/checkout` → `/book/{venue}/checkout`. */
export default async function LegacyBookCheckoutRedirect({
  params,
}: {
  params: Promise<{ venueSlug: string; legacyVenue: string }>;
}) {
  const { venueSlug: orgSlug, legacyVenue } = await params;
  const { venue } = await loadPublicBookByOrgVenue(orgSlug, legacyVenue);
  redirect(publicBookCheckoutPath(venue.slug));
}
