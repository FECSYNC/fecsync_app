export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import { applyMarketingCampaignAction } from "@/lib/marketing/campaigns/campaigns";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

type RouteContext = { params: Promise<{ id: string }> };

const ACTIONS = ["schedule", "pause", "resume", "send_now", "duplicate"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: NextRequest, context: RouteContext) {
  const route = "POST /api/admin/marketing/campaigns/[id]/actions";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSend);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingSend);
  }
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return badRequest("Invalid JSON");
  }
  const action = String(body.action ?? "") as Action;
  if (!ACTIONS.includes(action)) {
    return badRequest("action must be schedule, pause, resume, send_now, or duplicate");
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const { id } = await context.params;
    const campaign = await applyMarketingCampaignAction({
      orgId,
      campaignId: id,
      actorUserId: typeof actor.sub === "string" ? actor.sub : null,
      scope,
      action,
    });
    return ok({ campaign });
  } catch (err) {
    return marketingFail(err, request, route, "Failed to update campaign", actor);
  }
}
