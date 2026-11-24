export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { cancelBookingInvoice } from "@/lib/services/bookingInvoices";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingInvoicesManage); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST cancel invoice", { permission: P.BookingInvoicesManage })) ?? serverError("Failed to authorize"); }
  try { await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params; return ok({ invoice: await cancelBookingInvoice(actor, id) }); }
  catch (err) { return bookingRouteCatch(err, request, "POST cancel invoice", actor, "Failed", P.BookingInvoicesManage); }
}
