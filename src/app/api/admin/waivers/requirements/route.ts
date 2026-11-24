export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  createWaiverRequirement,
  listWaiverRequirements,
} from "@/lib/waivers/requirements";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/requirements", P.WaiversRead);
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const requirements = await listWaiverRequirements(actor);
    return ok({ requirements });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/requirements", "Failed to list waiver requirements", actor);
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/requirements", P.WaiversWrite);
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
    const requirement = await createWaiverRequirement(actor, body);
    return ok({ requirement });
  } catch (err) {
    return waiverFail(err, request, "POST /api/admin/waivers/requirements", "Failed to create waiver requirement", actor);
  }
}
