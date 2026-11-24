export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { assignCustomTicketIds, getBooking, logBookingActivity } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST ticket-ids", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const booking = await getBooking(actor, id);
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    const updated = await assignCustomTicketIds(booking.orgId, assignments, {
      bookingId: booking.id,
    });
    await logBookingActivity({ orgId: booking.orgId, locationId: booking.locationId, bookingId: booking.id, kind: "ticket_ids", payload: { count: updated.length }, actorUserId: actor.sub ?? null });
    return ok({ credentials: updated });
  } catch (err) { return bookingRouteCatch(err, request, "POST ticket-ids", actor, "Failed", P.BookingsWrite); }
}
