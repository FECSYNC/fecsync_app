import { NextRequest, NextResponse } from "next/server";
import {
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";
import { exportCampaignParticipantsCsv } from "@/lib/measurementCampaigns";

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
    const { filename, csv } = await exportCampaignParticipantsCsv(
      tailor._id,
      id
    );
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/tailor/campaigns/[id]/participants/export")
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("Export campaign participants error:", err);
    return serverError("Failed to export participants");
  }
}
