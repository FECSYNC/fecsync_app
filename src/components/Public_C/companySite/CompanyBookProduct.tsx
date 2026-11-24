import { notFound } from 'next/navigation';
import { BookProductClient } from '@/components/Public_C/booking/BookFlowClients';
import {
  isCompanyEmbedRequest,
  requireCompanySite,
} from '@/lib/publicCategory/companySitePage';
import {
  companyCategoryProductIdsAtVenue,
  findCompanyBookingProduct,
} from '@/lib/publicCategory/resolve';

/** Server gate for /p/ and /party/: product must be in this company's category. */
export default async function CompanyBookProduct({
  params,
  partyMode = false,
}: {
  params: Promise<{ orgSlug: string; categorySlug: string; productId: string }>;
  partyMode?: boolean;
}) {
  const site = await requireCompanySite(params, 'booking');
  if (!site) return null;
  const { productId } = await params;
  const found = await findCompanyBookingProduct(site, productId);
  if (!found) notFound();
  const allowedProductIds = await companyCategoryProductIdsAtVenue(site, found.venue.id);
  return (
    <BookProductClient
      orgSlug={site.org.slug}
      venueSlug={found.venue.slug}
      productId={found.product.id}
      partyMode={partyMode}
      company={{
        orgSlug: site.org.slug,
        categorySlug: site.page.slug,
        embed: await isCompanyEmbedRequest(),
      }}
      allowedProductIds={allowedProductIds}
    />
  );
}
