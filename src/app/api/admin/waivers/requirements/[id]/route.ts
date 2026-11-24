export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { deleteWaiverRequirement } from "@/lib/waivers/requirements";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "DELETE /api/admin/waivers/requirements/[id]",
      P.WaiversWrite
    );
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    await deleteWaiverRequirement(actor, id);
    return ok({ deleted: true });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "DELETE /api/admin/waivers/requirements/[id]",
      "Failed to delete waiver requirement",
      actor
    );
  }
}
