'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePublicProducts, usePublicVenue } from '@/hooks/usePublicBooking';
import { publicBookProductPath } from '@/lib/ticketing/publicBookPaths';
import BookProductCard from './BookProductCard';
import type { PublicProductDto } from '@/services/publicBooking';

function ProductCard({
  venueSlug,
  p,
  party,
}: {
  venueSlug: string;
  p: PublicProductDto;
  party?: boolean;
}) {
  return (
    <BookProductCard
      href={publicBookProductPath(venueSlug, p.id, Boolean(party))}
      label={p.category?.name ?? (party ? 'Party' : p.type.replace('_', ' '))}
      name={p.name}
      description={p.description}
      priceFrom={p.priceFrom}
      soldOut={p.soldOut}
      party={party}
    />
  );
}

function groupByCategory(items: PublicProductDto[]) {
  const groups = new Map<string, { title: string; items: PublicProductDto[] }>();
  for (const p of items) {
    const key = p.categoryId ?? 'uncategorized';
    const title = p.category?.name ?? 'Other';
    const existing = groups.get(key);
    if (existing) existing.items.push(p);
    else groups.set(key, { title, items: [p] });
  }
  return Array.from(groups.entries())
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => {
      if (a.id === 'uncategorized') return 1;
      if (b.id === 'uncategorized') return -1;
      return a.title.localeCompare(b.title);
    });
}

export default function VenueBookHome({
  orgSlug,
  venueSlug,
}: {
  orgSlug: string;
  venueSlug: string;
}) {
  const venueQ = usePublicVenue(orgSlug, venueSlug);
  const productsQ = usePublicProducts(orgSlug, venueSlug);
  const venue = venueQ.data;
  const products = productsQ.data ?? [];
  const tickets = products.filter((p) => p.type !== 'add_on');
  const parties = tickets.filter((p) => p.type === 'party_package');
  const rest = tickets.filter((p) => p.type !== 'party_package');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of tickets) {
      if (p.category?.id && p.category.name) {
        map.set(p.category.id, p.category.name);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tickets]);

  // If products refetch and the selected chip no longer exists, reset to All.
  useEffect(() => {
    if (categoryFilter === 'all' || categoryFilter === 'uncategorized') return;
    if (!categoryOptions.some((c) => c.id === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryOptions]);

  const filteredRest = useMemo(() => {
    if (categoryFilter === 'all') return rest;
    if (categoryFilter === 'uncategorized') {
      return rest.filter((p) => !p.categoryId);
    }
    return rest.filter((p) => p.categoryId === categoryFilter);
  }, [rest, categoryFilter]);

  const filteredParties = useMemo(() => {
    if (categoryFilter === 'all') return parties;
    if (categoryFilter === 'uncategorized') {
      return parties.filter((p) => !p.categoryId);
    }
    return parties.filter((p) => p.categoryId === categoryFilter);
  }, [parties, categoryFilter]);

  const restGroups = useMemo(
    () =>
      categoryFilter === 'all'
        ? groupByCategory(filteredRest)
        : [
            {
              id: categoryFilter,
              title:
                categoryFilter === 'uncategorized'
                  ? 'Other'
                  : categoryOptions.find((c) => c.id === categoryFilter)?.name ??
                    'Tickets',
              items: filteredRest,
            },
          ].filter((g) => g.items.length > 0),
    [categoryFilter, filteredRest, categoryOptions]
  );

  if (venueQ.isLoading) {
    return <div className="mx-auto max-w-5xl p-8 text-sm text-stone-500">Loading venue…</div>;
  }
  if (!venue) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-semibold">Venue not available</h1>
        <p className="mt-2 text-stone-600">This park is not open for online booking.</p>
      </div>
    );
  }

  const addr = [venue.addressLine1, venue.city, venue.region, venue.country]
    .filter(Boolean)
    .join(', ');

  const hasUncategorized = tickets.some((p) => !p.categoryId);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
          {venue.orgName}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-900">{venue.name}</h1>
        {addr ? <p className="mt-1 text-sm text-stone-600">{addr}</p> : null}
        {venue.timezone ? (
          <p className="text-xs text-stone-500">Times in {venue.timezone}</p>
        ) : null}
        <p className="mt-3 max-w-2xl text-sm text-stone-600">
          Pick a package that fits your day. Availability updates as other guests
          book. Need a larger group, custom time, or something special? Open any
          package and use <span className="font-medium text-stone-800">Request help from the venue</span> — the team is notified in their dashboard and by email.
        </p>
      </header>

      {categoryOptions.length > 0 || hasUncategorized ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              categoryFilter === 'all'
                ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900'
                : 'border-stone-200 text-stone-600 hover:border-stone-300'
            }`}
          >
            All
          </button>
          {categoryOptions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryFilter(c.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                categoryFilter === c.id
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900'
                  : 'border-stone-200 text-stone-600 hover:border-stone-300'
              }`}
            >
              {c.name}
            </button>
          ))}
          {hasUncategorized ? (
            <button
              type="button"
              onClick={() => setCategoryFilter('uncategorized')}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                categoryFilter === 'uncategorized'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900'
                  : 'border-stone-200 text-stone-600 hover:border-stone-300'
              }`}
            >
              Other
            </button>
          ) : null}
        </div>
      ) : null}

      {filteredParties.length ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Party packages</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredParties.map((p) => (
              <ProductCard
                key={p.id}
                venueSlug={venueSlug}
                p={p}
                party
              />
            ))}
          </div>
        </section>
      ) : null}

      {restGroups.length === 0 && filteredParties.length === 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Tickets</h2>
          <p className="text-sm text-stone-500">No published tickets yet.</p>
        </section>
      ) : (
        restGroups.map((group) => (
          <section key={group.id}>
            <h2 className="mb-3 text-lg font-semibold">
              {categoryFilter === 'all' && restGroups.length === 1 && group.id === 'uncategorized'
                ? 'Tickets'
                : group.title}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((p) => (
                <ProductCard
                  key={p.id}
                  venueSlug={venueSlug}
                  p={p}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
