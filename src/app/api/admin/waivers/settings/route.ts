export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { getWaiverSettings, upsertWaiverSettings } from "@/lib/waivers/settings";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/settings", P.WaiversAdmin);
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const locationId = request.nextUrl.searchParams.get("locationId");
    const settings = await getWaiverSettings(
      actor,
      locationId && locationId.trim() ? locationId.trim() : null
    );
    return ok({ settings, orgId: String(actor.orgId) });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/settings", "Failed to load waiver settings", actor);
  }
}

export async function PUT(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(err, request, "PUT /api/admin/waivers/settings", P.WaiversAdmin);
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
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const settings = await upsertWaiverSettings(actor, body);
    return ok({ settings });
  } catch (err) {
    return waiverFail(err, request, "PUT /api/admin/waivers/settings", "Failed to save waiver settings", actor);
  }
}
