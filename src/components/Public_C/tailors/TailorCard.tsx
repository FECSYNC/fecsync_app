'use client';

import Link from 'next/link';
import { MapPin } from 'lucide-react';
import CatalogImage from '@/components/common/CatalogImage';
import type { PublicTailorDto } from '@/lib/tailors.shared';

type TailorCardProps = {
  tailor: PublicTailorDto;
};

function locationLabel(tailor: PublicTailorDto): string {
  return [tailor.location.city, tailor.location.state, tailor.location.country]
    .filter(Boolean)
    .join(', ');
}

export default function TailorCard({ tailor }: TailorCardProps) {
  const cover = tailor.portfolioImages[0] || '/placeholder.png';
  const place = locationLabel(tailor);

  return (
    <Link
      href={`/tailors/${encodeURIComponent(tailor.slug)}`}
      prefetch={false}
      className="group block bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-xl ring-1 ring-transparent hover:ring-[#D4AF37]/30 transition-all duration-300"
    >
      <div className="relative h-48 sm:h-52 overflow-hidden bg-gray-100">
        <CatalogImage
          src={cover}
          alt={tailor.displayName}
          fill
          optimizeWidth={480}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-80" />
        {place ? (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-black/55 text-white text-xs font-medium px-2.5 py-1">
            <MapPin size={12} aria-hidden />
            {place}
          </span>
        ) : null}
      </div>
      <div className="p-4 sm:p-5">
        <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#B8960C] transition-colors line-clamp-1">
          {tailor.displayName}
        </h3>
        {tailor.bio ? (
          <p className="mt-1.5 text-sm text-gray-600 line-clamp-2">{tailor.bio}</p>
        ) : null}
        {tailor.specialties.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tailor.specialties.slice(0, 3).map((spec) => (
              <span
                key={spec}
                className="rounded-full bg-[#FFF8E7] text-[#8A6D00] text-xs font-medium px-2.5 py-0.5"
              >
                {spec}
              </span>
            ))}
            {tailor.specialties.length > 3 ? (
              <span className="text-xs text-gray-500 self-center">
                +{tailor.specialties.length - 3}
              </span>
            ) : null}
          </div>
        ) : tailor.serviceTypes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tailor.serviceTypes.slice(0, 2).map((t) => (
              <span
                key={t}
                className="rounded-full bg-stone-100 text-stone-700 text-xs font-medium px-2.5 py-0.5"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
        {(tailor.reviewCount ?? 0) > 0 ? (
          <p className="mt-2 text-xs font-medium text-[#B8960C]">
            ★ {tailor.avgRating?.toFixed(1) ?? '—'} · {tailor.reviewCount}{' '}
            review{(tailor.reviewCount ?? 0) === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
