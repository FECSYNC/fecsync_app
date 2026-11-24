export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { getPublicPartyConfirmation } from "@/lib/parties/publicParties";

type Ctx = { params: Promise<{ bookingPublicId: string }> };

/** Requires the booking viewToken (same rule as /api/public/booking/confirmation). */
export async function GET(request: NextRequest, ctx: Ctx) {
  return withPublicPartyRoute(
    request,
    { route: "GET public party confirmation", bucket: "public-parties-confirmation", limit: 60 },
    async () => {
      const { bookingPublicId } = await ctx.params;
      const viewToken = request.nextUrl.searchParams.get("viewToken") ?? "";
      return ok(await getPublicPartyConfirmation(bookingPublicId, viewToken));
    }
  );
}
