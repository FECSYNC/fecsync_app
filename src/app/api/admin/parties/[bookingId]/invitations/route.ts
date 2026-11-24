export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { createPartyInvitationForStaff, listPartyInvitations } from "@/lib/parties/invitations";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party invitations", permission: P.PartiesRead },
    async (party) => {
      const { bookingId } = await ctx.params;
      return ok({ invitations: await listPartyInvitations(party.actor, bookingId) });
    }
  );
}

/** Creates the token. `send: true` delivers through the booking email / SMS transport. */
export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "POST party invitations", permission: P.PartiesInvitations },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return created({
        invitation: await createPartyInvitationForStaff(party.actor, bookingId, body),
      });
    }
  );
}
