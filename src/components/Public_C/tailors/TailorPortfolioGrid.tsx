'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import CatalogImage from '@/components/common/CatalogImage';

type TailorPortfolioGridProps = {
  images: string[];
  displayName: string;
};

export default function TailorPortfolioGrid({
  images,
  displayName,
}: TailorPortfolioGridProps) {
  const [active, setActive] = useState<string | null>(null);

  if (!images.length) {
    return (
      <p className="text-sm text-gray-500">
        Portfolio images will appear here once this tailor uploads their work.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {images.map((src, index) => (
          <button
            key={`${src}-${index}`}
            type="button"
            onClick={() => setActive(src)}
            className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
          >
            <CatalogImage
              src={src}
              alt={`${displayName} portfolio ${index + 1}`}
              fill
              optimizeWidth={720}
              sizes="(max-width: 768px) 50vw, 33vw"
              className="object-cover transition-transform duration-500 hover:scale-105"
            />
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Portfolio image"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setActive(null)}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <div
            className="relative w-full max-w-3xl aspect-[4/5] sm:aspect-[3/4]"
            onClick={(e) => e.stopPropagation()}
          >
            <CatalogImage
              src={active}
              alt={`${displayName} portfolio`}
              fill
              optimizeWidth={1400}
              sizes="90vw"
              className="object-contain"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
