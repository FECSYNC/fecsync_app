export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  authErrorToResponse,
  authAudit,
  serverError,
  bookingRouteCatch,
} from "@/lib/ticketing/bookingRoute";
import { apiRateLimited } from "@/lib/rateLimit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  collectBookingsForExport,
  rowsToCsv,
  type BookingExportFilters,
} from "@/lib/ticketing/bookingExport";
import type { AdmissionProductType, BookingChannel, BookingStatus } from "@prisma/client";

function parseFilters(sp: URLSearchParams): BookingExportFilters {
  const amountDueRaw = sp.get("amountDue");
  const amountDue =
    amountDueRaw === "true" ||
    amountDueRaw === "1" ||
    amountDueRaw === "yes";
  return {
    status: (sp.get("status") as BookingStatus) || undefined,
    locationId: sp.get("locationId") || undefined,
    q: sp.get("q") || undefined,
    amountDueOnly: sp.get("amountDueOnly") === "true" || amountDue,
    amountDue,
    sessionId: sp.get("sessionId") || undefined,
    accountId: sp.get("accountId") || undefined,
    channel: (sp.get("channel") as BookingChannel) || undefined,
    partyOnly: sp.get("partyOnly") === "true",
    productType: (sp.get("productType") as AdmissionProductType) || undefined,
    visitDate: sp.get("visitDate") || undefined,
    visitFrom: sp.get("from") || sp.get("visitFrom") || undefined,
    visitTo: sp.get("to") || sp.get("visitTo") || undefined,
    assignedStaffUserId: sp.get("staffUserId") || sp.get("staffId") || undefined,
  };
}

/**
 * GET /api/admin/bookings/export?format=csv|json
 * Permission: bookings:export. Redacted columns only.
 */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingsExport);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/bookings/export", {
          permission: P.BookingsExport,
        })
      ) ?? serverError("Failed to authorize")
    );
  }
  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const limited = apiRateLimited(
      request,
      "bookings-export",
      12,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    const sp = request.nextUrl.searchParams;
    if (sp.has("orgId") || sp.has("organizationId")) {
      return badRequest("Unsupported export fields in query");
    }
    const formatRaw = (sp.get("format") || "csv").toLowerCase();
    if (formatRaw !== "csv" && formatRaw !== "json") {
      return badRequest("format must be csv or json");
    }
    const format = formatRaw as "csv" | "json";
    const filters = parseFilters(sp);
    const rows = await collectBookingsForExport(actor, filters);
    logStaffActivityEntry(actor, {
      action: "Bookings Exported",
      entityType: "Booking",
      entityId: orgId,
      description: `Exported ${rows.length} bookings as ${format}`,
      request,
      metadata: {
        domain: "bookings-export",
        format,
        rowCount: rows.length,
        filters: {
          status: filters.status ?? null,
          locationId: filters.locationId ?? null,
          channel: filters.channel ?? null,
          sessionId: filters.sessionId ?? null,
          accountId: filters.accountId ?? null,
          visitFrom: filters.visitFrom ?? null,
          visitTo: filters.visitTo ?? null,
          staffUserId: filters.assignedStaffUserId ?? null,
          amountDue: Boolean(filters.amountDue || filters.amountDueOnly),
          hasQuery: Boolean(filters.q),
        },
      },
    });

    if (format === "json") {
      return ok({
        exportedAt: new Date().toISOString(),
        count: rows.length,
        bookings: rows,
      });
    }

    return new Response(rowsToCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=bookings.csv",
      },
    });
  } catch (err) {
    return bookingRouteCatch(
      err,
      request,
      "GET /api/admin/bookings/export",
      actor,
      "Failed to export bookings",
      P.BookingsExport
    );
  }
}
