export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { uploadSingleFile, safeCloudinaryFolder, isUploadFile } from "@/lib/upload";
import {
  uploaded,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";

/*
 * Step 4.4 — POST /api/upload → uploads:write. Never public.
 * Fresh + suspended-org check (Phase 1): do not allow uploads on a stale JWT
 * after Organization suspend / membership revoke.
 * Admin product/fabric create still embeds base64 today.
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
    const uploadedFile = formData.get("files");

    if (!isUploadFile(uploadedFile)) {
      return badRequest("No file provided");
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const filename = `file_${timestamp}_${randomString}`;

    const uploadResult = await uploadSingleFile(
      buffer,
      filename,
      folder,
      "auto"
    );

    return uploaded(uploadResult);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Upload error:", error);
    return serverError("Upload failed");
  }
}
