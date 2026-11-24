export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermission } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { listBookingPayments } from "@/lib/services/bookings";
export async function GET(request: NextRequest) {
  let actor; try { actor = requirePermission(request, P.BookingsPaymentsRead); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "GET booking-payments", { permission: P.BookingsPaymentsRead })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB(); requireActorOrgId(actor);
    const sp = request.nextUrl.searchParams;
    const payments = await listBookingPayments(actor, { q: sp.get("q") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined, locationId: sp.get("locationId") || undefined });
    return ok({ payments });
  } catch (err) { return bookingRouteCatch(err, request, "GET booking-payments", actor, "Failed", P.BookingsPaymentsRead); }
}
