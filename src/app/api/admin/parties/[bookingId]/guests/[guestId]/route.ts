export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { removePartyGuest, updatePartyGuest } from "@/lib/parties/guests";

type Ctx = { params: Promise<{ bookingId: string; guestId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party guest", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId, guestId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({ guest: await updatePartyGuest(party.actor, bookingId, guestId, body) });
    }
  );
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "DELETE party guest", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId, guestId } = await ctx.params;
      return ok(await removePartyGuest(party.actor, bookingId, guestId));
    }
  );
}
