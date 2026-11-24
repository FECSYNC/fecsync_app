export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  authErrorToResponse,
  authAudit,
  serverError,
  bookingRouteCatch,
} from "@/lib/ticketing/bookingRoute";
import prisma from "@/lib/prisma";
import {
  bookingInclude,
  toGuestBookingDto,
} from "@/lib/ticketing/bookingEngine";
import { timeFormatsForVenues } from "@/lib/ticketing/settings";
import { DEFAULT_TIME_CLOCK_FORMAT } from "@/lib/timeClock";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingsReadOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET me/bookings", {
          permission: P.BookingsReadOwn,
        })
      ) ?? serverError("Failed to authorize")
    );
  }
  try {
    await connectDB();
    const rows = await prisma.booking.findMany({
      where: { userId: actor.sub, status: { notIn: ["draft"] } },
      include: bookingInclude,
      orderBy: { visitStartsAt: "desc" },
      take: 100,
    });
    const dtos = rows.map(toGuestBookingDto);
    const formats = await timeFormatsForVenues(
      dtos.map((b) => ({ orgId: b.orgId, locationId: b.locationId }))
    );
    return ok({
      bookings: dtos.map((b) => ({
        ...b,
        timeFormat:
          formats.get(`${b.orgId}:${b.locationId}`) ?? DEFAULT_TIME_CLOCK_FORMAT,
      })),
    });
  } catch (err) {
    return bookingRouteCatch(
      err,
      request,
      "GET me/bookings",
      actor,
      "Failed",
      P.BookingsReadOwn
    );
  }
}
