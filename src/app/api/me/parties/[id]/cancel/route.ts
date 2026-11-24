export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/parties/gate";
import { withPartyHostRoute } from "@/lib/parties/meRoute";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { cancelMyParty } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ id: string }> };

/** Host cancel before hostCancelCutoffHours. Never refunds automatically. */
export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyHostRoute(
    request,
    { route: "POST me/parties/[id]/cancel", permission: P.PartiesWriteOwn },
    async (userId) => {
      const { id } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok(await cancelMyParty(userId, id, typeof body.reason === "string" ? body.reason : null));
    }
  );
}
