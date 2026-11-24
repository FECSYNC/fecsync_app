import { Readable } from 'stream';
import cloudinary from './cloudinary'; // Adjust the import path as necessary

/** Cloudinary folder from form fields — staff-only routes. Reject path tricks. */
const STAFF_UPLOAD_FOLDERS = new Set([
  "products",
  "fabrics",
  "homepage",
  "banners",
  "tailors",
  "tailoring-jobs",
  "campaigns",
  "profile-pictures",
  "memberships",
  // company-profiles/{orgId} is only via /api/admin/company-profile/logo
]);

export function safeCloudinaryFolder(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (
    !value ||
    value.includes("..") ||
    !/^[a-zA-Z0-9/_-]+$/.test(value) ||
    !STAFF_UPLOAD_FOLDERS.has(value.split("/")[0] ?? value)
  ) {
    return "products";
  }
  return value;
}

/**
 * True for multipart file parts. Avoid `instanceof File` — it fails across
 * Node/undici realms and returns "No file provided" for valid uploads.
 */
export function isUploadFile(value: FormDataEntryValue | null): value is File {
  if (value == null || typeof value === "string") return false;
  const candidate = value as File;
  return (
    typeof candidate.size === "number" &&
    candidate.size > 0 &&
    typeof candidate.arrayBuffer === "function"
  );
}

/**
 * Uploads a single file buffer to Cloudinary.
 * @param fileBuffer - The file buffer.
 * @param filename - Optional filename to use as public_id.
 * @param folder - Optional Cloudinary folder name.
 * @param resourceType - Defaults to 'auto'. Use 'raw' for PDFs or other binary data.
 */
export const uploadSingleFile = async (
    fileBuffer: Buffer,
    filename?: string,
    folder: string = '',
    resourceType: 'auto' | 'image' | 'raw' | 'video' = 'auto',
    options?: { overwrite?: boolean; invalidate?: boolean }
): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: filename,
                resource_type: resourceType,
                overwrite: options?.overwrite === true,
                invalidate: options?.invalidate === true,
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        Readable.from(fileBuffer).pipe(stream);
    });
};

/**
 * Uploads multiple file buffers to Cloudinary.
 * @param files - An array of file buffers or objects with buffer and filename.
 * @param folder - Optional folder name in Cloudinary.
 * @param resourceType - Defaults to 'auto'. Use 'raw' for PDFs or other binary data.
 */
export const uploadMultipleFiles = async (
    files: { buffer: Buffer; filename?: string }[],
    folder: string = '',
    resourceType: 'auto' | 'image' | 'raw' | 'video' = 'auto'
): Promise<unknown[]> => {
    const uploadPromises = files.map((file) =>
        uploadSingleFile(file.buffer, file.filename, folder, resourceType)
    );

    return Promise.all(uploadPromises);
};
