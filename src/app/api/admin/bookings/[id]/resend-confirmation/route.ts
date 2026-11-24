export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getBooking, sendBookingConfirmation } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST resend-confirmation", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    await getBooking(actor, id);
    const result = await sendBookingConfirmation({ bookingId: id, force: true });
    return ok(result);
  } catch (err) { return bookingRouteCatch(err, request, "POST resend-confirmation", actor, "Failed", P.BookingsWrite); }
}
