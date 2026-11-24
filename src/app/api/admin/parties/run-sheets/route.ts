export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, badRequest } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { listDailyPartyRunSheets } from "@/lib/parties/runSheet";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party run-sheets", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      const date = sp.get("date")?.trim();
      if (!date) return badRequest("date is required (YYYY-MM-DD)");
      return ok({
        runSheets: await listDailyPartyRunSheets(party.actor, {
          date,
          locationId: sp.get("locationId"),
        }),
      });
    }
  );
}
