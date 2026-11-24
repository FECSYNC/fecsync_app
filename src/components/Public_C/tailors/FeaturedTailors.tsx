'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import TailorCard from '@/components/Public_C/tailors/TailorCard';
import { useFeaturedTailorsQuery } from '@/hooks/useTailors';

/** Homepage featured strip — approved storefront tailors only. */
export default function FeaturedTailors() {
  const { data, isLoading } = useFeaturedTailorsQuery(4);
  const items = data?.items ?? [];

  if (!isLoading && items.length === 0) return null;

  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-medium tracking-wide text-[#B8960C] mb-2">
              Find a Tailor
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              Featured makers
            </h2>
            <p className="mt-2 text-gray-600 max-w-xl">
              Browse approved tailors ready for bespoke fittings and alterations.
            </p>
          </div>
          <Link
            href="/tailors"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#B8960C] hover:text-[#8A6D00]"
          >
            View all
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-80 rounded-2xl bg-gray-100 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {items.map((tailor) => (
              <TailorCard key={tailor.slug} tailor={tailor} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
