/**
 * Storefront catalog image helpers.
 * List endpoints must stay small — many products still embed base64 data URLs.
 */

const CLOUDINARY_UPLOAD = "/upload/";

export function isDataImageUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("data:");
}

/** True for http(s)/relative catalog URLs safe to ship in list JSON. */
export function isRemoteCatalogImageUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  const src = url.trim();
  if (!src || isDataImageUrl(src)) return false;
  return /^https?:\/\//i.test(src) || src.startsWith("/");
}

/**
 * Keep only the first remote thumb for grid/list cards.
 * Never return base64 — a single data URL can be multi‑MB and stalls the homepage.
 */
export function slimCatalogImages(
  images: unknown,
  width = 640
): string[] {
  if (!Array.isArray(images) || images.length === 0) return [];
  for (const entry of images) {
    if (typeof entry !== "string") continue;
    const src = entry.trim();
    if (!isRemoteCatalogImageUrl(src)) continue;
    return [optimizeCatalogImageUrl(src, width)];
  }
  return [];
}

/** First image only (or empty string). */
export function catalogThumbUrl(
  images: unknown,
  width = 640
): string {
  return slimCatalogImages(images, width)[0] ?? "";
}

/**
 * Cloudinary: request auto-format + sized derivative.
 * data: and non-Cloudinary URLs are returned unchanged.
 */
export function optimizeCatalogImageUrl(
  url: string,
  width = 640
): string {
  if (!url || url.startsWith("data:")) return url;
  if (!url.includes("res.cloudinary.com") || !url.includes(CLOUDINARY_UPLOAD)) {
    return url;
  }
  // Avoid double-transform if already optimized.
  if (/\/upload\/(?:[^/]+,)*f_auto/.test(url)) return url;
  const w = Math.min(Math.max(Math.round(width), 80), 1600);
  return url.replace(
    CLOUDINARY_UPLOAD,
    `${CLOUDINARY_UPLOAD}f_auto,q_auto,c_fill,g_auto,w_${w}/`
  );
}

export function isCloudinaryUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("res.cloudinary.com");
}

/** Map a lean product/fabric doc to a list-safe shape (single thumb image). */
export function toStorefrontListImages<T extends { images?: unknown }>(
  doc: T,
  width = 640
): T {
  return {
    ...doc,
    images: slimCatalogImages(doc.images, width),
  };
}

export function toStorefrontFabricImage<T extends { image?: unknown }>(
  doc: T,
  width = 640
): T {
  const raw = typeof doc.image === "string" ? doc.image.trim() : "";
  if (!isRemoteCatalogImageUrl(raw)) {
    return { ...doc, image: "" };
  }
  return {
    ...doc,
    image: optimizeCatalogImageUrl(raw, width),
  };
}
