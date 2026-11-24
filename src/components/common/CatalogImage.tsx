'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  isCloudinaryUrl,
  isDataImageUrl,
  optimizeCatalogImageUrl,
} from '@/lib/catalogImages';
import { OpeningImageOverlay } from '@/components/common/OpeningImage';

const PLACEHOLDER = '/placeholder.png';
const LOADER_DELAY_MS = 120;
/** Tiny inline fallback if /placeholder.png is missing or corrupt. */
const INLINE_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600">
      <rect width="480" height="600" fill="#e5e7eb"/>
    </svg>`
  );

type CatalogImageProps = {
  src?: string | null;
  alt: string;
  /** CSS class on the image element */
  className?: string;
  /** Fill parent (position:relative required on parent) */
  fill?: boolean;
  width?: number;
  height?: number;
  /** Above-the-fold: eager + high fetch priority */
  priority?: boolean;
  sizes?: string;
  /** Cloudinary/target display width hint */
  optimizeWidth?: number;
  /** Hide “Opening…” label (small thumbs) */
  compactLoader?: boolean;
};

/**
 * Fast storefront image:
 * - Cloudinary → sized URL loaded directly (skip Next image proxy)
 * - data: URLs → native img (should be rare on lists; stripped server-side)
 * - Missing → placeholder
 * Opening… only appears if load takes longer than ~120ms (no flash on fast loads).
 */
export default function CatalogImage({
  src,
  alt,
  className = 'object-cover',
  fill = false,
  width,
  height,
  priority = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  optimizeWidth = 480,
  compactLoader = false,
}: CatalogImageProps) {
  const raw = (src || '').trim() || PLACEHOLDER;
  const optimized = optimizeCatalogImageUrl(raw, optimizeWidth);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [allowLoader, setAllowLoader] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const finalSrc = failed ? INLINE_FALLBACK : optimized;
  const dataUrl = isDataImageUrl(finalSrc);
  // Cloudinary is already resized/f_auto — avoid /_next/image double-fetch.
  const directLoad =
    dataUrl ||
    finalSrc === PLACEHOLDER ||
    finalSrc === INLINE_FALLBACK ||
    isCloudinaryUrl(finalSrc);

  const imgClass = fill
    ? `absolute inset-0 h-full w-full ${className}`
    : className;

  const pending = !loaded && !dataUrl && finalSrc !== INLINE_FALLBACK;
  const showLoader = pending && allowLoader;

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    setAllowLoader(false);
    const timer = window.setTimeout(() => setAllowLoader(true), LOADER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [optimized]);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [finalSrc]);

  const handleError = () => {
    if (!failed) setFailed(true);
    setLoaded(true);
  };

  const handleLoad = () => setLoaded(true);

  if (directLoad) {
    if (fill) {
      return (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={finalSrc}
            alt={alt}
            className={`${imgClass} ${
              loaded || dataUrl || finalSrc === INLINE_FALLBACK ? 'opacity-100' : 'opacity-0'
            } transition-opacity duration-150`}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            onLoad={handleLoad}
            onError={handleError}
          />
          <OpeningImageOverlay
            ready={!pending}
            show={showLoader}
            compact={compactLoader}
          />
        </>
      );
    }
    return (
      <span className="relative inline-block w-full h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={finalSrc}
          alt={alt}
          width={width}
          height={height}
          className={`${className} ${
            loaded || dataUrl || finalSrc === INLINE_FALLBACK ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-150`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={handleLoad}
          onError={handleError}
        />
        <OpeningImageOverlay
          ready={!pending}
          show={showLoader}
          compact={compactLoader}
        />
      </span>
    );
  }

  if (fill) {
    return (
      <>
        <Image
          src={finalSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150`}
          onLoad={handleLoad}
          onError={handleError}
        />
        <OpeningImageOverlay
          ready={!pending}
          show={showLoader}
          compact={compactLoader}
        />
      </>
    );
  }

  return (
    <span className="relative inline-block">
      <Image
        src={finalSrc}
        alt={alt}
        width={width ?? optimizeWidth}
        height={height ?? Math.round((optimizeWidth * 4) / 3)}
        sizes={sizes}
        priority={priority}
        className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150`}
        onLoad={handleLoad}
        onError={handleError}
      />
      <OpeningImageOverlay
        ready={!pending}
        show={showLoader}
        compact={compactLoader}
      />
    </span>
  );
}
