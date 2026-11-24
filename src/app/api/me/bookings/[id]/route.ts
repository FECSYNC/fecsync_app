export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, forbidden } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import prisma from "@/lib/prisma";
import { bookingInclude, toGuestBookingDto } from "@/lib/ticketing/bookingEngine";
import { TicketingError, BOOKING_NOT_FOUND } from "@/lib/ticketing/errors";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsReadOwn); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "GET me/booking", { permission: P.BookingsReadOwn })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB();
    const { id } = await ctx.params;
    const row = await prisma.booking.findFirst({ where: { id, userId: actor.sub }, include: bookingInclude });
    if (!row) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    const dto = toGuestBookingDto(row);
    const settings = await resolveBookingSettings(row.orgId, row.locationId);
    return ok({ booking: { ...dto, timeFormat: settings.timeFormat } });
  } catch (err) { return bookingRouteCatch(err, request, "GET me/booking", actor, "Failed", P.BookingsReadOwn); }
}
