export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import CompanyBookProduct from '@/components/Public_C/companySite/CompanyBookProduct';
import { companySiteMetadata } from '@/lib/publicCategory/companySitePage';

type Params = Promise<{ orgSlug: string; categorySlug: string; productId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, categorySlug } = await params;
  return companySiteMetadata(orgSlug, categorySlug);
}

export default async function CompanyProductPage({ params }: { params: Params }) {
  return <CompanyBookProduct params={params} />;
}
