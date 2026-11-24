export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { updatePassExpiry, getBooking, logBookingActivity } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "PATCH pass-expiry", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const booking = await getBooking(actor, id);
    const cred = await updatePassExpiry(booking.orgId, String(body.credentialId ?? ""), body.passExpiresAt ? new Date(String(body.passExpiresAt)) : null);
    await logBookingActivity({ orgId: booking.orgId, locationId: booking.locationId, bookingId: booking.id, kind: "edited", payload: { event: "pass_expiry", credentialId: cred.id }, actorUserId: actor.sub ?? null });
    return ok({ credential: cred });
  } catch (err) { return bookingRouteCatch(err, request, "PATCH pass-expiry", actor, "Failed", P.BookingsWrite); }
}
