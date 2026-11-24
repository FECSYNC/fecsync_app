export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyStaffRoute } from "@/lib/parties/gate";
import { markPartyInvitationBounced } from "@/lib/parties/invitations";

type Ctx = { params: Promise<{ bookingId: string; id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "POST party invitation bounced", permission: P.PartiesInvitations },
    async (party) => {
      const { bookingId, id } = await ctx.params;
      return ok({ invitation: await markPartyInvitationBounced(party.actor, bookingId, id) });
    }
  );
}
