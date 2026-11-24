export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { searchWaiverGuests } from "@/lib/waivers/capture";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "GET /api/admin/waivers/guests/search",
      P.WaiversRead
    );
  }
  try {
    await connectDB();
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const guests = await searchWaiverGuests(actor, q);
    return ok({ guests });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "GET /api/admin/waivers/guests/search",
      "Failed to search guests",
      actor
    );
  }
}
