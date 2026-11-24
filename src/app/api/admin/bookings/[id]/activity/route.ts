export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, created } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getBooking, logBookingActivity } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST activity", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const booking = await getBooking(actor, id);
    const kind = ["call","email","note","sms"].includes(String(body.kind)) ? String(body.kind) : "note";
    const row = await logBookingActivity({
      orgId: booking.orgId, locationId: booking.locationId, bookingId: booking.id,
      kind: kind as any,
      payload: body.payload && typeof body.payload === "object" ? body.payload : { summary: body.summary, direction: body.direction, time: body.time },
      actorUserId: actor.sub ?? null,
    });
    return created({ activity: row });
  } catch (err) { return bookingRouteCatch(err, request, "POST activity", actor, "Failed", P.BookingsWrite); }
}
