export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import CompanySiteHeader from '@/components/Public_C/companySite/CompanySiteHeader';
import CompanyEmbedFrame from '@/components/Public_C/companySite/CompanyEmbedFrame';
import {
  isCompanyEmbedRequest,
  loadCompanySite,
} from '@/lib/publicCategory/companySitePage';
import { companySitePaths } from '@/lib/publicCategory/sitePaths';

export default async function CompanyCategoryLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug: string; categorySlug: string }>;
}) {
  const { orgSlug, categorySlug } = await params;
  const load = await loadCompanySite(orgSlug, categorySlug);
  if (load.status === 'missing') notFound();
  if (load.status === 'throttled') {
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">Too many requests</h1>
        <p className="mt-2 text-sm text-stone-600">Please wait a moment and try again.</p>
      </main>
    );
  }
  const { site } = load;
  const embed = await isCompanyEmbedRequest();
  if (embed && !site.page.embedEnabled) notFound();
  return (
    <div data-company-embed={embed ? '1' : undefined}>
      {embed ? <CompanyEmbedFrame /> : null}
      <CompanySiteHeader
        header={site.header}
        homeHref={companySitePaths(site.org.slug, site.page.slug, { embed }).home}
      />
      {children}
    </div>
  );
}
