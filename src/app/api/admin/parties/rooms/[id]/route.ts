export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { updatePartyRoom } from "@/lib/parties/rooms";

type Ctx = { params: Promise<{ id: string }> };

/** Rename, capacity, archive / unarchive. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party room", permission: [P.TicketingResourcesWrite, P.PartiesManage], any: true },
    async (party) => {
      const { id } = await ctx.params;
      const body = await readJsonBody(request);
      return ok({ room: await updatePartyRoom(party.actor, id, body) });
    }
  );
}
