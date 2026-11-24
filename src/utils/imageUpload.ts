/**
 * Client-side image helpers for admin catalog uploads.
 * Compress before Cloudinary so uploads stay small and fast.
 */

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.7;
const SKIP_UNDER_BYTES = 200_000;
const COMPRESS_TIMEOUT_MS = 8_000;

const IMAGE_EXT =
  /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg|tiff?|jfif|ico)$/i;

/** File picker: any raster/vector image the OS can offer. */
export const IMAGE_FILE_ACCEPT =
  "image/*,image/heic,image/heif,image/avif,.heic,.heif,.avif,.tif,.tiff,.bmp,.svg,.jfif,.ico";

/** Duck-type check — `instanceof File` can fail across Node/undici realms. */
export function isBrowserFile(value: unknown): value is File {
  if (!value || typeof value !== "object") return false;
  const f = value as File;
  return (
    typeof f.size === "number" &&
    f.size > 0 &&
    typeof f.arrayBuffer === "function" &&
    typeof (f as Blob).type === "string"
  );
}

/** True for real images even when Windows leaves `file.type` empty. */
export function isLikelyImageFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type && type !== "application/octet-stream") return false;
  return IMAGE_EXT.test(file.name);
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/** Resize + JPEG-compress an image File for faster Cloudinary uploads. */
export async function compressImageFile(file: File): Promise<File> {
  const type = (file.type || "").toLowerCase();
  if (type === "image/svg+xml" || type === "image/gif") {
    return file;
  }
  if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
    return file;
  }
  if (file.size < SKIP_UNDER_BYTES) {
    return file;
  }

  return withTimeout(compressNow(file), COMPRESS_TIMEOUT_MS, file);
}

async function compressNow(file: File): Promise<File> {
  const source = await createImageBitmap(file).catch(() => null);
  if (!source) {
    return compressImageFileViaCanvas(file);
  }

  let draw = source;
  try {
    let { width, height } = source;
    if (width > MAX_EDGE || height > MAX_EDGE) {
      if (width > height) {
        height = Math.round((height / width) * MAX_EDGE);
        width = MAX_EDGE;
      } else {
        width = Math.round((width / height) * MAX_EDGE);
        height = MAX_EDGE;
      }
      const resized = await createImageBitmap(source, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "low",
      }).catch(() => null);
      if (resized) {
        source.close();
        draw = resized;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(draw, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.\w+$/, "") || "image";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    draw.close();
  }
}

/** Hosted functions (Vercel) reject request bodies over ~4.5MB. */
export const WIDE_IMAGE_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const WIDE_IMAGE_MAX_EDGE = 2560;

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap) return bitmap;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = document.createElement("img");
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Full-bleed photos (sign-in backgrounds): keep quality high, cap the long
 * edge, and re-encode until the upload fits WIDE_IMAGE_MAX_UPLOAD_BYTES.
 * Returns the original file when it already fits or cannot be decoded
 * (the server still validates type and size). `width` is the source width.
 */
export async function prepareWideImage(
  file: File
): Promise<{ file: File; width: number | null }> {
  const source = await decodeImage(file);
  if (!source) return { file, width: null };
  const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
  const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
  try {
    if (
      file.size <= WIDE_IMAGE_MAX_UPLOAD_BYTES &&
      Math.max(srcW, srcH) <= WIDE_IMAGE_MAX_EDGE
    ) {
      return { file, width: srcW };
    }
    const baseName = file.name.replace(/\.\w+$/, "") || "background";
    let edge = Math.min(WIDE_IMAGE_MAX_EDGE, Math.max(srcW, srcH));
    for (let pass = 0; pass < 3; pass += 1) {
      const scale = edge / Math.max(srcW, srcH);
      const width = Math.round(srcW * scale);
      const height = Math.round(srcH * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { file, width: srcW };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, width, height);
      for (const quality of [0.88, 0.8, 0.72]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality)
        );
        if (blob && blob.size <= WIDE_IMAGE_MAX_UPLOAD_BYTES) {
          return {
            file: new File([blob], `${baseName}.jpg`, { type: "image/jpeg" }),
            width: srcW,
          };
        }
      }
      edge = Math.round(edge * 0.75);
    }
    return { file, width: srcW };
  } finally {
    if ("close" in source) source.close();
  }
}

function compressImageFileViaCanvas(file: File): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(file);
    reader.onload = () => {
      const img = document.createElement("img");
      img.onerror = () => resolve(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_EDGE || height > MAX_EDGE) {
          if (width > height) {
            height = Math.round((height / width) * MAX_EDGE);
            width = MAX_EDGE;
          } else {
            width = Math.round((width / height) * MAX_EDGE);
            height = MAX_EDGE;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            const baseName = file.name.replace(/\.\w+$/, "") || "image";
            resolve(new File([blob], `${baseName}.jpg`, { type: "image/jpeg" }));
          },
          "image/jpeg",
          JPEG_QUALITY
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
