'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import TailorCard from '@/components/Public_C/tailors/TailorCard';
import TailorFilters, {
  type TailorFilterValues,
} from '@/components/Public_C/tailors/TailorFilters';
import { usePublicTailorsQuery } from '@/hooks/useTailors';

const EMPTY_FILTERS: TailorFilterValues = {
  country: '',
  city: '',
  q: '',
  specialty: '',
};

function hasActiveFilters(filters: TailorFilterValues): boolean {
  return Boolean(
    filters.country.trim() ||
      filters.city.trim() ||
      filters.q.trim() ||
      filters.specialty.trim()
  );
}

export default function TailorsListingClient() {
  const [draft, setDraft] = useState<TailorFilterValues>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<TailorFilterValues>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const limit = 16;

  const { data, isLoading, isFetching, isError } = usePublicTailorsQuery({
    q: applied.q || undefined,
    specialty: applied.specialty || undefined,
    country: applied.country || undefined,
    city: applied.city || undefined,
    page,
    limit,
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const filtering = hasActiveFilters(applied);

  useEffect(() => {
    if (data && data.page !== page && data.page >= 1) {
      setPage(data.page);
    }
  }, [data, page]);

  const applyFilters = () => {
    setApplied({ ...draft });
    setPage(1);
  };

  const handleFilterChange = (next: TailorFilterValues) => {
    setDraft(next);
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const resultLabel = () => {
    if (isLoading) return 'Loading tailors…';
    if (total === 0) {
      return filtering ? 'No matching tailors' : 'No approved tailors yet';
    }
    const base = `${total} tailor${total === 1 ? '' : 's'}`;
    if (!filtering) return `${base} available`;
    const place = [applied.country, applied.city].filter(Boolean).join(' · ');
    return place ? `${base} · ${place}` : base;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm pt-24">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
              Find a tailor
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Browse approved makers for bridal, menswear, alterations, and
              bespoke pieces. Filter by country or city when you want someone
              nearby.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <TailorFilters
          values={draft}
          onChange={handleFilterChange}
          onSubmit={applyFilters}
          onClear={filtering || hasActiveFilters(draft) ? clearFilters : undefined}
        />

        <div className="flex items-center justify-between gap-3 text-sm text-gray-600">
          <p>{resultLabel()}</p>
          {isFetching && !isLoading ? (
            <span className="inline-flex items-center gap-1.5 text-gray-500">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Updating
            </span>
          ) : null}
        </div>

        {isError ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
            <p className="text-gray-700 font-medium">
              We couldn&apos;t load tailors right now.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Please refresh the page and try again.
            </p>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-80 rounded-2xl bg-white shadow-sm animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">
              {filtering ? 'No matching tailors' : 'No approved tailors yet'}
            </h2>
            <p className="mt-2 text-gray-600 max-w-md mx-auto">
              {filtering
                ? 'Try a different country, city, or specialty — or clear filters to see everyone.'
                : 'Check back soon. New makers appear here once they are approved.'}
            </p>
            {filtering ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 inline-flex rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030] transition"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {items.map((tailor) => (
              <TailorCard key={tailor.slug} tailor={tailor} />
            ))}
          </div>
        )}

        {totalPages > 1 && !isError ? (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
