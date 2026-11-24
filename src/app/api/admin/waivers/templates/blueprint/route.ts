export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { gone } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail } from "@/lib/waivers/http";

const CLOSED = "Form questions are added in the form wizard, not from a spreadsheet.";

export async function GET(request: NextRequest) {
  try {
    await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "GET /api/admin/waivers/templates/blueprint",
      P.WaiversWrite
    );
  }
  return gone(CLOSED);
}
