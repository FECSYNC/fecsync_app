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
  createMarketingCampaign,
  listMarketingCampaigns,
} from "@/lib/marketing/campaigns/campaigns";
import type { MarketingCampaignInput } from "@/lib/marketing/campaigns/types";
import { marketingMailConfigured } from "@/lib/mailer";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingRead);
  } catch (err) {
    return marketingAuthFail(err, request, "GET /api/admin/marketing/campaigns", P.MarketingRead);
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const campaigns = await listMarketingCampaigns(orgId, scope);
    return ok({ campaigns, mailConfigured: marketingMailConfigured() });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "GET /api/admin/marketing/campaigns",
      "Failed to load campaigns",
      actor
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingWrite);
  } catch (err) {
    return marketingAuthFail(err, request, "POST /api/admin/marketing/campaigns", P.MarketingWrite);
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
    const campaign = await createMarketingCampaign({
      orgId,
      actorUserId: typeof actor.sub === "string" ? actor.sub : null,
      scope,
      data: body,
    });
    return ok({ campaign });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "POST /api/admin/marketing/campaigns",
      "Failed to create campaign",
      actor
    );
  }
}
