import { api, unwrap, ApiError, type MaybeWrapped } from "@/utils/api";
import { compressImageFile } from "@/utils/imageUpload";

type CloudinaryUpload = {
  secure_url?: string;
  url?: string;
  error?: { message?: string };
};

type SignPayload = {
  cloudName: string;
  apiKey: string;
  signatures: Array<{
    timestamp: number;
    signature: string;
    folder: string;
    publicId: string;
  }>;
};

function pickSecureUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const row = result as CloudinaryUpload;
  const url = row.secure_url || row.url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

const MAX_BYTES = 10 * 1024 * 1024;
const SIGN_TTL_MS = 50_000;
/** Phone photos on slow links routinely exceed 30s to Cloudinary. */
const CLOUDINARY_TIMEOUT_MS = 120_000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 180_000;

let warmSign: { folder: string; at: number; payload: SignPayload } | null = null;

async function prepareFiles(files: File[]): Promise<File[]> {
  const prepared = await Promise.all(files.map((file) => compressImageFile(file)));
  for (const file of prepared) {
    if (file.size > MAX_BYTES) {
      throw new Error(
        `"${file.name}" is still over 10MB after compression. Please use a smaller image.`
      );
    }
  }
  return prepared;
}

async function requestSignatures(
  folder: string,
  count: number
): Promise<SignPayload> {
  const res = await api<MaybeWrapped<SignPayload>>(
    "/api/upload/sign",
    {
      method: "POST",
      body: JSON.stringify({ folder, count }),
    },
    { timeout: 30_000 }
  );
  const payload = unwrap(res);
  if (!payload?.cloudName || !payload?.apiKey || !payload.signatures?.length) {
    throw new Error("Upload signing failed");
  }
  return payload;
}

/** Warm a Cloudinary signature so the next pick-file upload skips a round trip. */
export function prefetchUploadSignatures(
  folder: "products" | "fabrics" | "homepage" | "banners" | "memberships" = "products",
  count = 1
) {
  if (typeof window === "undefined") return;
  void requestSignatures(folder, count)
    .then((payload) => {
      warmSign = { folder, payload, at: Date.now() };
    })
    .catch(() => {
      /* next upload will sign on demand */
    });
}

function takeWarmSignatures(folder: string, count: number): SignPayload | null {
  if (
    !warmSign ||
    warmSign.folder !== folder ||
    Date.now() - warmSign.at > SIGN_TTL_MS ||
    warmSign.payload.signatures.length < count
  ) {
    return null;
  }
  const payload = warmSign.payload;
  warmSign = null;
  return {
    ...payload,
    signatures: payload.signatures.slice(0, count),
  };
}

async function getSignatures(folder: string, count: number): Promise<SignPayload> {
  return takeWarmSignatures(folder, count) ?? requestSignatures(folder, count);
}

async function postToCloudinary(
  file: File,
  creds: SignPayload,
  slot: number
): Promise<string> {
  const signed = creds.signatures[slot] ?? creds.signatures[0];
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", creds.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("folder", signed.folder);
  form.append("public_id", signed.publicId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUDINARY_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${creds.cloudName}/auto/upload`,
      { method: "POST", body: form, signal: controller.signal }
    );
    const json = (await res.json()) as CloudinaryUpload;
    const url = pickSecureUrl(json);
    if (!url) {
      throw new Error(json.error?.message || "Upload did not return an image URL");
    }
    return url;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Image upload timed out. Please try a smaller photo.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadViaProxy(
  files: File[],
  folder: "products" | "fabrics" | "homepage" | "banners" | "memberships"
): Promise<string[]> {
  if (files.length === 1) {
    const form = new FormData();
    form.append("folder", folder);
    form.append("files", files[0]);
    const res = await api<MaybeWrapped<CloudinaryUpload>>(
      "/api/upload",
      { method: "POST", body: form },
      { timeout: UPLOAD_REQUEST_TIMEOUT_MS }
    );
    const url = pickSecureUrl(unwrap(res));
    if (!url) throw new Error("Upload did not return an image URL");
    return [url];
  }

  const form = new FormData();
  form.append("folder", folder);
  for (const file of files) {
    form.append("files", file);
  }
  const res = await api<MaybeWrapped<CloudinaryUpload[]>>(
    "/api/upload/bulk",
    { method: "POST", body: form },
    { timeout: UPLOAD_REQUEST_TIMEOUT_MS }
  );
  const payload = unwrap(res);
  const list = Array.isArray(payload) ? payload : [];
  const urls = list.map(pickSecureUrl).filter((u): u is string => Boolean(u));
  if (urls.length === 0) {
    throw new Error("Upload did not return image URLs");
  }
  return urls;
}

/** Upload one or more catalog files straight to Cloudinary (signed). */
export async function uploadCatalogImages(
  files: File[],
  folder: "products" | "fabrics" | "homepage" | "banners" | "memberships" = "products"
): Promise<string[]> {
  if (files.length === 0) return [];

  let prepared: File[] | null = null;
  const preparedPromise = prepareFiles(files).then((next) => {
    prepared = next;
    return next;
  });

  try {
    const [filesPrepared, creds] = await Promise.all([
      preparedPromise,
      getSignatures(folder, files.length),
    ]);
    const urls = await Promise.all(
      filesPrepared.map((file, index) => postToCloudinary(file, creds, index))
    );
    prefetchUploadSignatures(folder, 1);
    return urls;
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 401 || status === 403) throw err;
    if (err instanceof Error && err.message.includes("over 10MB")) throw err;
    console.warn("Direct Cloudinary upload failed, using server proxy:", err);
    const toUpload = prepared ?? (await prepareFiles(files));
    return uploadViaProxy(toUpload, folder);
  }
}
