export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { cancelPartyFood } from "@/lib/parties/food";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "POST party food cancel", permission: P.PartiesFood },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({ orders: await cancelPartyFood(party.actor, bookingId, body) });
    }
  );
}
