export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { rotateKioskDeviceToken } from "@/lib/waivers/kiosk";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "POST /api/admin/waivers/kiosk-devices/[id]/rotate",
      P.WaiversAdmin
    );
  }
  try {
    await connectDB();
    const { id } = await ctx.params;
    const device = await rotateKioskDeviceToken(actor, id);
    return ok({ device });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "POST /api/admin/waivers/kiosk-devices/[id]/rotate",
      "Failed to rotate kiosk token",
      actor
    );
  }
}
