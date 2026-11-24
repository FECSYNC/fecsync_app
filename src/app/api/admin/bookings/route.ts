export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, created, badRequest } from "@/lib/response";
import { requirePermissionFresh, requireAnyPermission, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  authErrorToResponse, authAudit, serverError, bookingRouteCatch,
} from "@/lib/ticketing/bookingRoute";
import {
  listBookings, createBooking, parseCreateBookingBody,
} from "@/lib/services/bookings";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export async function GET(request: NextRequest) {
  let actor;
  // List reads: JWT permission + live ticketing gates inside listBookings.
  // Calendar-only seats may view the date-range list without full BookingsRead.
  try {
    actor = requireAnyPermission(request, [
      P.BookingsRead,
      P.BookingsCalendarRead,
    ]);
  } catch (err) {
    return authErrorToResponse(err, authAudit(request, "GET /api/admin/bookings", { permission: P.BookingsRead })) ?? serverError("Failed to authorize");
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const sp = request.nextUrl.searchParams;
    const filters = {
      status: (sp.get("status") as any) || undefined,
      locationId: sp.get("locationId") || undefined,
      q: sp.get("q") || undefined,
      amountDueOnly:
        sp.get("amountDueOnly") === "true" ||
        sp.get("amountDue") === "true" ||
        sp.get("amountDue") === "1",
      amountDue:
        sp.get("amountDue") === "true" || sp.get("amountDue") === "1",
      sessionId: sp.get("sessionId") || undefined,
      accountId: sp.get("accountId") || undefined,
      channel: (sp.get("channel") as any) || undefined,
      partyOnly: sp.get("partyOnly") === "true",
      productType: (sp.get("productType") as any) || undefined,
      visitDate: sp.get("visitDate") || undefined,
      visitFrom: sp.get("from") || sp.get("visitFrom") || undefined,
      visitTo: sp.get("to") || sp.get("visitTo") || undefined,
      assignedStaffUserId: sp.get("staffUserId") || sp.get("staffId") || undefined,
      includeClosed: sp.get("includeClosed") === "true",
    };
    if (sp.get("format") === "csv" || sp.get("format") === "json") {
      // Prefer dedicated export route; keep redirect for old bookmarks.
      const url = new URL(request.url);
      url.pathname = "/api/admin/bookings/export";
      return Response.redirect(url, 307);
    }
    const result = await listBookings(actor, {
      ...filters,
      skip: sp.get("skip") ? Number(sp.get("skip")) : undefined,
      take: sp.get("take") ? Number(sp.get("take")) : undefined,
    });
    return ok({
      bookings: result.bookings,
      total: result.total,
      take: result.take,
      skip: result.skip,
      orgId: String(actor.orgId),
    });
  } catch (err) {
    return bookingRouteCatch(err, request, "GET /api/admin/bookings", actor, "Failed to list bookings", P.BookingsRead);
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsCreate); }
  catch (err) {
    return authErrorToResponse(err, authAudit(request, "POST /api/admin/bookings", { permission: P.BookingsCreate })) ?? serverError("Failed to authorize");
  }
  let body: unknown;
  try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const input = parseCreateBookingBody(body);
    // Staff "New booking" is always at-venue. Online / account are stamped only by
    // public /book checkout. POS terminal may also use /api/pos/bookings (same engine).
    if (input.channel === "online" || input.channel === "account") {
      return badRequest(
        "Online and guest-account bookings are created when customers book on your public booking page. Use Create booking for at-venue / phone / POS staff entries, or the POS route for till sales."
      );
    }
    if (
      input.channel !== "phone" &&
      input.channel !== "walk_in" &&
      input.channel !== "pos"
    ) {
      input.channel = "walk_in";
    }
    if (input.allowOverbook) {
      await requirePermissionFresh(request, P.BookingsOverbook);
    }
    // Only marking exempt is privileged; omitting / false needs no tax_exempt grant.
    if (input.taxExempt === true) {
      await requirePermissionFresh(request, P.BookingsTaxExempt);
    }
    // Attaching a B2B booking account requires accounts read or write.
    if (input.accountId) {
      await requireAnyPermissionFresh(request, [
        P.BookingAccountsRead,
        P.BookingAccountsWrite,
      ]);
    }
    // Staff create: never trust client line unitPrice (catalog / session override only).
    input.lines = input.lines.map((line) => ({ ...line, unitPrice: null }));
    const booking = await createBooking(actor, input);
    logStaffActivityEntry(actor, {
      action: "Booking Created",
      entityType: "Booking",
      entityId: booking.id,
      description: `Created booking ${booking.publicId}`,
      request,
    });
    return created({ booking });
  } catch (err) {
    return bookingRouteCatch(err, request, "POST /api/admin/bookings", actor, "Failed to create booking", P.BookingsCreate);
  }
}
