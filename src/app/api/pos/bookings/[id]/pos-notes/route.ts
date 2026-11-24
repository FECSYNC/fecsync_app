export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertPosEnabled } from "@/lib/pos/assertPosEnabled";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { patchBookingPosNotes } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "PATCH pos notes", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    await assertPosEnabled(requireActorOrgId(actor));
    const { id } = await ctx.params;
    return ok({ booking: await patchBookingPosNotes(actor, id, body.posNotes == null ? null : String(body.posNotes)) });
  } catch (err) { return bookingRouteCatch(err, request, "PATCH pos notes", actor, "Failed", P.BookingsWrite); }
}
