export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import {
  archiveMarketingCampaign,
  getMarketingCampaign,
  updateMarketingCampaign,
} from "@/lib/marketing/campaigns/campaigns";
import type { MarketingCampaignInput } from "@/lib/marketing/campaigns/types";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const route = "GET /api/admin/marketing/campaigns/[id]";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingRead);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingRead);
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const { id } = await context.params;
    const campaign = await getMarketingCampaign(orgId, id, scope);
    return ok({ campaign });
  } catch (err) {
    return marketingFail(err, request, route, "Failed to load campaign", actor);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const route = "PATCH /api/admin/marketing/campaigns/[id]";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingWrite);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingWrite);
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
    const { id } = await context.params;
    const campaign = await updateMarketingCampaign({
      orgId,
      campaignId: id,
      scope,
      data: body,
    });
    return ok({ campaign });
  } catch (err) {
    return marketingFail(err, request, route, "Failed to save campaign", actor);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const route = "DELETE /api/admin/marketing/campaigns/[id]";
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingWrite);
  } catch (err) {
    return marketingAuthFail(err, request, route, P.MarketingWrite);
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const { id } = await context.params;
    await archiveMarketingCampaign({ orgId, campaignId: id, scope });
    return ok({ archived: true });
  } catch (err) {
    return marketingFail(err, request, route, "Failed to archive campaign", actor);
  }
}
