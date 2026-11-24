/**
 * Booking confirmation + receipt email paths (Phase 3 UI live; keep template polish incremental).
 * Puppeteer mailers are loaded only when SMTP is configured — keeps smoke fast.
 */
import prisma from "@/lib/prisma";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { sendBookingSms } from "@/lib/ticketing/sms";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { issueBookingWaiverLink, settleBookingWaiverLink } from "@/lib/waivers/bookingHooks";

function emailTransportReady() {
  return Boolean(process.env.NOTIFICATION_EMAIL_USER?.trim());
}

async function isPartyBooking(bookingId: string): Promise<boolean> {
  const row = await prisma.partyBookingDetail.findUnique({
    where: { bookingId },
    select: { id: true },
  });
  return Boolean(row);
}

export async function sendBookingConfirmation(opts: {
  bookingId: string;
  force?: boolean;
}): Promise<{ sent: boolean; reason?: string }> {
  if (await isPartyBooking(opts.bookingId)) {
    const { sendPartyConfirmation } = await import("@/lib/parties/notifications");
    return sendPartyConfirmation(opts);
  }
  const booking = await prisma.booking.findFirst({
    where: { id: opts.bookingId },
    include: {
      location: { select: { name: true, timezone: true } },
      credentials: {
        where: { status: { not: "void" } },
        select: { code: true, qrPayload: true },
        take: 20,
      },
    },
  });
  if (!booking) return { sent: false, reason: "not_found" };
  if (booking.confirmationSentAt && !opts.force) {
    return { sent: false, reason: "already_sent" };
  }
  const to = booking.primaryContactEmail?.trim();
  if (!to) return { sent: false, reason: "no_email" };

  if (!emailTransportReady()) {
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "email",
      payload: {
        template: "confirmation",
        to,
        ok: false,
        skipped: true,
        reason: "NOTIFICATION_EMAIL_USER unset",
      },
    });
    return { sent: false, reason: "email_skipped" };
  }

  let waiverUrl: string | null = null;
  let waiverRequestId: string | null = null;
  try {
    const issued = await issueBookingWaiverLink(booking.id);
    waiverUrl = issued?.url ?? null;
    waiverRequestId = issued?.requestId ?? null;
  } catch (err) {
    console.error("[booking confirmation] waiver link skipped", err);
  }

  try {
    const { sendReceiptMail } = await import("@/lib/sendReceipts");
    await sendReceiptMail({
      to,
      subject: `Booking confirmation ${booking.publicId}`,
      orgId: booking.orgId,
      data: {
        customerName: booking.primaryContactName || "Guest",
        receiptId: booking.publicId,
        amountPaid: Number(booking.amountPaid.toString()),
        paymentMethod: "booking",
        date: new Date().toISOString(),
        magicPath: `/booking/magic/${booking.viewToken}`,
        confirmationPath: `/booking/confirmation/${booking.publicId}?viewToken=${encodeURIComponent(booking.viewToken)}`,
        ...(waiverUrl ? { waiverUrl } : {}),
      },
    });
  } catch (err) {
    console.error("[booking confirmation] email failed", err);
    if (waiverRequestId) {
      await settleBookingWaiverLink(waiverRequestId, false).catch((settleErr) => {
        console.error("[booking confirmation] waiver link cancel failed", settleErr);
      });
    }
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "email",
      payload: {
        template: "confirmation",
        to,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { sent: false, reason: "email_failed" };
  }

  if (waiverRequestId) {
    await settleBookingWaiverLink(waiverRequestId, true).catch((settleErr) => {
      console.error("[booking confirmation] waiver link settle failed", settleErr);
    });
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { confirmationSentAt: new Date() },
  });

  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "email",
    payload: { template: "confirmation", to, ok: true },
  });

  if (booking.primaryContactPhone) {
    const base = publicAppBaseUrl();
    const sms = await sendBookingSms({
      to: booking.primaryContactPhone,
      body: `Your booking ${booking.publicId} is confirmed. ${base}/booking/magic/${booking.viewToken}${waiverUrl ? ` Sign your waiver: ${waiverUrl}` : ""}`,
      orgId: booking.orgId,
    });
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "sms",
      payload: {
        template: "confirmation",
        to: booking.primaryContactPhone,
        sent: sms.sent === true,
        skipped: sms.sent === false && sms.skipped === true,
        // Do not store SMS body — it contains the magic viewToken URL.
      },
    });
  }

  if (booking.userId) {
    try {
      const { createNotification } = await import(
        "@/services/notificationService"
      );
      await createNotification(
        booking.userId,
        "Booking confirmed",
        `Booking ${booking.publicId} is confirmed.`,
        "system",
        { bookingId: booking.id, publicId: booking.publicId }
      );
    } catch {
      /* never fail confirmation on in-app notify */
    }
  }

  return { sent: true };
}

