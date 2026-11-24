export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertPosEnabled } from "@/lib/pos/assertPosEnabled";
import {
  authErrorToResponse,
  authAudit,
  serverError,
  bookingRouteCatch,
} from "@/lib/ticketing/bookingRoute";
import {
  getBooking,
  patchBookingPosNotes,
  replaceBookingLines,
} from "@/lib/services/bookings";
import { rejectClientOrgFields } from "@/lib/ticketing/common";
import { requireOrgBookingAccount } from "@/lib/ticketing/accounts";
import prisma from "@/lib/prisma";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import {
  assertBookingNotPastLocked,
  money,
  toNum,
} from "@/lib/ticketing/bookingEngine";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { previewBookingTax } from "@/lib/ticketing/tax";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH pos/booking", { permission: P.BookingsWrite })
      ) ?? serverError("Failed to authorize")
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    await connectDB();
    await assertPosEnabled(requireActorOrgId(actor));
    const { id } = await ctx.params;
    rejectClientOrgFields(body);

    if (
      body.accountId !== undefined &&
      body.accountId != null &&
      body.accountId !== ""
    ) {
      await requireOrgBookingAccount(String(actor.orgId), String(body.accountId));
    }

    if (body.posNotes !== undefined && Object.keys(body).length === 1) {
      return ok({
        booking: await patchBookingPosNotes(
          actor,
          id,
          body.posNotes == null ? null : String(body.posNotes)
        ),
      });
    }

    if (Array.isArray(body.lines)) {
      if (body.allowOverbook) {
        await requirePermissionFresh(request, P.BookingsOverbook);
      }
      const lines = (body.lines as Array<Record<string, unknown>>).map((l) => ({
        productId: String(l.productId ?? ""),
        priceBandCode:
          l.priceBandCode == null ? null : String(l.priceBandCode),
        qty: Number(l.qty ?? 1),
        unitPrice:
          l.unitPrice == null || l.unitPrice === ""
            ? null
            : Number(l.unitPrice),
        sessionId:
          l.sessionId == null || l.sessionId === ""
            ? null
            : String(l.sessionId),
        resourceId:
          l.resourceId == null || l.resourceId === ""
            ? null
            : String(l.resourceId),
        visitDate:
          l.visitDate == null || l.visitDate === ""
            ? null
            : String(l.visitDate),
      }));
      return ok({
        booking: await replaceBookingLines(actor, id, lines, {
          allowOverbook: Boolean(body.allowOverbook),
        }),
      });
    }

    const booking = await getBooking(actor, id);
    const settings = await resolveBookingSettings(
      booking.orgId,
      booking.locationId
    );
    const structural =
      body.primaryContactName !== undefined ||
      body.primaryContactEmail !== undefined ||
      body.primaryContactPhone !== undefined ||
      body.accountId !== undefined ||
      body.costs !== undefined ||
      body.posNotes !== undefined;
    if (structural) {
      const row = await prisma.booking.findFirst({ where: { id: booking.id } });
      if (
        row &&
        (body.costs !== undefined ||
          body.primaryContactName !== undefined ||
          body.accountId !== undefined)
      ) {
        await assertBookingNotPastLocked(row, settings.pastEditGraceMinutes);
      }
    }

    await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (body.primaryContactName !== undefined) {
        data.primaryContactName =
          body.primaryContactName == null
            ? null
            : String(body.primaryContactName);
      }
      if (body.primaryContactEmail !== undefined) {
        data.primaryContactEmail =
          body.primaryContactEmail == null
            ? null
            : String(body.primaryContactEmail);
      }
      if (body.primaryContactPhone !== undefined) {
        data.primaryContactPhone =
          body.primaryContactPhone == null
            ? null
            : String(body.primaryContactPhone);
      }
      if (body.accountId !== undefined) {
        data.accountId =
          body.accountId == null || body.accountId === ""
            ? null
            : String(body.accountId);
      }
      if (body.posNotes !== undefined) {
        data.posNotes =
          body.posNotes == null ? null : String(body.posNotes);
      }

      if (Array.isArray(body.costs)) {
        for (const c of body.costs as Array<Record<string, unknown>>) {
          const line = booking.lines.find(
            (l) => l.id === String(c.lineId ?? "")
          );
          if (!line) continue;
          const unitPrice = Number(c.unitPrice);
          const lineTotal = Math.round(unitPrice * line.qty * 100) / 100;
          await tx.bookingLine.update({
            where: { id: line.id },
            data: {
              unitPrice: money(unitPrice),
              lineTotal: money(lineTotal),
            },
          });
        }
        const freshLines = await tx.bookingLine.findMany({
          where: { bookingId: booking.id },
        });
        const subtotal = freshLines.reduce(
          (s, l) => s + toNum(l.lineTotal),
          0
        );
        const tax = await previewBookingTax({
          orgId: booking.orgId,
          subtotal,
          taxExempt: booking.taxExempt,
        });
        data.subtotal = money(subtotal);
        data.taxAmount = money(tax.taxAmount);
        data.total = money(tax.total);
        data.amountDue = money(Math.max(0, tax.total - booking.amountPaid));
      }

      if (Object.keys(data).length) {
        await tx.booking.update({
          where: { id: booking.id },
          data: data as never,
        });
        await logBookingActivity(
          {
            orgId: booking.orgId,
            locationId: booking.locationId,
            bookingId: booking.id,
            kind: "edited",
            payload: { fields: Object.keys(data), channel: "pos" },
            actorUserId: actor.sub ?? null,
          },
          tx
        );
      }
    });

    return ok({ booking: await getBooking(actor, id) });
  } catch (err) {
    return bookingRouteCatch(
      err,
      request,
      "PATCH pos/booking",
      actor,
      "Failed",
      P.BookingsWrite
    );
  }
}
