import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";
import {
  archiveCampaignForTailor,
  deleteCampaignForTailor,
  getCampaignForTailor,
  updateCampaignForTailor,
} from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    const campaign = await getCampaignForTailor(tailor._id, id);
    if (!campaign) return notFound("Campaign not found");
    return ok({ campaign });
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "GET /api/tailor/campaigns/[id]"));
    if (authRes) return authRes;
    console.error("Get campaign error:", err);
    return serverError("Failed to fetch campaign");
  }
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");
    const campaign = await updateCampaignForTailor(tailor._id, id, body);
    return ok({ campaign });
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "PUT /api/tailor/campaigns/[id]"));
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature")
    ) {
      return authErrorToResponse(err) ?? badRequest(message);
    }
    if (message.includes("not found")) return notFound(message);
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("too long") ||
      message.includes("must be approved") ||
      message.includes("Expiry") ||
      message.includes("Cannot")
    ) {
      return badRequest(message);
    }
    console.error("Update campaign error:", err);
    return serverError("Failed to update campaign");
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");
    if (body.action === "archive") {
      const campaign = await archiveCampaignForTailor(tailor._id, id);
      return ok({ campaign });
    }
    return badRequest("Unknown action");
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "PATCH /api/tailor/campaigns/[id]"));
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("Patch campaign error:", err);
    return serverError("Failed to update campaign");
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    await deleteCampaignForTailor(tailor._id, id);
    return ok({ message: "Campaign deleted" });
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "DELETE /api/tailor/campaigns/[id]"));
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("Delete campaign error:", err);
    return serverError("Failed to delete campaign");
  }
}
