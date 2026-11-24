'use client';

import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import TailorProfileHero from '@/components/Public_C/tailors/TailorProfileHero';
import TailorPortfolioGrid from '@/components/Public_C/tailors/TailorPortfolioGrid';
import BookTailorCta from '@/components/Public_C/tailors/BookTailorCta';
import {
  usePublicTailorQuery,
  usePublicTailorReviewsQuery,
} from '@/hooks/useTailors';
import type { PublicTailorDto } from '@/lib/tailors.shared';
import { formatPrice } from '@/utils/currency';

type TailorProfileClientProps = {
  slug: string;
  /** Server-resolved profile — avoids duplicate fetch on first paint. */
  initialTailor?: PublicTailorDto;
};

function formatTierPrice(priceFrom?: number, currency?: string): string | null {
  if (typeof priceFrom !== 'number' || Number.isNaN(priceFrom)) return null;
  if (currency && currency.toUpperCase() !== 'NGN') {
    return `${currency} ${priceFrom.toLocaleString()}`;
  }
  return formatPrice(priceFrom);
}

export default function TailorProfileClient({
  slug,
  initialTailor,
}: TailorProfileClientProps) {
  const { data: tailor, isLoading, isError } = usePublicTailorQuery(
    slug,
    true,
    initialTailor
  );
  const { data: reviewsData, isLoading: reviewsLoading } =
    usePublicTailorReviewsQuery(slug, Boolean(tailor));
  const reviews = reviewsData?.reviews ?? [];

  if (isLoading && !tailor) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center pt-24">
        <Loader2 className="animate-spin text-[#D4AF37]" size={28} />
      </div>
    );
  }

  if (isError || !tailor) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center pt-24 px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-900">Tailor not found</h1>
          <p className="mt-2 text-gray-600">
            This profile is unavailable or no longer listed.
          </p>
          <Link
            href="/tailors"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030]"
          >
            Browse all tailors
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      <TailorProfileHero tailor={tailor} />

      <div className="max-w-7xl mx-auto px-6 py-12 space-y-12">
        <section>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Portfolio</h2>
          <TailorPortfolioGrid
            images={tailor.portfolioImages}
            displayName={tailor.displayName}
          />
        </section>

        {(tailor.serviceTypes.length > 0 ||
          tailor.serviceTiers.length > 0 ||
          tailor.pricingNotes) && (
          <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Services &amp; pricing
            </h2>
            {tailor.serviceTypes.length > 0 ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {tailor.serviceTypes.map((type) => (
                  <span
                    key={type}
                    className="rounded-full bg-[#FFF8E7] text-[#8A6D00] text-sm font-medium px-3 py-1"
                  >
                    {type}
                  </span>
                ))}
              </div>
            ) : null}

            {tailor.serviceTiers.length > 0 ? (
              <ul className="space-y-4">
                {tailor.serviceTiers.map((tier) => {
                  const price = formatTierPrice(tier.priceFrom, tier.currency);
                  return (
                    <li
                      key={`${tier.name}-${tier.priceFrom ?? ''}`}
                      className="border-b border-gray-100 pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-semibold text-gray-900">
                          {tier.name}
                        </h3>
                        {price ? (
                          <span className="text-sm font-medium text-[#B8960C]">
                            from {price}
                          </span>
                        ) : null}
                      </div>
                      {tier.description ? (
                        <p className="mt-1 text-sm text-gray-600">
                          {tier.description}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {tailor.pricingNotes ? (
              <p className="mt-5 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {tailor.pricingNotes}
              </p>
            ) : null}
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Reviews</h2>
          {reviewsLoading ? (
            <Loader2 className="animate-spin text-[#D4AF37]" size={22} />
          ) : reviews.length === 0 ? (
            <p className="text-sm text-gray-600">No reviews yet.</p>
          ) : (
            <ul className="space-y-4">
              {reviews.map((r) => (
                <li
                  key={r._id}
                  className="border-b border-gray-100 pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-[#B8960C]">
                      {'★'.repeat(Math.round(r.rating))}
                    </span>
                    <span className="text-gray-800">
                      {r.authorName || 'Customer'}
                    </span>
                    {r.createdAt ? (
                      <span className="text-xs text-gray-400">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                  {r.comment ? (
                    <p className="mt-1 text-sm text-gray-600">{r.comment}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap gap-3">
          <BookTailorCta slug={tailor.slug} />
          <Link
            href="/tailors"
            className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Back to all tailors
          </Link>
        </div>
      </div>
    </div>
  );
}
