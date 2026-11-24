export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { addPartyGuest, listPartyGuests, replacePartyGuestsForStaff } from "@/lib/parties/guests";

type Ctx = { params: Promise<{ bookingId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party guests", permission: P.PartiesRead },
    async (party) => {
      const { bookingId } = await ctx.params;
      return ok({ guests: await listPartyGuests(party.actor, bookingId) });
    }
  );
}

export async function POST(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "POST party guests", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return created({ guest: await addPartyGuest(party.actor, bookingId, body) });
    }
  );
}

/** Legacy full replace (kept for existing clients). */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "PATCH party guests", permission: P.PartiesWrite },
    async (party) => {
      const { bookingId } = await ctx.params;
      const body = rejectBodyOrgId(await readJsonBody(request));
      return ok({
        guests: await replacePartyGuestsForStaff(
          party.actor,
          bookingId,
          Array.isArray(body.guests) ? body.guests : []
        ),
      });
    }
  );
}
