export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyStaffRoute } from "@/lib/parties/gate";
import { listPartyHostCandidates } from "@/lib/parties/contacts";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET admin/parties/hosts", permission: P.PartiesRead },
    async (ctx) => ok({ hosts: await listPartyHostCandidates(ctx.actor) })
  );
}
