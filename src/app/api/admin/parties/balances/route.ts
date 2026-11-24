export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { listPartyBalances } from "@/lib/parties/balances";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party balances", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      return ok(
        await listPartyBalances(party.actor, {
          status: sp.get("status"),
          locationId: sp.get("locationId"),
          dueBefore: sp.get("dueBefore"),
          depositUnpaidOnly: sp.get("depositUnpaidOnly") === "1" || sp.get("depositUnpaidOnly") === "true",
          take: sp.has("take") ? Number(sp.get("take")) : undefined,
          skip: sp.has("skip") ? Number(sp.get("skip")) : undefined,
        })
      );
    }
  );
}
