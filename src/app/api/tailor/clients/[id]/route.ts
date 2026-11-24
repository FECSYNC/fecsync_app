import { NextRequest } from "next/server";
import {
  ok,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";
import { deleteTailorClient } from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/tailor/clients/[id] */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    await deleteTailorClient(tailor._id, id);
    return ok({ message: "Client removed" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "DELETE /api/tailor/clients/[id]")
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("Delete tailor client error:", err);
    return serverError("Failed to delete client");
  }
}
