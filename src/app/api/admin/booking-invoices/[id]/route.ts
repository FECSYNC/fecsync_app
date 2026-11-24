export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getBookingInvoice, patchBookingInvoice } from "@/lib/services/bookingInvoices";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingInvoicesRead); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "GET invoice", { permission: P.BookingInvoicesRead })) ?? serverError("Failed to authorize"); }
  try { await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params; return ok({ invoice: await getBookingInvoice(actor, id) }); }
  catch (err) { return bookingRouteCatch(err, request, "GET invoice", actor, "Failed", P.BookingInvoicesRead); }
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingInvoicesManage); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "PATCH invoice", { permission: P.BookingInvoicesManage })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try { await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params; return ok({ invoice: await patchBookingInvoice(actor, id, body) }); }
  catch (err) { return bookingRouteCatch(err, request, "PATCH invoice", actor, "Failed", P.BookingInvoicesManage); }
}
