export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { patchBookingTaxExemption } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsTaxExempt); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "PATCH tax-exemption", { permission: P.BookingsTaxExempt })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const booking = await patchBookingTaxExemption(actor, id, Boolean(body.taxExempt), body.reason ? String(body.reason) : null);
    return ok({ booking });
  } catch (err) { return bookingRouteCatch(err, request, "PATCH tax-exemption", actor, "Failed", P.BookingsTaxExempt); }
}
