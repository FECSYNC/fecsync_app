export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import prisma from "@/lib/prisma";
import { bookingInclude, cancelBooking, toGuestBookingDto } from "@/lib/services/bookings";
import { TicketingError, BOOKING_NOT_FOUND } from "@/lib/ticketing/errors";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWriteOwn); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST me/cancel", { permission: P.BookingsWriteOwn })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB();
    const { id } = await ctx.params;
    const row = await prisma.booking.findFirst({ where: { id, userId: actor.sub } });
    if (!row) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    await cancelBooking(
      { orgId: row.orgId, sub: actor.sub },
      id,
      {
        skipStaffGate: true,
        orgId: row.orgId,
        reason: "guest_cancel",
        guestCancel: true,
      }
    );
    const fresh = await prisma.booking.findFirstOrThrow({
      where: { id, userId: actor.sub },
      include: bookingInclude,
    });
    const dto = toGuestBookingDto(fresh);
    const settings = await resolveBookingSettings(fresh.orgId, fresh.locationId);
    return ok({ booking: { ...dto, timeFormat: settings.timeFormat } });
  } catch (err) { return bookingRouteCatch(err, request, "POST me/cancel", actor, "Failed", P.BookingsWriteOwn); }
}
