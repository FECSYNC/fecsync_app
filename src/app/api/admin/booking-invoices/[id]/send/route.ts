export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { sendBookingInvoice } from "@/lib/services/bookingInvoices";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingInvoicesSend); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST send invoice", { permission: P.BookingInvoicesSend })) ?? serverError("Failed to authorize"); }
  try { await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params; return ok({ invoice: await sendBookingInvoice(actor, id) }); }
  catch (err) { return bookingRouteCatch(err, request, "POST send invoice", actor, "Failed", P.BookingInvoicesSend); }
}
