export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { createPartyRoom, listPartyRooms } from "@/lib/parties/rooms";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party rooms", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      return ok({
        rooms: await listPartyRooms(party.actor, {
          locationId: sp.get("locationId"),
          includeArchived: sp.get("includeArchived") === "1",
        }),
      });
    }
  );
}

export async function POST(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "POST party rooms", permission: [P.TicketingResourcesWrite, P.PartiesManage], any: true },
    async (party) => {
      const body = await readJsonBody(request);
      return created({ room: await createPartyRoom(party.actor, body) });
    }
  );
}
