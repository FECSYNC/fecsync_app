export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  listTemplateVersions,
  requireTemplate,
  updateWaiverTemplate,
} from "@/lib/waivers/templates";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/templates/[id]", P.WaiversRead);
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const row = await requireTemplate(actor, id);
    const versions = await listTemplateVersions(actor, row.id);
    return ok({
      template: {
        id: row.id,
        orgId: row.orgId,
        locationId: row.locationId,
        kind: row.kind,
        name: row.name,
        slug: row.slug,
        status: row.status,
        currentPublishedVersionId: row.currentPublishedVersionId,
        requireResignOnPublish: row.requireResignOnPublish,
        defaultExpiryRule: row.defaultExpiryRule,
        defaultExpiryDays: row.defaultExpiryDays,
        archivedAt: row.archivedAt?.toISOString() ?? null,
      },
      versions,
    });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/templates/[id]", "Failed to load waiver template", actor);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "PATCH /api/admin/waivers/templates/[id]", P.WaiversWrite);
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
    const template = await updateWaiverTemplate(actor, id, body);
    return ok({ template });
  } catch (err) {
    return waiverFail(err, request, "PATCH /api/admin/waivers/templates/[id]", "Failed to update waiver template", actor);
  }
}
