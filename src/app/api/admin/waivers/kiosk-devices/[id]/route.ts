export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { updateKioskDevice } from "@/lib/waivers/kiosk";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "PATCH /api/admin/waivers/kiosk-devices/[id]",
      P.WaiversAdmin
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const device = await updateKioskDevice(actor, id, body);
    return ok({ device });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "PATCH /api/admin/waivers/kiosk-devices/[id]",
      "Failed to update kiosk device",
      actor
    );
  }
}
