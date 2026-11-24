export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { updatePartyMenuItem } from "@/lib/parties/menu";

type Ctx = { params: Promise<{ id: string }> };

/** Edit, available toggle, archive / unarchive. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party menu item", permission: P.PartiesManage },
    async (party) => {
      const { id } = await ctx.params;
      const body = await readJsonBody(request);
      return ok({ item: await updatePartyMenuItem(party.actor, id, body) });
    }
  );
}
