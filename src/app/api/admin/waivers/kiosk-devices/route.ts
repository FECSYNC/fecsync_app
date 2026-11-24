export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { createKioskDevice, listKioskDevices } from "@/lib/waivers/kiosk";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/kiosk-devices", P.WaiversAdmin);
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const devices = await listKioskDevices(actor);
    return ok({ devices });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/kiosk-devices", "Failed to list kiosk devices", actor);
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/kiosk-devices", P.WaiversAdmin);
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
    const device = await createKioskDevice(actor, body);
    return ok({ device });
  } catch (err) {
    return waiverFail(err, request, "POST /api/admin/waivers/kiosk-devices", "Failed to create kiosk device", actor);
  }
}
