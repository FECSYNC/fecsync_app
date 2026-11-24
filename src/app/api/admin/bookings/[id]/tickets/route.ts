export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getBooking, listTicketsDto } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsRead); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "GET tickets", { permission: P.BookingsRead })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const booking = await getBooking(actor, id);
    return ok({ tickets: listTicketsDto(booking.credentials as any), bookingPublicId: booking.publicId });
  } catch (err) { return bookingRouteCatch(err, request, "GET tickets", actor, "Failed", P.BookingsRead); }
}
