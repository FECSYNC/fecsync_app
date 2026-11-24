export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import {
  CompanyBookingGrid,
  CompanyMembershipGrid,
  CompanyMenuGrid,
} from '@/components/Public_C/companySite/CompanyCategoryGrids';
import {
  companySiteMetadata,
  isCompanyEmbedRequest,
  requireCompanySite,
} from '@/lib/publicCategory/companySitePage';
import {
  listCompanyBookingCards,
  listCompanyMembershipCards,
  listCompanyMenuItems,
} from '@/lib/publicCategory/resolve';
import { companySitePaths } from '@/lib/publicCategory/sitePaths';

type Params = Promise<{ orgSlug: string; categorySlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, categorySlug } = await params;
  return companySiteMetadata(orgSlug, categorySlug, { index: true });
}

export default async function CompanyCategoryPage({ params }: { params: Params }) {
  const site = await requireCompanySite(params);
  if (!site) return null;
  const layout = site.page.layout;
  const embed = await isCompanyEmbedRequest();

  let body: React.ReactNode;
  if (site.page.kind === 'booking') {
    const cards = await listCompanyBookingCards(site);
    body = (
      <CompanyBookingGrid
        cards={cards}
        layout={layout}
        paths={companySitePaths(site.org.slug, site.page.slug, { embed })}
      />
    );
  } else if (site.page.kind === 'menu') {
    body = <CompanyMenuGrid items={await listCompanyMenuItems(site)} layout={layout} />;
  } else {
    body = (
      <CompanyMembershipGrid
        cards={await listCompanyMembershipCards(site)}
        layout={layout}
      />
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold text-stone-900">{site.category.name}</h1>
        {site.category.description ? (
          <p className="mt-2 max-w-2xl text-sm text-stone-600">
            {site.category.description}
          </p>
        ) : null}
      </div>
      {body}
    </main>
  );
}
