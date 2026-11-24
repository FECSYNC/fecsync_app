export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, errorResponse } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { resendWaiverRequest } from "@/lib/waivers/desk";
import { WaiverLinkError } from "@/lib/waivers/signToken";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/records/[id]/resend", P.WaiversWrite);
  }
  try {
    await connectDB();
    const body = (await request.json().catch(() => ({}))) as { channel?: "email_link" | "sms_link" };
    const { id } = await ctx.params;
    const result = await resendWaiverRequest(actor, id, body.channel);
    return ok(result);
  } catch (err) {
    if (err instanceof WaiverLinkError) return errorResponse(err.message, err.status);
    return waiverFail(err, request, "POST /api/admin/waivers/records/[id]/resend", "Failed to resend waiver", actor);
  }
}
