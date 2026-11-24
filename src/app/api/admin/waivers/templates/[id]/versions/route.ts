export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { createDraftVersion, listTemplateVersions } from "@/lib/waivers/templates";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "GET /api/admin/waivers/templates/[id]/versions",
      P.WaiversRead
    );
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const versions = await listTemplateVersions(actor, id);
    return ok({ versions });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "GET /api/admin/waivers/templates/[id]/versions",
      "Failed to list waiver versions",
      actor
    );
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "POST /api/admin/waivers/templates/[id]/versions",
      P.WaiversWrite
    );
  }
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const version = await createDraftVersion(actor, id, body);
    return ok({ version });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "POST /api/admin/waivers/templates/[id]/versions",
      "Failed to create waiver version",
      actor
    );
  }
}
