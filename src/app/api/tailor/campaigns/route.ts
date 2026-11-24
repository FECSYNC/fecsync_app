import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";
import {
  createCampaignForTailor,
  listCampaignsForTailor,
} from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const sp = req.nextUrl.searchParams;
    const result = await listCampaignsForTailor(tailor._id, {
      page: Number(sp.get("page") || "1"),
      limit: Number(sp.get("limit") || "20"),
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      category: sp.get("category") ?? undefined,
      sort: (sp.get("sort") as "newest" | "oldest" | "name") ?? "newest",
    });
    return ok(result);
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "GET /api/tailor/campaigns"));
    if (authRes) return authRes;
    console.error("List campaigns error:", err);
    return serverError("Failed to list campaigns");
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");
    const campaign = await createCampaignForTailor(tailor._id, tailor.orgId, body);
    return created({ campaign });
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "POST /api/tailor/campaigns"));
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "Failed to create campaign";
    if (
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature")
    ) {
      return authErrorToResponse(err) ?? badRequest(message);
    }
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
    console.error("Create campaign error:", err);
    return serverError("Failed to create campaign");
  }
}
