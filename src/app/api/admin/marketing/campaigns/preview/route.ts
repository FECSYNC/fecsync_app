export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import { previewMarketingCampaign } from "@/lib/marketing/campaigns/campaigns";
import type { MarketingCampaignInput } from "@/lib/marketing/campaigns/types";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

export async function POST(request: NextRequest) {
  const route = "POST /api/admin/marketing/campaigns/preview";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingRead);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingRead);
  }
  let body: MarketingCampaignInput & Record<string, unknown>;
  try {
    body = (await request.json()) as MarketingCampaignInput & Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }
  if ("orgId" in body) return badRequest("Unsupported field orgId");
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const preview = await previewMarketingCampaign({ orgId, scope, data: body });
    return ok({ preview });
  } catch (err) {
    return marketingFail(err, request, route, "Failed to render preview", actor);
  }
}
