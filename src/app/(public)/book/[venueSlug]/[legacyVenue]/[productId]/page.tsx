import { redirect } from 'next/navigation';
import { publicBookProductPath } from '@/lib/ticketing/publicBookPaths';
import { loadPublicBookByOrgVenue } from '@/lib/ticketing/loadPublicBook';

/** Legacy `/book/{org}/{venue}/{productId}` → `/book/{venue}/p/{productId}`. */
export default async function LegacyBookProductRedirect({
  params,
}: {
  params: Promise<{
    venueSlug: string;
    legacyVenue: string;
    productId: string;
  }>;
}) {
  const { venueSlug: orgSlug, legacyVenue, productId } = await params;
  const { venue } = await loadPublicBookByOrgVenue(orgSlug, legacyVenue);
  redirect(publicBookProductPath(venue.slug, productId));
}
