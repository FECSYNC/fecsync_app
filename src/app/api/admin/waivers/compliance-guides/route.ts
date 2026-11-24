export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { listComplianceGuides } from "@/lib/waivers/complianceGuides";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { assertWaiversStaff } from "@/lib/waivers/common";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "GET /api/admin/waivers/compliance-guides",
      P.WaiversRead
    );
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    await assertWaiversStaff(actor);
    return ok({
      guides: listComplianceGuides(),
      disclaimer:
        "Not legal advice. Checklists help operators review settings with their own counsel. FECSYNC does not certify legal compliance.",
    });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "GET /api/admin/waivers/compliance-guides",
      "Failed to load compliance guides",
      actor
    );
  }
}
