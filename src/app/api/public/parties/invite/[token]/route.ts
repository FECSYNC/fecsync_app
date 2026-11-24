export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { getPublicInvitation } from "@/lib/parties/publicParties";

type Ctx = { params: Promise<{ token: string }> };

/** Party name, honoree, date/time (venue TZ), venue name, RSVP status — nothing else. */
export async function GET(request: NextRequest, ctx: Ctx) {
  return withPublicPartyRoute(
    request,
    { route: "GET public party invite", bucket: "public-parties-invite", limit: 60 },
    async () => {
      const { token } = await ctx.params;
      return ok({ invitation: await getPublicInvitation(token) });
    }
  );
}
