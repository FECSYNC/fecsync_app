export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { refundBooking } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsRefund); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST refunds", { permission: P.BookingsRefund })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const result = await refundBooking(actor, id, {
      amount: Number(body.amount),
      method: body.method === "gift_card" ? "gift_card" : "original",
      reason: body.reason ? String(body.reason) : undefined,
    });
    return ok(result);
  } catch (err) { return bookingRouteCatch(err, request, "POST refunds", actor, "Failed", P.BookingsRefund); }
}
