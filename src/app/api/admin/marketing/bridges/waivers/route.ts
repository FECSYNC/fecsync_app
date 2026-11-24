export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { readWaiverMarketingBridge } from "@/lib/marketing/waiverBridge";
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
    return marketingAuthFail(
      err,
      request,
      "GET /api/admin/marketing/bridges/waivers",
      P.MarketingRead
    );
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertMarketingEnabled(orgId);
    const locationId = request.nextUrl.searchParams.get("locationId");
    const bridge = await readWaiverMarketingBridge(
      orgId,
      locationId && locationId.trim() ? locationId.trim() : null
    );
    return ok({ bridge, orgId });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "GET /api/admin/marketing/bridges/waivers",
      "Failed to load waivers bridge",
      actor
    );
  }
}
