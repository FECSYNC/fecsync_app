export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { sendMarketingAutomationTest } from "@/lib/marketing/testSend";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSend);
  } catch (err) {
    return marketingAuthFail(
      err,
      request,
      "POST /api/admin/marketing/automations/test-send",
      P.MarketingSend
    );
  }
  let body: { kind?: string };
  try {
    body = (await request.json()) as { kind?: string };
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const kind = String(body.kind ?? "welcome");
    const result = await sendMarketingAutomationTest({
      orgId,
      actorUserId: String(actor.sub),
      kind,
    });
    return ok(result);
  } catch (err) {
    return marketingFail(
      err,
      request,
      "POST /api/admin/marketing/automations/test-send",
      "Failed to send test email",
      actor
    );
  }
}
