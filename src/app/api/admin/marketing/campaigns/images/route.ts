export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { isUploadFile, uploadSingleFile } from "@/lib/upload";
import { apiRateLimited } from "@/lib/rateLimit";
import { marketingAuthFail, marketingFail } from "@/lib/marketing/http";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function POST(request: NextRequest) {
  const route = "POST /api/admin/marketing/campaigns/images";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingWrite);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingWrite);
  }
  const limited = apiRateLimited(request, "admin-marketing-campaign-image", 30, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertMarketingEnabled(orgId);
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadFile(file)) return badRequest("No image provided");
    if (!ALLOWED.has(file.type)) return badRequest("Use a PNG, JPG, GIF or WebP image");
    if (file.size > MAX_BYTES) return badRequest("Images must be 5 MB or smaller");
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = (await uploadSingleFile(
      buffer,
      `nl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      `marketing/${orgId}`,
      "image"
    )) as { secure_url?: string; width?: number; height?: number };
    if (!result?.secure_url) throw new Error("Upload did not return an image URL");
    return ok({ url: result.secure_url, width: result.width ?? null, height: result.height ?? null });
  } catch (err) {
    return marketingFail(err, request, route, "Image upload failed", actor);
  }
}
