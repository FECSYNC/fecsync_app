export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import prisma from "@/lib/prisma";
import { listTicketsDto } from "@/lib/services/bookings";
import { TicketingError, BOOKING_NOT_FOUND } from "@/lib/ticketing/errors";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsReadOwn); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "GET me/tickets", { permission: P.BookingsReadOwn })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB();
    const { id } = await ctx.params;
    const row = await prisma.booking.findFirst({ where: { id, userId: actor.sub }, include: { credentials: true } });
    if (!row) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    return ok({ tickets: listTicketsDto(row.credentials) });
  } catch (err) { return bookingRouteCatch(err, request, "GET me/tickets", actor, "Failed", P.BookingsReadOwn); }
}
