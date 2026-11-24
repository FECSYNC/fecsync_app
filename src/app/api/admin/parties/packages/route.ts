export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { createPartyPackage, listPartyPackages } from "@/lib/parties/packages";

/** party_package CRUD: ticketing product write (catalog editors) or parties:manage. */
const PARTY_PACKAGE_WRITE = [P.TicketingProductsWrite, P.PartiesManage] as const;

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET party packages", permission: P.PartiesRead },
    async (party) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      return ok({
        packages: await listPartyPackages(party.actor, {
          locationId: sp.get("locationId"),
          status: sp.get("status"),
        }),
      });
    }
  );
}

export async function POST(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "POST party packages", permission: PARTY_PACKAGE_WRITE, any: true },
    async (party) => {
      const body = await readJsonBody(request);
      return created({ package: await createPartyPackage(party.actor, body) });
    }
  );
}
