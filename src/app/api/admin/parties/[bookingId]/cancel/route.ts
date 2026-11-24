export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { cancelParty } from "@/lib/parties/partyEngine";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "POST admin/parties/[bookingId]/cancel", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({
        party: await cancelParty(party.actor, bookingId, {
          reason: typeof body.reason === "string" ? body.reason : null,
        }),
      });
    }
  );
}
