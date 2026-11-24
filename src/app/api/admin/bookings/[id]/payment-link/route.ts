export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { createPaymentLink } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsPaymentsTake); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST payment-link", { permission: P.BookingsPaymentsTake })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { body = {}; }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    const link = await createPaymentLink(actor, id, {
      amount: body.amount != null ? Number(body.amount) : undefined,
      sendVia: Array.isArray(body.sendVia) ? body.sendVia : ["email"],
      to: body.to ? String(body.to) : undefined,
    });
    return ok({ link });
  } catch (err) { return bookingRouteCatch(err, request, "POST payment-link", actor, "Failed", P.BookingsPaymentsTake); }
}
