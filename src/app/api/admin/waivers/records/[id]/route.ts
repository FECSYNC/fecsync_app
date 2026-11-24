export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { getWaiverRecordDetail } from "@/lib/waivers/capture";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/records/[id]", P.WaiversRead);
  }
  try {
    await connectDB();
    const { id } = await ctx.params;
    const record = await getWaiverRecordDetail(actor, id);
    return ok({ record });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/records/[id]", "Failed to load waiver", actor);
  }
}
