export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { bulkResendWaivers, cancelOutstandingRequests } from "@/lib/waivers/desk";

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/records/bulk", P.WaiversWrite);
  }
  try {
    await connectDB();
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      recordIds?: string[];
      recordId?: string;
    } | null;
    if (!body) return badRequest("A bulk request is required");
    if (body.action === "cancel" && body.recordId) {
      return ok(await cancelOutstandingRequests(actor, body.recordId));
    }
    if (body.action === "resend" && Array.isArray(body.recordIds)) {
      return ok(await bulkResendWaivers(actor, body.recordIds));
    }
    return badRequest("Choose resend or cancel");
  } catch (err) {
    return waiverFail(err, request, "POST /api/admin/waivers/records/bulk", "Failed to update waiver requests", actor);
  }
}
