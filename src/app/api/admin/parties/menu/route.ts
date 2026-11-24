export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { createPartyMenuItem, listPartyMenuItems, listPosProductsForMenu } from "@/lib/parties/menu";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party menu", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      if (sp.get("posProducts") === "1") {
        return ok({ posProducts: await listPosProductsForMenu(party.actor, sp.get("locationId") ?? "") });
      }
      return ok({
        items: await listPartyMenuItems(party.actor, {
          locationId: sp.get("locationId"),
          includeArchived: sp.get("includeArchived") === "1",
          availableOnly: sp.get("availableOnly") === "1",
        }),
      });
    }
  );
}

export async function POST(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "POST party menu", permission: P.PartiesManage },
    async (party) => {
      const body = await readJsonBody(request);
      return created({ item: await createPartyMenuItem(party.actor, body) });
    }
  );
}
