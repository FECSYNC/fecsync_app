'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';

type OpeningVariant = 'light' | 'dark';

/** Only show the Opening overlay if the image is still pending after this ms. */
const LOADER_DELAY_MS = 120;

type OpeningImageLoaderProps = {
  /** light = light backgrounds; dark = dark overlays (e.g. mobile nav) */
  variant?: OpeningVariant;
  /** Hide the “Opening…” label (useful for small thumbnails) */
  compact?: boolean;
  className?: string;
};

/** Gold spinner + “Opening…” label used while pictures finish loading. */
export function OpeningImageLoader({
  variant = 'light',
  compact = false,
  className = '',
}: OpeningImageLoaderProps) {
  const labelClass = variant === 'dark' ? 'text-[#FFE181]' : 'text-gray-600';

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2
        className={`${compact ? 'w-5 h-5' : 'w-7 h-7'} animate-spin text-[#D4AF37]`}
        aria-hidden
      />
      {!compact && (
        <span className={`text-sm font-medium ${labelClass}`}>Opening…</span>
      )}
      {compact && <span className="sr-only">Opening…</span>}
    </div>
  );
}

type OpeningImageOverlayProps = {
  ready: boolean;
  /** When false, hide overlay even if not ready (used to avoid flash on fast loads) */
  show?: boolean;
  variant?: OpeningVariant;
  compact?: boolean;
  /** Extra classes on the overlay shell (e.g. rounded corners) */
  className?: string;
};

/** Absolute overlay that covers an image frame until `ready` is true. */
export function OpeningImageOverlay({
  ready,
  show = true,
  variant = 'light',
  compact = false,
  className = '',
}: OpeningImageOverlayProps) {
  if (ready || !show) return null;

  const shell = variant === 'dark' ? 'bg-black/40' : 'bg-white/90';

  return (
    <div
      className={`absolute inset-0 z-10 flex items-center justify-center ${shell} ${className}`}
      aria-hidden={false}
    >
      <OpeningImageLoader variant={variant} compact={compact} />
    </div>
  );
}

/** Track whether an image source has finished loading (or failed). */
export function useOpeningImage(src?: string | null) {
  const [ready, setReady] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    setReady(false);
    setShowLoader(false);
    if (!src) return;

    // Only reveal Opening… if the image is still pending after a short delay.
    // Fast / cached loads never flash the loader.
    const timer = window.setTimeout(() => {
      setShowLoader(true);
    }, LOADER_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [src]);

  const onLoad = useCallback(() => {
    setReady(true);
    setShowLoader(false);
  }, []);
  const onError = useCallback(() => {
    setReady(true);
    setShowLoader(false);
  }, []);

  return { ready, showLoader: showLoader && !ready, onLoad, onError, setReady };
}

type OpeningImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Wrapper className (must establish size; defaults to relative overflow-hidden) */
  frameClassName?: string;
  variant?: OpeningVariant;
  compact?: boolean;
  overlayClassName?: string;
};

/**
 * Drop-in `<img>` with an Opening… overlay until the picture loads.
 * Parent sizing: pass height/aspect via `frameClassName`.
 * Fast loads skip the overlay; priority images start fetching immediately.
 */
export function OpeningImg({
  src,
  alt,
  className = 'w-full h-full object-cover',
  frameClassName = 'relative w-full h-full overflow-hidden',
  variant = 'light',
  compact = false,
  overlayClassName = '',
  onLoad,
  onError,
  loading,
  fetchPriority,
  ...rest
}: OpeningImgProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { ready, showLoader, onLoad: markReady, onError: markFailed } =
    useOpeningImage(typeof src === 'string' ? src : undefined);

  // Cached / already-decoded images often skip a late onLoad — detect immediately.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      markReady();
    }
  }, [src, markReady]);

  return (
    <div className={frameClassName}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? ''}
        className={`${className} transition-opacity duration-150 ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
        loading={loading ?? (fetchPriority === 'high' ? 'eager' : 'lazy')}
        decoding="async"
        fetchPriority={fetchPriority}
        onLoad={(e) => {
          markReady();
          onLoad?.(e);
        }}
        onError={(e) => {
          markFailed();
          onError?.(e);
        }}
        {...rest}
      />
      <OpeningImageOverlay
        ready={ready}
        show={showLoader}
        variant={variant}
        compact={compact}
        className={overlayClassName}
      />
    </div>
  );
}
