export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { getPartyRunSheet, putPartyRunSheet } from "@/lib/parties/runSheet";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party run-sheet", permission: P.PartiesRead },
    async (party) => {
      const { bookingId } = await ctx.params;
      return ok(await getPartyRunSheet(party.actor, bookingId));
    }
  );
}

async function replace(request: NextRequest, ctx: Ctx, route: string) {
  return withPartyStaffRoute(request, { route, permission: P.PartiesWrite }, async (party) => {
    const { bookingId } = await ctx.params;
    const body = rejectBodyOrgId(await readJsonBody(request));
    return ok(await putPartyRunSheet(party.actor, bookingId, body.items));
  });
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  return replace(request, ctx, "PUT party run-sheet");
}

/** Legacy alias of PUT. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return replace(request, ctx, "PATCH party run-sheet");
}
