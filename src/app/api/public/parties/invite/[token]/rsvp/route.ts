export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, badRequest } from "@/lib/response";
import { readJsonBody } from "@/lib/parties/gate";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { applyPartyRsvp } from "@/lib/parties/publicParties";

type Ctx = { params: Promise<{ token: string }> };

/** Accept (guest name, optional age) or decline. Idempotent per invitation. */
export async function POST(request: NextRequest, ctx: Ctx) {
  return withPublicPartyRoute(
    request,
    { route: "POST public party rsvp", bucket: "public-parties-rsvp", limit: 20 },
    async () => {
      const { token } = await ctx.params;
      const body = await readJsonBody(request);
      const accept = body.accept !== false;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (accept && !name) return badRequest("Guest name is required");
      return ok(
        await applyPartyRsvp(token, {
          accept,
          name,
          age: body.age == null || body.age === "" ? null : Number(body.age),
        })
      );
    }
  );
}
