/**
 * Normalize catalog media to remote Cloudinary URLs.
 * Admin create historically embedded data: URLs; storefront lists strip those,
 * so writes must upload base64 before persist.
 */

import { uploadSingleFile } from "@/lib/upload";
import { isDataImageUrl, isRemoteCatalogImageUrl } from "@/lib/catalogImages";
import { MAX_PRODUCT_IMAGES } from "@/lib/productImages";

type UploadResult = { secure_url?: string };

function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) return null;
    const ext = mime.includes("png")
      ? "png"
      : mime.includes("webp")
        ? "webp"
        : mime.includes("gif")
          ? "gif"
          : "jpg";
    return { buffer, ext };
  } catch {
    return null;
  }
}

export async function uploadDataUrlToCloudinary(
  dataUrl: string,
  folder: string
): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const filename = `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = (await uploadSingleFile(
    parsed.buffer,
    filename,
    folder,
    "image"
  )) as UploadResult;
  return typeof result?.secure_url === "string" ? result.secure_url : null;
}

/** Keep remote URLs; upload data: URLs; drop anything else. Max MAX_PRODUCT_IMAGES. */
export async function resolveProductImagesForWrite(
  images: unknown
): Promise<string[]> {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const entry of images) {
    if (out.length >= MAX_PRODUCT_IMAGES) break;
    if (typeof entry !== "string") continue;
    const src = entry.trim();
    if (!src) continue;
    if (isRemoteCatalogImageUrl(src)) {
      out.push(src);
      continue;
    }
    if (isDataImageUrl(src)) {
      const url = await uploadDataUrlToCloudinary(src, "products");
      if (url) out.push(url);
    }
  }
  return out;
}

export async function resolveFabricImageForWrite(
  image: unknown
): Promise<string | undefined> {
  if (typeof image !== "string") return undefined;
  const src = image.trim();
  if (!src) return undefined;
  if (isRemoteCatalogImageUrl(src)) return src;
  if (isDataImageUrl(src)) {
    return (await uploadDataUrlToCloudinary(src, "fabrics")) ?? undefined;
  }
  return undefined;
}
