export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import {
  companySiteMetadata,
  isCompanyEmbedRequest,
  requireCompanySite,
} from '@/lib/publicCategory/companySitePage';
import { companySitePaths } from '@/lib/publicCategory/sitePaths';

type Params = Promise<{ orgSlug: string; categorySlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, categorySlug } = await params;
  return companySiteMetadata(orgSlug, categorySlug);
}

/** The card reserve is released by the checkout screen before it navigates here. */
export default async function CompanyPaymentCancelPage({ params }: { params: Params }) {
  const site = await requireCompanySite(params, 'booking');
  if (!site) return null;
  const embed = await isCompanyEmbedRequest();
  return (
    <main className="mx-auto max-w-xl space-y-3 px-4 py-12">
      <h1 className="text-2xl font-semibold text-stone-900">Payment cancelled</h1>
      <p className="text-sm text-stone-600">
        You were not charged. Your seats are released when the hold expires — you can
        start a new booking at any time.
      </p>
      <a
        href={companySitePaths(site.org.slug, site.page.slug, { embed }).home}
        className="inline-block text-sm font-medium text-[#D4AF37] hover:underline"
      >
        ← Back to {site.category.name}
      </a>
    </main>
  );
}
