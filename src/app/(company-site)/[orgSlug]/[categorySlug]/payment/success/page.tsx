export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { Metadata } from 'next';
import {
  companySiteMetadata,
  isCompanyEmbedRequest,
  requireCompanySite,
} from '@/lib/publicCategory/companySitePage';
import {
  confirmCompanyCheckoutSession,
  type CompanyPaymentStatus,
} from '@/lib/publicCategory/companyCheckout';
import { companySitePaths } from '@/lib/publicCategory/sitePaths';

type Params = Promise<{ orgSlug: string; categorySlug: string }>;
type SearchParams = Promise<{ session_id?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, categorySlug } = await params;
  return companySiteMetadata(orgSlug, categorySlug);
}

const COPY: Record<CompanyPaymentStatus, { title: string; body: string }> = {
  ok: {
    title: 'Payment received',
    body: 'Your booking is confirmed. Check your email for confirmation and tickets.',
  },
  pending: {
    title: 'Payment pending',
    body: 'Your payment is still being confirmed. Refresh in a moment or check your email.',
  },
  needs_refund: {
    title: 'Payment received — booking inactive',
    body: 'Your card was charged, but the seats were no longer available. The venue will refund you or get in touch.',
  },
  error: {
    title: 'Payment issue',
    body: 'We could not finish confirming this payment. Check your email or contact the venue.',
  },
  missing: {
    title: 'Payment not found',
    body: 'We could not find this payment. If you completed checkout, check your email for confirmation.',
  },
};

export default async function CompanyPaymentSuccessPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const site = await requireCompanySite(params, 'booking');
  if (!site) return null;
  const sp = await searchParams;
  const sessionId = typeof sp.session_id === 'string' ? sp.session_id : '';
  const result = await confirmCompanyCheckoutSession({
    orgId: site.org.id,
    sessionId,
  });
  const copy = COPY[result.status];
  const embed = await isCompanyEmbedRequest();
  return (
    <main className="mx-auto max-w-xl space-y-3 px-4 py-12">
      <h1 className="text-2xl font-semibold text-stone-900">{copy.title}</h1>
      <p className="text-sm text-stone-600">{copy.body}</p>
      {result.booking ? (
        <p className="text-sm text-stone-700">
          Reference <span className="font-mono font-semibold">{result.booking.publicId}</span>
        </p>
      ) : null}
      <a
        href={companySitePaths(site.org.slug, site.page.slug, { embed }).home}
        className="inline-block text-sm font-medium text-[#D4AF37] hover:underline"
      >
        ← Back to {site.category.name}
      </a>
    </main>
  );
}
