'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePublicAdBannersQuery } from '@/hooks/useAdBanners';
import { OpeningImg } from '@/components/common/OpeningImage';
import type { AdBannerDto } from '@/lib/adBanners.shared';

function BannerSlide({ banner }: { banner: AdBannerDto }) {
  const inner = (
    <>
      <div className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-[5/6] lg:aspect-[3/4]">
        <OpeningImg
          src={banner.image}
          alt={banner.heading}
          className="h-full w-full object-cover"
          frameClassName="absolute inset-0 h-full w-full"
          fetchPriority="high"
          loading="eager"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(10,9,6,0.88) 0%, rgba(10,9,6,0.35) 42%, transparent 70%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
          <h3 className="text-lg font-bold leading-snug text-white sm:text-xl">
            {banner.heading}
          </h3>
          <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-white/85">
            {banner.paragraph}
          </p>
        </div>
      </div>
    </>
  );

  const shellClass =
    'block w-full overflow-hidden rounded-2xl bg-[#0a0906] ring-1 ring-black/5 transition-transform duration-300 hover:-translate-y-0.5';
  const shellStyle: React.CSSProperties = {
    boxShadow:
      '0 4px 6px -2px rgba(0,0,0,0.12), 0 16px 32px -8px rgba(0,0,0,0.22), 0 28px 56px -12px rgba(10,9,6,0.28), 0 2px 0 0 rgba(212,175,55,0.2)',
  };

  if (banner.href) {
    const external = /^https?:\/\//i.test(banner.href);
    if (external) {
      return (
        <a
          href={banner.href}
          target="_blank"
          rel="noopener noreferrer"
          className={shellClass}
          style={shellStyle}
        >
          {inner}
        </a>
      );
    }
    return (
      <Link href={banner.href} className={shellClass} style={shellStyle}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={shellClass} style={shellStyle}>
      {inner}
    </div>
  );
}

/**
 * Modern ad slider for the Trending Fashion sidebar empty space.
 * Hides itself when there are no active banners.
 */
export default function AdBannerSlider() {
  const { data: banners = [], isPending } = usePublicAdBannersQuery();
  const [index, setIndex] = useState(0);
  const count = banners.length;

  useEffect(() => {
    if (index >= count && count > 0) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (count <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, 5500);
    return () => window.clearInterval(id);
  }, [count]);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (count <= 1) return;
      setIndex((i) => (i + dir + count) % count);
    },
    [count]
  );

  if (!isPending && count === 0) return null;

  if (isPending && count === 0) {
    return (
      <div
        className="mt-2 w-full animate-pulse rounded-2xl bg-gray-200 lg:mt-4 lg:flex-1 lg:min-h-[280px]"
        aria-hidden
      />
    );
  }

  const current = banners[index] ?? banners[0];
  if (!current) return null;

  return (
    <div className="mt-2 flex w-full flex-col gap-3 lg:mt-4 lg:min-h-0 lg:flex-1">
      <div className="relative w-full">
        <BannerSlide key={current._id} banner={current} />

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous banner"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-md backdrop-blur-sm transition hover:bg-white"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="Next banner"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-md backdrop-blur-sm transition hover:bg-white"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b._id}
              type="button"
              aria-label={`Go to banner ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? 'w-6 bg-[#D4AF37]'
                  : 'w-1.5 bg-gray-300 hover:bg-gray-400'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
