export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { getPartyFood, putPartyFoodDraft } from "@/lib/parties/food";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party food", permission: P.PartiesRead },
    async (party) => {
      const { bookingId } = await ctx.params;
      return ok(await getPartyFood(party.actor, bookingId));
    }
  );
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PUT party food", permission: P.PartiesFood },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({ orders: await putPartyFoodDraft(party.actor, bookingId, body) });
    }
  );
}
