export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyHostRoute } from "@/lib/parties/meRoute";
import { listMyParties } from "@/lib/parties/owner";

export async function GET(request: NextRequest) {
  return withPartyHostRoute(
    request,
    { route: "GET me/parties", permission: P.PartiesReadOwn },
    async (userId) => ok({ parties: await listMyParties(userId) })
  );
}