export async function sendBookingCancellation(opts: {
  bookingId: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (await isPartyBooking(opts.bookingId)) {
    const { sendPartyCancellation } = await import("@/lib/parties/notifications");
    return sendPartyCancellation(opts.bookingId);
  }
  const booking = await prisma.booking.findFirst({
    where: { id: opts.bookingId },
  });
  if (!booking) return { sent: false, reason: "not_found" };
  const to = booking.primaryContactEmail?.trim();
  if (to && emailTransportReady()) {
    try {
      const { sendReceiptMail } = await import("@/lib/sendReceipts");
      await sendReceiptMail({
        to,
        subject: `Booking cancelled ${booking.publicId}`,
        orgId: booking.orgId,
        data: {
          customerName: booking.primaryContactName || "Guest",
          receiptId: booking.publicId,
          amountPaid: Number(booking.amountPaid.toString()),
          paymentMethod: "cancelled",
          date: new Date().toISOString(),
        },
      });
      await logBookingActivity({
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "email",
        payload: { template: "cancellation", to, ok: true },
      });
    } catch (err) {
      console.error("[booking cancel] email failed", err);
    }
  } else if (to) {
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "email",
      payload: { template: "cancellation", to, skipped: true },
    });
  }
  if (booking.primaryContactPhone) {
    const sms = await sendBookingSms({
      to: booking.primaryContactPhone,
      body: `Booking ${booking.publicId} was cancelled.`,
      orgId: booking.orgId,
    });
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "sms",
      payload: { template: "cancellation", ...sms },
    });
  }
  if (booking.userId) {
    try {
      const { createNotification } = await import(
        "@/services/notificationService"
      );
      await createNotification(
        booking.userId,
        "Booking cancelled",
        `Booking ${booking.publicId} was cancelled.`,
        "system",
        { bookingId: booking.id, publicId: booking.publicId }
      );
    } catch {
      /* ignore */
    }
  }
  return { sent: true };
}

export async function sendBookingPaymentReceipt(opts: {
  bookingId: string;
  paymentId: string;
  force?: boolean;
}): Promise<{ sent: boolean; reason?: string }> {
  const payment = await prisma.bookingPayment.findFirst({
    where: { id: opts.paymentId, bookingId: opts.bookingId },
  });
  if (!payment) return { sent: false, reason: "not_found" };
  if (payment.receiptEmailSentAt && !opts.force) {
    return { sent: false, reason: "already_sent" };
  }

  const booking = await prisma.booking.findFirst({
    where: { id: opts.bookingId },
  });
  if (!booking) return { sent: false, reason: "not_found" };
  const to = booking.primaryContactEmail?.trim();
  if (!to) return { sent: false, reason: "no_email" };

  if (!emailTransportReady()) {
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "email",
      payload: {
        template: "receipt",
        to,
        paymentId: payment.id,
        ok: false,
        skipped: true,
      },
    });
    return { sent: false, reason: "email_skipped" };
  }

  try {
    const { sendReceiptMail } = await import("@/lib/sendReceipts");
    await sendReceiptMail({
      to,
      subject: `Payment receipt ${booking.publicId}`,
      orgId: booking.orgId,
      data: {
        customerName: booking.primaryContactName || "Guest",
        receiptId: payment.id,
        amountPaid: Number(payment.amount.toString()),
        paymentMethod: payment.tender,
        date: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[booking receipt] email failed", err);
    return { sent: false, reason: "email_failed" };
  }

  await prisma.bookingPayment.update({
    where: { id: payment.id },
    data: { receiptEmailSentAt: new Date() },
  });

  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "email",
    payload: {
      template: "receipt",
      to,
      paymentId: payment.id,
      ok: true,
    },
  });

  if (booking.userId) {
    try {
      const { createNotification } = await import(
        "@/services/notificationService"
      );
      await createNotification(
        booking.userId,
        "Payment received",
        `Payment recorded for booking ${booking.publicId}.`,
        "system",
        { bookingId: booking.id, publicId: booking.publicId }
      );
    } catch {
      /* optional */
    }
  }

  return { sent: true };
}
