export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyHostRoute } from "@/lib/parties/meRoute";
import { createMyPartyPayLink } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyHostRoute(
    request,
    { route: "POST me/parties/[id]/pay", permission: P.PartiesWriteOwn },
    async (userId) => {
      const { id } = await ctx.params;
      return created(await createMyPartyPayLink(userId, id));
    }
  );
}
