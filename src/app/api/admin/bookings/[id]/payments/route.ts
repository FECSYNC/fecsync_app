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
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsPaymentsTake); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST payments", { permission: P.BookingsPaymentsTake })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const tenders = Array.isArray(body.tenders) ? body.tenders : [];
    if (tenders.some((t: { type?: string }) => t?.type === "stored_card")) {
      await requirePermissionFresh(request, P.BookingsChargeStored);
    }
    const result = await takeBookingPayments(actor, id, tenders.map((t: any) => ({
      type: t.type,
      amount: Number(t.amount),
      giftCardCode: t.giftCardCode,
      storedPaymentMethodId: t.storedPaymentMethodId,
    })));
    return ok(result);
  } catch (err) { return bookingRouteCatch(err, request, "POST payments", actor, "Failed", P.BookingsPaymentsTake); }
}
