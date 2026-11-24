export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, created, badRequest } from "@/lib/response";
import { requirePermission, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { listBookingInvoices, createBookingInvoice } from "@/lib/services/bookingInvoices";
export async function GET(request: NextRequest) {
  let actor; try { actor = requirePermission(request, P.BookingInvoicesRead); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "GET invoices", { permission: P.BookingInvoicesRead })) ?? serverError("Failed to authorize"); }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const sp = request.nextUrl.searchParams;
    return ok({
      invoices: await listBookingInvoices(actor, {
        bookingId: sp.get("bookingId") || undefined,
        accountId: sp.get("accountId") || undefined,
      }),
    });
  }
  catch (err) { return bookingRouteCatch(err, request, "GET invoices", actor, "Failed", P.BookingInvoicesRead); }
}
export async function POST(request: NextRequest) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingInvoicesManage); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST invoices", { permission: P.BookingInvoicesManage })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try { await connectDB(); requireActorOrgId(actor); return created({ invoice: await createBookingInvoice(actor, String(body.bookingId ?? "")) }); }
  catch (err) { return bookingRouteCatch(err, request, "POST invoices", actor, "Failed", P.BookingInvoicesManage); }
}
