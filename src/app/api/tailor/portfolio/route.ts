import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  forbidden,
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
import { stampUpdate } from "@/lib/audit/recordAudit";
import {
  assertActiveTailorProviderAccess,
  updateOwnTailorProfile,
} from "@/lib/tailors";
import { TAILOR_PORTFOLIO_REEL_MAX } from "@/lib/tailors.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

/** POST /api/tailor/portfolio — upload image to own TailorProfile.portfolioImages */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthFresh(req);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/tailor/portfolio")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const existing = await assertActiveTailorProviderAccess(actor);
    if (existing.status === "suspended") {
      return forbidden("Your tailor profile is suspended");
    }
    if (existing.status !== "approved") {
      return forbidden(
        "Your tailor profile must be approved before you can edit it"
      );
    }
    if (existing.portfolioImages.length >= TAILOR_PORTFOLIO_REEL_MAX) {
      return badRequest(`Portfolio is limited to ${TAILOR_PORTFOLIO_REEL_MAX} images`);
    }

    const formData = await req.formData();
    const folder = safeCloudinaryFolder("tailors");
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
    const filename = `tailor_${timestamp}_${randomString}`;
    const uploadResult = await uploadSingleFile(
      buffer,
      filename,
      folder,
      "image"
    );
    const { secure_url } = uploadResult as { secure_url: string };

    const audit = await stampUpdate(actor.sub);
    const tailor = await updateOwnTailorProfile(
      actor.sub,
      {
        portfolioImages: [...existing.portfolioImages, secure_url],
      },
      audit
    );
    return ok({ tailor, url: secure_url, message: "Image uploaded" });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Tailor portfolio upload error:", err);
    return serverError("Upload failed");
  }
}
