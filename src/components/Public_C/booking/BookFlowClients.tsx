'use client';

import dynamic from 'next/dynamic';
import type { CompanyBookContext } from '@/lib/ticketing/publicBookPaths';

const ProductBookPage = dynamic(
  () => import('@/components/Public_C/booking/ProductBookPage'),
  {
    ssr: false,
    loading: () => (
      <p className="p-8 text-sm text-stone-500">Loading…</p>
    ),
  }
);

const PublicPartyBookPage = dynamic(
  () => import('@/components/Public_C/booking/party/PublicPartyBookPage'),
  {
    ssr: false,
    loading: () => (
      <p className="p-8 text-sm text-stone-500">Loading…</p>
    ),
  }
);

const CheckoutPage = dynamic(
  () => import('@/components/Public_C/booking/CheckoutPage'),
  {
    ssr: false,
    loading: () => (
      <p className="p-8 text-sm text-stone-500">Loading checkout…</p>
    ),
  }
);

export function BookProductClient(props: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  partyMode?: boolean;
  company?: CompanyBookContext;
  allowedProductIds?: string[];
}) {
  if (props.partyMode) {
    // Company category pages already gate the product to the category server-side.
    return (
      <PublicPartyBookPage
        orgSlug={props.orgSlug}
        venueSlug={props.venueSlug}
        productId={props.productId}
        company={props.company}
      />
    );
  }
  return <ProductBookPage {...props} />;
}

export function BookCheckoutClient(props: {
  orgSlug: string;
  venueSlug: string;
  company?: CompanyBookContext;
}) {
  return <CheckoutPage {...props} />;
}
