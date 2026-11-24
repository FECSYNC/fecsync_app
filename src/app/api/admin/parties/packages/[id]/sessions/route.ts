export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { createPartyPackageSessions, listPartyPackageSessions } from "@/lib/parties/packages";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party package sessions", permission: P.PartiesRead },
    async (party) => {
      const { id } = await ctx.params;
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      return ok({
        sessions: await listPartyPackageSessions(party.actor, id, {
          from: sp.get("from") ?? undefined,
          to: sp.get("to") ?? undefined,
          includeClosed: sp.get("includeClosed") === "1",
        }),
      });
    }
  );
}

/** Single slot or weekday series (`weekdays` + `untilDate`) via ticketing/sessions. */
export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    {
      route: "POST party package sessions",
      permission: [P.TicketingSessionsWrite, P.PartiesManage],
      any: true,
    },
    async (party) => {
      const { id } = await ctx.params;
      const body = await readJsonBody(request);
      return created({ sessions: await createPartyPackageSessions(party.actor, id, body) });
    }
  );
}
