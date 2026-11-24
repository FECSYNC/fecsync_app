export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { uploaded, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { uploadMultipleFiles, safeCloudinaryFolder, isUploadFile } from "@/lib/upload";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";

/*
 * Step 4.4 — POST /api/upload/bulk → uploads:write. Never public.
 * Fresh + suspended-org check (Phase 1).
 */

export async function POST(request: NextRequest) {
  try {
    await requirePermissionFresh(request, P.UploadsWrite);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    const formData = await request.formData();
    const folder = safeCloudinaryFolder(formData.get("folder"));
    const uploadedFiles = formData.getAll("files").filter(isUploadFile);

    if (uploadedFiles.length === 0) {
      return badRequest("No files provided");
    }

    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);

    const fileBuffers = await Promise.all(
      uploadedFiles.map(async (file, index) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        filename: `file_${timestamp}_${randomString}_${index}`,
      }))
    );

    const bulkUpload = await uploadMultipleFiles(fileBuffers, folder, "auto");

    return uploaded(bulkUpload);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Upload error:", error);
    return serverError("Upload failed");
  }
}
