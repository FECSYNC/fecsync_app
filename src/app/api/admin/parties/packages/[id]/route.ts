export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { archivePartyPackage, getPartyPackage, updatePartyPackage } from "@/lib/parties/packages";

type Ctx = { params: Promise<{ id: string }> };
const WRITE = [P.TicketingProductsWrite, P.PartiesManage] as const;

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party package", permission: P.PartiesRead },
    async (party) => {
      const { id } = await ctx.params;
      return ok({ package: await getPartyPackage(party.actor, id) });
    }
  );
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party package", permission: WRITE, any: true },
    async (party) => {
      const { id } = await ctx.params;
      const body = await readJsonBody(request);
      return ok({ package: await updatePartyPackage(party.actor, id, body) });
    }
  );
}

/** Soft-archive (bookings keep their snapshots). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "DELETE party package", permission: [P.TicketingProductsDelete, P.PartiesManage], any: true },
    async (party) => {
      const { id } = await ctx.params;
      return ok({ package: await archivePartyPackage(party.actor, id) });
    }
  );
}
