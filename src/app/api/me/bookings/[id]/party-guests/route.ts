export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  authErrorToResponse,
  authAudit,
  serverError,
  bookingRouteCatch,
} from "@/lib/ticketing/bookingRoute";
import { patchPartyGuestsForOwner } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingsWriteOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH me/party-guests", {
          permission: P.BookingsWriteOwn,
        })
      ) ?? serverError("Failed to authorize")
    );
  }
  let body: { guests?: Array<{ name?: string; age?: number | null }> };
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    await connectDB();
    const { id } = await ctx.params;
    return ok(
      await patchPartyGuestsForOwner({
        bookingId: id,
        userId: actor.sub,
        guests: Array.isArray(body.guests) ? body.guests : [],
      })
    );
  } catch (err) {
    return bookingRouteCatch(
      err,
      request,
      "PATCH me/party-guests",
      actor,
      "Failed",
      P.BookingsWriteOwn
    );
  }
}
