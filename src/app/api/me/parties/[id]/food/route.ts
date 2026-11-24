export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/parties/gate";
import { withPartyHostRoute } from "@/lib/parties/meRoute";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { putMyPartyFood } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ id: string }> };

/** Host food draft (allowHostEditFood, before the cutoff; menu prices only). */
export async function PUT(request: NextRequest, ctx: Ctx) {
  return withPartyHostRoute(
    request,
    { route: "PUT me/parties/[id]/food", permission: P.PartiesWriteOwn },
    async (userId) => {
      const { id } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({ orders: await putMyPartyFood(userId, id, body) });
    }
  );
}
