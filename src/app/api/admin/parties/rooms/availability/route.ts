export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { partyRoomAvailability } from "@/lib/parties/rooms";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party room availability", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      return ok(
        await partyRoomAvailability(party.actor, {
          locationId: sp.get("locationId"),
          startsAt: sp.get("startsAt") ?? "",
          endsAt: sp.get("endsAt") ?? "",
          excludeBookingId: sp.get("excludeBookingId"),
        })
      );
    }
  );
}
