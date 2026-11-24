export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import cloudinary from "@/lib/cloudinary";
import { safeCloudinaryFolder } from "@/lib/upload";
import { ok, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";

/**
 * POST /api/upload/sign → uploads:write.
 * Returns short-lived Cloudinary signatures so the browser can upload
 * straight to Cloudinary (avoids the Next.js proxy timeout).
 * Fresh + suspended-org check (Phase 1).
 */

const MAX_BATCH = 8;

export async function POST(request: NextRequest) {
  try {
    await requirePermissionFresh(request, P.UploadsWrite);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return serverError("Image storage is not configured");
  }

  try {
    let folder = "products";
    let count = 1;
    try {
      const body = (await request.json()) as { folder?: unknown; count?: unknown };
      folder = safeCloudinaryFolder(
        typeof body.folder === "string" ? body.folder : "products"
      );
      const rawCount = Number(body.count);
      if (Number.isFinite(rawCount)) {
        count = Math.min(MAX_BATCH, Math.max(1, Math.round(rawCount)));
      }
    } catch {
      // empty body is fine — one signature for products
    }

    const timestamp = Math.round(Date.now() / 1000);
    const signatures = Array.from({ length: count }, (_, i) => {
      const publicId = `file_${Date.now()}_${i}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const paramsToSign = {
        timestamp,
        folder,
        public_id: publicId,
      };
      const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
      return { timestamp, signature, folder, publicId };
    });

    return ok({
      cloudName,
      apiKey,
      signatures,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Upload sign error:", error);
    return serverError("Failed to prepare upload");
  }
}
