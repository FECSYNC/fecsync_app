export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { editParty, getPartyForStaff, parseEditPartyBody } from "@/lib/parties/partyEngine";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET admin/parties/[bookingId]", permission: P.PartiesRead },
    async (party) => {
      rejectQueryOrgId(request.nextUrl.searchParams);
      const { bookingId } = await ctx.params;
      return ok({ party: await getPartyForStaff(party.actor, bookingId) });
    }
  );
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH admin/parties/[bookingId]", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = await readJsonBody(request);
      return ok({ party: await editParty(party.actor, bookingId, parseEditPartyBody(body)) });
    }
  );
}
