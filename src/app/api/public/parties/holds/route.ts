export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { created } from "@/lib/response";
import { readJsonBody } from "@/lib/parties/gate";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { createPublicPartyHold } from "@/lib/parties/publicParties";

export async function POST(request: NextRequest) {
  return withPublicPartyRoute(
    request,
    { route: "POST public parties hold", bucket: "public-parties-hold", limit: 20 },
    async () => {
      const body = rejectBodyOrgId(await readJsonBody(request));
      return created({
        hold: await createPublicPartyHold({
          orgSlug: String(body.orgSlug ?? ""),
          venueSlug: String(body.venueSlug ?? ""),
          productId: String(body.productId ?? ""),
          sessionId: String(body.sessionId ?? ""),
        }),
      });
    }
  );
}
