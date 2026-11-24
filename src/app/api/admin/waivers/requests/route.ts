export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { WaiverLinkError, assertWaiverRequestRate, createWaiverRequest } from "@/lib/waivers/signToken";
import { errorResponse } from "@/lib/response";

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/requests", P.WaiversWrite);
  }
  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertWaiverRequestRate(orgId);
    const body = await request.json().catch(() => null);
    const created = await createWaiverRequest(actor, body ?? {});
    return ok(created);
  } catch (err) {
    if (err instanceof WaiverLinkError) return errorResponse(err.message, err.status);
    return waiverFail(err, request, "POST /api/admin/waivers/requests", "Failed to send waiver link", actor);
  }
}
