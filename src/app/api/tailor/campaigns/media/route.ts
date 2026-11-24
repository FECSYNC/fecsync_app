import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import {
  uploadSingleFile,
  safeCloudinaryFolder,
  isUploadFile,
} from "@/lib/upload";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/tailor/campaigns/media — upload campaign logo or cover image.
 * Returns a Cloudinary URL for the client to save on create/update.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuthFresh(req);
    await assertActiveTailorProviderAccess(actor);

    const formData = await req.formData();
    const kind = String(formData.get("kind") || "logo");
    if (kind !== "logo" && kind !== "cover") {
      return badRequest("kind must be logo or cover");
    }

    const folder = safeCloudinaryFolder("campaigns");
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
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const filename = `campaign_${kind}_${timestamp}_${randomString}`;
    const uploadResult = await uploadSingleFile(
      buffer,
      filename,
      folder,
      "image"
    );
    const { secure_url } = uploadResult as { secure_url: string };
    return ok({ url: secure_url, kind, message: "Image uploaded" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/tailor/campaigns/media")
    );
    if (authRes) return authRes;
    console.error("Campaign media upload error:", err);
    return serverError("Upload failed");
  }
}
