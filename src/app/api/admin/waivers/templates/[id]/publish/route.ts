export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { publishWaiverTemplate } from "@/lib/waivers/templates";
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
      "POST /api/admin/waivers/templates/[id]/publish",
      P.WaiversAdmin
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
    const template = await publishWaiverTemplate(actor, id, body);
    return ok({ template });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "POST /api/admin/waivers/templates/[id]/publish",
      "Failed to publish waiver template",
      actor
    );
  }
}
