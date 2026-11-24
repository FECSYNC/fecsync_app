export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { DOCUMENT_KINDS, FORM_KINDS } from "@/lib/waivers/common";
import { createWaiverTemplate, listWaiverTemplates } from "@/lib/waivers/templates";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import type { WaiverDocumentKind } from "@prisma/client";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/templates", P.WaiversRead);
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
    const group = request.nextUrl.searchParams.get("group");
    const kinds =
      group === "forms"
        ? ([...FORM_KINDS] as WaiverDocumentKind[])
        : group === "documents"
          ? ([...DOCUMENT_KINDS] as WaiverDocumentKind[])
          : undefined;
    const templates = await listWaiverTemplates(actor, { kinds });
    return ok({ templates });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/templates", "Failed to list waiver templates", actor);
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/templates", P.WaiversWrite);
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
    const template = await createWaiverTemplate(actor, body);
    return ok({ template });
  } catch (err) {
    return waiverFail(err, request, "POST /api/admin/waivers/templates", "Failed to create waiver template", actor);
  }
}
