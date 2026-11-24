export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { importWaiverCsv } from "@/lib/waivers/importWaivers";

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversAdmin);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/import", P.WaiversAdmin);
  }
  try {
    await connectDB();
    const body = (await request.json().catch(() => null)) as {
      csv?: string;
      locationId?: string;
      dryRun?: boolean;
    } | null;
    if (!body?.csv || !body.locationId) return badRequest("A CSV and venue are required");
    const result = await importWaiverCsv(actor, {
      csv: body.csv,
      locationId: body.locationId,
      dryRun: body.dryRun !== false,
    });
    return ok(result);
  } catch (err) {
    return waiverFail(err, request, "POST /api/admin/waivers/import", "Failed to import waivers", actor);
  }
}
