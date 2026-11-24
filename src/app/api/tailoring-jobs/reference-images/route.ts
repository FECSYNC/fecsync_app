import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  uploadSingleFile,
  safeCloudinaryFolder,
  isUploadFile,
} from "@/lib/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/tailoring-jobs/reference-images
 * Authenticated customer upload during booking wizard (before job exists).
 * Returns Cloudinary URL to include in POST /api/tailoring-jobs.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermissionFresh(req, P.TailoringJobsWriteOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/tailoring-jobs/reference-images", {
          permission: P.TailoringJobsWriteOwn,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const formData = await req.formData();
    const folder = safeCloudinaryFolder("tailoring-jobs");
    const uploadedFile = formData.get("file");
    if (!isUploadFile(uploadedFile)) {
      return badRequest("No file provided");
    }
    if (uploadedFile.size > MAX_BYTES) {
      return badRequest("Image must be 8MB or smaller");
    }
    const mime = typeof uploadedFile.type === "string" ? uploadedFile.type : "";
    if (mime && !mime.startsWith("image/")) {
      return badRequest("Only image uploads are allowed");
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const filename = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const uploadResult = await uploadSingleFile(
      buffer,
      filename,
      folder,
      "image"
    );
    const { secure_url } = uploadResult as { secure_url: string };
    return ok({ url: secure_url, message: "Image uploaded" });
  } catch (err) {
    console.error("Booking reference image upload error:", err);
    return serverError("Upload failed");
  }
}
