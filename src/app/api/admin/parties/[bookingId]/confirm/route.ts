export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { confirmParty } from "@/lib/parties/partyEngine";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "POST admin/parties/[bookingId]/confirm", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      const overrideReason =
        body.depositOverrideReason === undefined && body.overrideReason === undefined
          ? undefined
          : String(body.depositOverrideReason ?? body.overrideReason ?? "");
      return ok({ party: await confirmParty(party.actor, bookingId, { overrideReason }) });
    }
  );
}
