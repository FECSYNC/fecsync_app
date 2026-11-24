export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, badRequest } from "@/lib/response";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { publicPartyAvailability } from "@/lib/parties/publicParties";

export async function GET(request: NextRequest) {
  return withPublicPartyRoute(
    request,
    { route: "GET public parties availability", bucket: "public-parties-availability", limit: 120 },
    async () => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      const orgSlug = sp.get("orgSlug")?.trim() ?? "";
      const venueSlug = sp.get("venueSlug")?.trim() ?? "";
      const productId = sp.get("productId")?.trim() ?? "";
      if (!orgSlug || !venueSlug || !productId) {
        return badRequest("orgSlug, venueSlug, and productId are required");
      }
      const kids = sp.get("kids");
      const adults = sp.get("adults");
      return ok(
        await publicPartyAvailability({
          orgSlug,
          venueSlug,
          productId,
          date: sp.get("date") ?? undefined,
          from: sp.get("from") ?? undefined,
          to: sp.get("to") ?? undefined,
          kids: kids == null ? undefined : Number(kids),
          adults: adults == null ? undefined : Number(adults),
        })
      );
    }
  );
}
