export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { parseCreatePartyBody, quoteParty } from "@/lib/parties/partyEngine";

/** Create-wizard preview: price breakdown + tax, deposit + due dates, room conflict, session remaining. */
export async function POST(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "POST admin/parties/quote", permission: P.PartiesWrite },
    async (ctx) => {
      const body = await readJsonBody(request);
      return ok({ quote: await quoteParty(ctx.actor, parseCreatePartyBody({ partyName: "Quote", ...body })) });
    }
  );
}
