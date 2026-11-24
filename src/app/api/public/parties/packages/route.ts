export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, badRequest } from "@/lib/response";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { listPublicPartyPackages } from "@/lib/parties/publicParties";

export async function GET(request: NextRequest) {
  return withPublicPartyRoute(
    request,
    { route: "GET public parties packages", bucket: "public-parties-packages", limit: 120 },
    async () => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      const orgSlug = sp.get("orgSlug")?.trim() ?? "";
      const venueSlug = sp.get("venueSlug")?.trim() ?? "";
      if (!orgSlug || !venueSlug) return badRequest("orgSlug and venueSlug are required");
      return ok(await listPublicPartyPackages(orgSlug, venueSlug));
    }
  );
}
