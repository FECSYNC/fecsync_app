export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/parties/gate";
import { withPartyHostRoute } from "@/lib/parties/meRoute";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { patchMyPartyGuests } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ id: string }> };

/** Replace own guest list (allowHostEditGuestList). Kind defaults to kid; caps enforced. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyHostRoute(
    request,
    { route: "PATCH me/parties/[id]/guests", permission: P.PartiesWriteOwn },
    async (userId) => {
      const { id } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({
        guests: await patchMyPartyGuests(userId, id, Array.isArray(body.guests) ? body.guests : []),
      });
    }
  );
}
