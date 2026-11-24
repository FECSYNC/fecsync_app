/**
 * Guest payment request links.
 */
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import { requireId } from "@/lib/ids";
import {
  assertTicketingStaffMutate,
  assertLocationInHqScope,
  type TicketingActor,
} from "@/lib/ticketing/common";
import {
  TicketingError,
  BOOKING_NOT_FOUND,
  PAYMENT_INCOMPLETE,
  INVALID_STATUS_TRANSITION,
} from "@/lib/ticketing/errors";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { sendBookingSms } from "@/lib/ticketing/sms";
import { toNum, money } from "@/lib/ticketing/bookingEngine";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";

export async function createPaymentLink(
  actor: TicketingActor,
  bookingId: string,
  opts: {
    amount?: number;
    sendVia?: Array<"email" | "sms">;
    to?: string;
    expiresInHours?: number;
  } = {}
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const booking = await prisma.booking.findFirst({
    where: { id: requireId(bookingId, "bookingId"), orgId },
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertLocationInHqScope(actor, booking.locationId);
  if (
    !["hold", "reserved", "pending_payment", "confirmed", "draft"].includes(
      booking.status
    )
  ) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }

  const amountDue = toNum(booking.amountDue);
  if (!(amountDue > 0) && opts.amount == null) {
    throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  }
  let amount =
    opts.amount != null
      ? Math.round(Number(opts.amount) * 100) / 100
      : amountDue;
  if (amount > amountDue) amount = amountDue;
  if (!(amount > 0)) throw new TicketingError(PAYMENT_INCOMPLETE, 400);

  const expiresAt = new Date(
    Date.now() + (opts.expiresInHours ?? 72) * 3600_000
  );
  const to =
    opts.to?.trim() ||
    booking.primaryContactEmail ||
    booking.primaryContactPhone ||
    null;

  const link = await prisma.bookingPaymentLink.create({
    data: {
      token: newPublicToken(),
      orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      amountDue: money(amount),
      expiresAt,
      channel: opts.sendVia?.includes("sms") ? "sms" : "email",
      sentTo: to,
    },
  });

  await logBookingActivity({
    orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "system",
    payload: {
      event: "payment_link",
      paymentLinkId: link.id,
      // Never persist raw pay-link tokens in activity (staff BookingsRead could replay).
      tokenSuffix: link.token.slice(-4),
      amount,
      sendVia: opts.sendVia ?? ["email"],
      to,
    },
    actorUserId: actor.sub ?? null,
  });

  const base = publicAppBaseUrl();
  const payUrl = `${base}/booking/pay/${link.token}`;

  if (opts.sendVia?.includes("sms") && (opts.to || booking.primaryContactPhone)) {
    const sms = await sendBookingSms({
      to: opts.to || booking.primaryContactPhone!,
      body: `Pay your booking ${booking.publicId}: ${payUrl}`,
      orgId,
    });
    await logBookingActivity({
      orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "sms",
      payload: {
        template: "payment_link",
        to: opts.to || booking.primaryContactPhone,
        sent: sms.sent === true,
        skipped: sms.sent === false && sms.skipped === true,
        // Do not store SMS body — it contains the pay-link token URL.
      },
      actorUserId: actor.sub ?? null,
    });
  }

  const emailTo =
    (opts.sendVia?.includes("email") ?? true)
      ? opts.to?.includes("@")
        ? opts.to
        : booking.primaryContactEmail
      : null;
  if (emailTo) {
    if (process.env.NOTIFICATION_EMAIL_USER?.trim()) {
      try {
        const { sendReceiptMail } = await import("@/lib/sendReceipts");
        await sendReceiptMail({
          to: emailTo,
          subject: `Payment request ${booking.publicId}`,
          orgId,
          data: {
            customerName: booking.primaryContactName || "Guest",
            receiptId: booking.publicId,
            amountPaid: amount,
            paymentMethod: "payment_link",
            date: new Date().toISOString(),
            payPath: `/booking/pay/${link.token}`,
          },
        });
        await logBookingActivity({
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "email",
          payload: { template: "payment_link", to: emailTo, ok: true },
          actorUserId: actor.sub ?? null,
        });
      } catch (err) {
        await logBookingActivity({
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "email",
          payload: {
            template: "payment_link",
            to: emailTo,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          },
          actorUserId: actor.sub ?? null,
        });
      }
    } else {
      await logBookingActivity({
        orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "email",
        payload: {
          template: "payment_link",
          to: emailTo,
          skipped: true,
          reason: "NOTIFICATION_EMAIL_USER unset",
        },
        actorUserId: actor.sub ?? null,
      });
    }
  }

  return {
    id: link.id,
    token: link.token,
    amountDue: amount,
    expiresAt: expiresAt.toISOString(),
    sentTo: to,
    payUrl,
  };
}

export async function getPaymentLinkByToken(token: string) {
  const link = await prisma.bookingPaymentLink.findFirst({
    where: { token },
    include: {
      booking: {
        select: {
          id: true,
          publicId: true,
          status: true,
          amountDue: true,
          total: true,
          primaryContactName: true,
        },
      },
    },
  });
  if (!link) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  const { assertOrganizationActive } = await import("@/lib/org");
  const { assertNotDemoPlanLocked } = await import("@/lib/demoPlanAssert");
  const { assertCompanyBillingEntitled } = await import("@/lib/planLimits");
  const { assertTicketingEnabled } = await import(
    "@/lib/ticketing/assertTicketingEnabled"
  );
  await assertOrganizationActive(link.orgId);
  await assertNotDemoPlanLocked(link.orgId);
  await assertCompanyBillingEntitled(link.orgId);
  await assertTicketingEnabled(link.orgId);
  if (link.expiresAt.getTime() <= Date.now()) {
    throw new TicketingError(PAYMENT_INCOMPLETE, 410);
  }
  if (
    !["hold", "reserved", "pending_payment", "confirmed", "draft"].includes(
      link.booking.status
    )
  ) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  if (toNum(link.booking.amountDue) <= 0) {
    throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  }
  return {
    token: link.token,
    amountDue: toNum(link.amountDue),
    expiresAt: link.expiresAt.toISOString(),
    booking: {
      publicId: link.booking.publicId,
      status: link.booking.status,
      amountDue: toNum(link.booking.amountDue),
      guest: link.booking.primaryContactName,
    },
  };
}

/** Public pay via payment link token. */
export async function payViaPaymentLink(
  token: string,
  opts: { amount?: number } = {}
) {
  const { settlePublicPaymentLink } = await import(
    "@/lib/ticketing/publicBooking"
  );
  return settlePublicPaymentLink(token, opts);
}
