'use client';

import { MapPin } from 'lucide-react';
import CatalogImage from '@/components/common/CatalogImage';
import BookTailorCta from '@/components/Public_C/tailors/BookTailorCta';
import type { PublicTailorDto } from '@/lib/tailors.shared';

type TailorProfileHeroProps = {
  tailor: PublicTailorDto;
};

function locationLabel(tailor: PublicTailorDto): string {
  return [tailor.location.city, tailor.location.state, tailor.location.country]
    .filter(Boolean)
    .join(', ');
}

export default function TailorProfileHero({ tailor }: TailorProfileHeroProps) {
  const cover = tailor.portfolioImages[0] || '/placeholder.png';
  const place = locationLabel(tailor);

  return (
    <section className="relative overflow-hidden bg-gray-900 text-white">
      <div className="absolute inset-0">
        <CatalogImage
          src={cover}
          alt=""
          fill
          optimizeWidth={1600}
          sizes="100vw"
          className="object-cover opacity-40"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/65 to-black/40" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 pt-28 pb-16 sm:pt-32 sm:pb-20">
        <p className="text-sm font-medium tracking-wide text-[#FFE181] mb-3">
          Find a Tailor
        </p>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold max-w-3xl">
          {tailor.displayName}
        </h1>
        {place ? (
          <p className="mt-4 inline-flex items-center gap-2 text-gray-200">
            <MapPin size={16} aria-hidden />
            {place}
          </p>
        ) : null}
        {(tailor.reviewCount ?? 0) > 0 ? (
          <p className="mt-3 text-sm text-[#FFE181]">
            ★ {tailor.avgRating?.toFixed(1) ?? '—'} · {tailor.reviewCount}{' '}
            review{(tailor.reviewCount ?? 0) === 1 ? '' : 's'}
          </p>
        ) : null}
        {tailor.bio ? (
          <p className="mt-5 max-w-2xl text-base sm:text-lg text-gray-200 leading-relaxed">
            {tailor.bio}
          </p>
        ) : null}
        {tailor.specialties.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {tailor.specialties.map((spec) => (
              <span
                key={spec}
                className="rounded-full bg-white/10 ring-1 ring-white/20 px-3 py-1 text-sm"
              >
                {spec}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-8">
          <BookTailorCta slug={tailor.slug} />
        </div>
      </div>
    </section>
  );
}
