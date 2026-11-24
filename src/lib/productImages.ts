/**
 * Product gallery limits + storefront image shaping.
 * Lists stay on a single thumb; PDP detail keeps the full gallery (up to max).
 */

import {
  isRemoteCatalogImageUrl,
  optimizeCatalogImageUrl,
} from '@/lib/catalogImages';

/** Hard cap for product sample images (DB + admin + storefront). */
export const MAX_PRODUCT_IMAGES = 8;

export function clampProductImages(images: string[]): string[] {
  return images
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_PRODUCT_IMAGES);
}

/**
 * Optimize every gallery URL for the product detail page.
 * Keeps all slots (up to MAX) — unlike slimCatalogImages which returns only one thumb.
 */
export function optimizeProductGalleryImages(
  images: unknown,
  width = 900
): string[] {
  if (!Array.isArray(images) || images.length === 0) return [];
  const out: string[] = [];
  for (const entry of images) {
    if (out.length >= MAX_PRODUCT_IMAGES) break;
    if (typeof entry !== 'string') continue;
    const src = entry.trim();
    if (!src) continue;
    if (!isRemoteCatalogImageUrl(src)) continue;
    out.push(optimizeCatalogImageUrl(src, width));
  }
  return out;
}

/** Pad to `count` slots with empty strings (admin edit UI). */
export function padImageSlots(images: string[], count = MAX_PRODUCT_IMAGES): string[] {
  const next = [...images.map((u) => u || '')];
  while (next.length < count) next.push('');
  return next.slice(0, count);
}
