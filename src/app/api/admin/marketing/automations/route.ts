export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import {
  getOrCreateMarketingSettings,
  patchMarketingSettings,
} from "@/lib/marketing/settings";
import {
  marketingAutomationsDto,
  type MarketingAutomationsPatch,
} from "@/lib/marketing/automationsDto";
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
    return marketingAuthFail(err, request, "GET /api/admin/marketing/automations", P.MarketingRead);
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertMarketingEnabled(orgId);
    const locationId = request.nextUrl.searchParams.get("locationId");
    const settings = await getOrCreateMarketingSettings(
      orgId,
      locationId && locationId.trim() ? locationId.trim() : null
    );
    return ok({ automations: marketingAutomationsDto(settings), orgId });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "GET /api/admin/marketing/automations",
      "Failed to load automations",
      actor
    );
  }
}

export async function PATCH(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingWrite);
  } catch (err) {
    return marketingAuthFail(
      err,
      request,
      "PATCH /api/admin/marketing/automations",
      P.MarketingWrite
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertMarketingEnabled(orgId);
    const locationId =
      body.locationId == null || body.locationId === ""
        ? null
        : String(body.locationId);
    const patch = body as MarketingAutomationsPatch;
    const settings = await patchMarketingSettings(orgId, locationId, patch);
    return ok({ automations: marketingAutomationsDto(settings) });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "PATCH /api/admin/marketing/automations",
      "Failed to save automations",
      actor
    );
  }
}
