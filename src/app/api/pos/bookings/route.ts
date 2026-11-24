export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { created, badRequest } from "@/lib/response";
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertPosEnabled } from "@/lib/pos/assertPosEnabled";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { createBooking, parseCreateBookingBody } from "@/lib/services/bookings";
import { createPartyFromPos, isPartyPackageProduct } from "@/lib/parties/posAdapter";
import { partyErrorToResponse } from "@/lib/parties/errors";
export async function POST(request: NextRequest) {
  let actor; try { actor = await requirePermissionFresh(request, P.BookingsCreate); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "POST pos/bookings", { permission: P.BookingsCreate })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertPosEnabled(orgId);
    const input = parseCreateBookingBody({ ...body, channel: "pos" });
    if (input.allowOverbook) await requirePermissionFresh(request, P.BookingsOverbook);
    if (input.taxExempt === true) {
      await requirePermissionFresh(request, P.BookingsTaxExempt);
    }
    if (input.accountId) {
      await requireAnyPermissionFresh(request, [
        P.BookingAccountsRead,
        P.BookingAccountsWrite,
      ]);
    }
    const partyFlags = await Promise.all(
      input.lines.map((line) => isPartyPackageProduct(orgId, line.productId))
    );
    if (partyFlags.some(Boolean)) {
      // Party packages are created by the party engine, one party per request.
      if (input.lines.length !== 1) {
        return badRequest("Book a party package on its own (add-ons belong on the party)");
      }
      const line = input.lines[0]!;
      const party = await createPartyFromPos(actor, {
        locationId: input.locationId,
        admissionProductId: line.productId,
        sessionId: line.sessionId ?? null,
        modifiers: {
          partyKidCount: body.kidCount,
          partyAdultCount: body.adultCount,
          partyName: body.partyName,
          honoreeName: body.honoreeName,
        },
        guestName: input.primaryContactName,
        guestEmail: input.primaryContactEmail,
        guestPhone: input.primaryContactPhone,
        holdIds: input.holdIds,
      });
      return created({ party });
    }
    // Till create: catalog pricing only — ignore client unitPrice overrides.
    input.lines = input.lines.map((line) => ({ ...line, unitPrice: null }));
    return created({ booking: await createBooking(actor, input) });
  } catch (err) {
    return (
      partyErrorToResponse(err) ??
      bookingRouteCatch(err, request, "POST pos/bookings", actor, "Failed", P.BookingsCreate)
    );
  }
}
