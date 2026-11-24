export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { takeBookingPayments } from "@/lib/services/bookings";
export async function POST(request: NextRequest) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingsPaymentsTake); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST payment/booking", { permission: P.BookingsPaymentsTake })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor);
    const result = await takeBookingPayments(actor, String(body.bookingId ?? ""), [{ type: "card", amount: Number(body.amount) }]);
    return ok(result);
  } catch (err) { return bookingRouteCatch(err, request, "POST payment/booking", actor, "Failed", P.BookingsPaymentsTake); }
}
