export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyHostRoute } from "@/lib/parties/meRoute";
import { getMyParty } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyHostRoute(
    request,
    { route: "GET me/parties/[id]", permission: P.PartiesReadOwn },
    async (userId) => {
      const { id } = await ctx.params;
      return ok(await getMyParty(userId, id));
    }
  );
}
