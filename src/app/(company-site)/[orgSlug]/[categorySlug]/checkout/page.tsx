export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookCheckoutClient } from '@/components/Public_C/booking/BookFlowClients';
import {
  companySiteMetadata,
  isCompanyEmbedRequest,
  requireCompanySite,
} from '@/lib/publicCategory/companySitePage';
import { findCompanyBookingProduct } from '@/lib/publicCategory/resolve';

type Params = Promise<{ orgSlug: string; categorySlug: string }>;
type SearchParams = Promise<{ productId?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, categorySlug } = await params;
  return companySiteMetadata(orgSlug, categorySlug);
}

export default async function CompanyCheckoutPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const site = await requireCompanySite(params, 'booking');
  if (!site) return null;
  const sp = await searchParams;
  const productId = typeof sp.productId === 'string' ? sp.productId : '';
  const found = productId ? await findCompanyBookingProduct(site, productId) : null;
  if (!found) notFound();
  return (
    <BookCheckoutClient
      orgSlug={site.org.slug}
      venueSlug={found.venue.slug}
      company={{
        orgSlug: site.org.slug,
        categorySlug: site.page.slug,
        embed: await isCompanyEmbedRequest(),
      }}
    />
  );
}
