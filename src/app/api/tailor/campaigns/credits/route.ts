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
import { getTailorCreditsSummary } from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const summary = await getTailorCreditsSummary(tailor._id);
    return ok({ summary });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/tailor/campaigns/credits")
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("Tailor credits summary error:", err);
    return serverError("Failed to load credits summary");
  }
}
