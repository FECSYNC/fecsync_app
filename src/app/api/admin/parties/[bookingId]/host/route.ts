export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { assignPartyHostStaff } from "@/lib/parties/partyEngine";
import { getPartySummary } from "@/lib/parties/summary";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party host", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      const hostStaffUserId =
        typeof body.hostStaffUserId === "string" && body.hostStaffUserId.trim()
          ? body.hostStaffUserId.trim()
          : null;
      await assignPartyHostStaff(party.actor, bookingId, hostStaffUserId);
      return ok({ summary: await getPartySummary(party.actor, bookingId) });
    }
  );
}
