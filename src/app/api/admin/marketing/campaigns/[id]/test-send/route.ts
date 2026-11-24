export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import { sendMarketingCampaignTest } from "@/lib/marketing/campaigns/campaigns";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const route = "POST /api/admin/marketing/campaigns/[id]/test-send";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSend);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingSend);
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const { id } = await context.params;
    const result = await sendMarketingCampaignTest({
      orgId,
      campaignId: id,
      actorUserId: String(actor.sub),
      scope,
    });
    return ok(result);
  } catch (err) {
    return marketingFail(err, request, route, "Failed to send test email", actor);
  }
}
