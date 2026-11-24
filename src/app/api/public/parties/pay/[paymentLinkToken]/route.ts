export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { readJsonBody } from "@/lib/parties/gate";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { getPublicPartyPayLink, payPublicPartyPayLink } from "@/lib/parties/publicParties";

type Ctx = { params: Promise<{ paymentLinkToken: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPublicPartyRoute(
    request,
    { route: "GET public party pay link", bucket: "public-parties-pay-get", limit: 30 },
    async () => {
      const { paymentLinkToken } = await ctx.params;
      return ok(await getPublicPartyPayLink(paymentLinkToken));
    }
  );
}

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPublicPartyRoute(
    request,
    { route: "POST public party pay link", bucket: "public-parties-pay-post", limit: 20 },
    async () => {
      const { paymentLinkToken } = await ctx.params;
      const body = await readJsonBody(request);
      return ok(
        await payPublicPartyPayLink(
          paymentLinkToken,
          body.amount != null && body.amount !== "" ? Number(body.amount) : undefined
        )
      );
    }
  );
}
