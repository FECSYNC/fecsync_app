export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { getPartySettingsForStaff, patchPartySettings } from "@/lib/parties/settings";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party settings", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      return ok({ settings: await getPartySettingsForStaff(party.actor, sp.get("locationId")) });
    }
  );
}

export async function PATCH(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party settings", permission: P.PartiesManage },
    async (party) => {
      const body = await readJsonBody(request);
      return ok({ settings: await patchPartySettings(party.actor, body) });
    }
  );
}
