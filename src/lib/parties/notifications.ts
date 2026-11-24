/**
 * Party transactional notices (email via the org-branded guest mailer, SMS via
 * the env-gated booking SMS adapter, in-app Notification type `party`).
 * A failed email or a missing SMS provider never fails the booking, payment,
 * or RSVP — every attempt is logged to BookingActivity instead.
 */
import moment from "moment-timezone";
import prisma from "@/lib/prisma";
import { guestMailConfigured, sendBrandedGuestEmail } from "@/lib/mailer";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { sendBookingSms } from "@/lib/ticketing/sms";
import { toCents } from "@/lib/parties/deposits";

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPartyWhen(iso: Date | string | null | undefined, timezone: string | null | undefined): string {
  if (!iso) return "Date to be confirmed";
  const m = moment(iso).tz(timezone || "UTC");
  return `${m.format("dddd, MMMM D, YYYY [at] h:mm A")} (${m.format("z")})`;
}

function money(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

function abs(path: string): string {
  return `${publicAppBaseUrl()}${path}`;
}

async function loadNoticeParty(bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId },
    include: {
      location: { select: { name: true, timezone: true } },
      partyDetail: {
        include: {
          roomResource: { select: { name: true } },
          packageProduct: { select: { name: true } },
        },
      },
    },
  });
}

type NoticeParty = NonNullable<Awaited<ReturnType<typeof loadNoticeParty>>>;

function detailsHtml(b: NoticeParty): string {
  const d = b.partyDetail!;
  const rows: Array<[string, string]> = [
    ["Party", d.partyName],
    ...(d.honoreeName ? ([["Celebrating", `${d.honoreeName}${d.honoreeAge != null ? ` (${d.honoreeAge})` : ""}`]] as Array<[string, string]>) : []),
    ["When", formatPartyWhen(b.visitStartsAt, b.location?.timezone)],
    ["Venue", b.location?.name ?? ""],
    ...(d.roomResource?.name || d.roomNameSnapshot ? ([["Room", d.roomResource?.name ?? d.roomNameSnapshot ?? ""]] as Array<[string, string]>) : []),
    ["Guests", `${d.kidCount} kids${d.adultCount ? `, ${d.adultCount} adults` : ""}`],
    ["Reference", b.publicId],
  ];
  return `<div class="success-box">${rows
    .map(([k, v], i) => `<p style="margin:${i ? "8px 0 0" : "0"};"><strong>${esc(k)}:</strong> ${esc(v)}</p>`)
    .join("")}</div>`;
}

function moneyHtml(b: NoticeParty): string {
  const d = b.partyDetail!;
  const due = toCents(b.amountDue);
  return `<p style="margin:16px 0 0;">Total ${money(toCents(b.total))} · Paid ${money(toCents(b.amountPaid))} · Balance due <strong>${money(due)}</strong></p>${
    d.depositRequiredCents > 0
      ? `<p style="margin:4px 0 0;">Deposit ${money(d.depositRequiredCents)} (paid ${money(d.depositPaidCents)})</p>`
      : ""
  }`;
}

async function openPayPath(bookingId: string): Promise<string | null> {
  const link = await prisma.bookingPaymentLink.findFirst({
    where: { bookingId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  return link ? `/booking/pay/${encodeURIComponent(link.token)}` : null;
}

function linksHtml(links: Array<[string, string | null]>): string {
  const parts = links
    .filter(([, href]) => href)
    .map(([label, href]) => `<a href="${esc(abs(href!))}" style="color:#D4AF37;font-weight:600;">${esc(label)}</a>`);
  return parts.length ? `<p style="margin:16px 0 0;">${parts.join(" · ")}</p>` : "";
}

/** In-app notice to the linked host account (never creates a user). True when a notice was stored. */
export async function notifyPartyHost(
  bookingId: string,
  title: string,
  message: string,
  event: string
): Promise<boolean> {
  try {
    const b = await prisma.booking.findFirst({
      where: { id: bookingId },
      select: { id: true, publicId: true, userId: true },
    });
    if (!b?.userId) return false;
    const { createNotification } = await import("@/services/notificationService");
    await createNotification(b.userId, title, message, "party", {
      bookingId: b.id,
      publicId: b.publicId,
      event,
      href: `/profile/parties/${b.id}`,
    });
    return true;
  } catch {
    return false;
  }
}

async function logNotice(b: NoticeParty, kind: "email" | "sms", payload: Record<string, unknown>) {
  await logBookingActivity({
    orgId: b.orgId,
    locationId: b.locationId,
    bookingId: b.id,
    kind,
    payload,
  }).catch(() => undefined);
}

/**
 * Party confirmation (replaces the generic booking confirmation for party
 * bookings). Idempotent on Booking.confirmationSentAt unless `force`.
 */
export async function sendPartyConfirmation(opts: {
  bookingId: string;
  force?: boolean;
}): Promise<{ sent: boolean; reason?: string }> {
  const b = await loadNoticeParty(opts.bookingId);
  if (!b?.partyDetail) return { sent: false, reason: "not_found" };
  if (b.confirmationSentAt && !opts.force) return { sent: false, reason: "already_sent" };
  const d = b.partyDetail;
  const to = b.primaryContactEmail?.trim() || null;

  let waiverUrl: string | null = null;
  let waiverRequestId: string | null = null;
  let sent = false;
  let reason: string | undefined;

  if (!to) {
    reason = "no_email";
  } else if (!guestMailConfigured()) {
    reason = "email_skipped";
    await logNotice(b, "email", { template: "party_confirmation", to, ok: false, skipped: true });
  } else {
    try {
      const { issueBookingWaiverLink } = await import("@/lib/waivers/bookingHooks");
      const issued = await issueBookingWaiverLink(b.id);
      waiverUrl = issued?.url ?? null;
      waiverRequestId = issued?.requestId ?? null;
    } catch (err) {
      console.error("[party confirmation] waiver link skipped", err);
    }
    const due = toCents(b.amountDue);
    const payPath = due > 0 ? await openPayPath(b.id) : null;
    const html = `
      <h1>Your party is confirmed</h1>
      <p>Hi ${esc((b.primaryContactName || "there").split(/\s+/)[0])},</p>
      <p>We're getting ready for <strong>${esc(d.partyName)}</strong>.</p>
      ${detailsHtml(b)}
      ${moneyHtml(b)}
      ${linksHtml([
        ["View confirmation", `/booking/confirmation/${encodeURIComponent(b.publicId)}?viewToken=${encodeURIComponent(b.viewToken)}`],
        ["Manage your party", `/booking/magic/${encodeURIComponent(b.viewToken)}`],
        ["Pay balance", payPath],
      ])}
      ${waiverUrl ? `<p style="margin:12px 0 0;"><a href="${esc(waiverUrl)}" style="color:#D4AF37;font-weight:600;">Sign your waiver</a></p>` : ""}
    `;
    sent = await sendBrandedGuestEmail(
      { orgId: b.orgId, to, subject: `Party confirmed: ${d.partyName} (${b.publicId})`, htmlBody: html },
      "Party confirmation"
    );
    if (!sent) reason = "email_failed";
    if (waiverRequestId) {
      const { settleBookingWaiverLink } = await import("@/lib/waivers/bookingHooks");
      await settleBookingWaiverLink(waiverRequestId, sent).catch(() => undefined);
    }
    await logNotice(b, "email", { template: "party_confirmation", to, ok: sent });
  }

  if (sent) {
    await prisma.booking.update({ where: { id: b.id }, data: { confirmationSentAt: new Date() } });
  }

  if (b.primaryContactPhone) {
    const sms = await sendBookingSms({
      to: b.primaryContactPhone,
      body: `${d.partyName} is confirmed for ${formatPartyWhen(b.visitStartsAt, b.location?.timezone)}. Manage: ${abs(`/booking/magic/${b.viewToken}`)}`,
      orgId: b.orgId,
      scope: "party",
    });
    // Never store the SMS body — it carries the magic viewToken URL.
    await logNotice(b, "sms", {
      template: "party_confirmation",
      sent: sms.sent === true,
      skipped: sms.sent === false && sms.skipped === true,
    });
  }

  await notifyPartyHost(b.id, "Party confirmed", `${d.partyName} (${b.publicId}) is confirmed.`, "confirmed");
  return sent ? { sent: true } : { sent: false, reason };
}

export async function sendPartyCancellation(bookingId: string): Promise<{ sent: boolean }> {
  const b = await loadNoticeParty(bookingId);
  if (!b?.partyDetail) return { sent: false };
  const d = b.partyDetail;
  const to = b.primaryContactEmail?.trim() || null;
  let sent = false;
  if (to && guestMailConfigured()) {
    sent = await sendBrandedGuestEmail(
      {
        orgId: b.orgId,
        to,
        subject: `Party cancelled: ${d.partyName} (${b.publicId})`,
        htmlBody: `<h1>Your party was cancelled</h1>${detailsHtml(b)}<p style="margin:16px 0 0;">Refunds are handled separately by the venue. Reply to this email with any questions.</p>`,
      },
      "Party cancellation"
    );
  }
  if (to) await logNotice(b, "email", { template: "party_cancellation", to, ok: sent, skipped: !guestMailConfigured() });
  if (b.primaryContactPhone) {
    const sms = await sendBookingSms({
      to: b.primaryContactPhone,
      body: `${d.partyName} (${b.publicId}) was cancelled.`,
      orgId: b.orgId,
      scope: "party",
    });
    await logNotice(b, "sms", { template: "party_cancellation", sent: sms.sent === true, skipped: sms.sent === false });
  }
  await notifyPartyHost(b.id, "Party cancelled", `${d.partyName} (${b.publicId}) was cancelled.`, "cancelled");
  return { sent };
}

/** Invitation email / SMS. Returns whether any channel actually delivered. */
export async function deliverPartyInvitation(opts: {
  bookingId: string;
  channel: "email" | "sms" | "link";
  toEmail: string | null;
  toPhone: string | null;
  invitePath: string;
}): Promise<{ sent: boolean; skipped: boolean }> {
  const b = await loadNoticeParty(opts.bookingId);
  if (!b?.partyDetail) return { sent: false, skipped: true };
  const d = b.partyDetail;
  const url = abs(opts.invitePath);
  if (opts.channel === "sms" && opts.toPhone) {
    const sms = await sendBookingSms({
      to: opts.toPhone,
      body: `You're invited to ${d.partyName}${d.honoreeName ? ` for ${d.honoreeName}` : ""} on ${formatPartyWhen(b.visitStartsAt, b.location?.timezone)}. RSVP: ${url}`,
      orgId: b.orgId,
      scope: "party",
    });
    return { sent: sms.sent === true, skipped: sms.sent === false && sms.skipped === true };
  }
  if (opts.channel === "email" && opts.toEmail) {
    if (!guestMailConfigured()) return { sent: false, skipped: true };
    const sent = await sendBrandedGuestEmail(
      {
        orgId: b.orgId,
        to: opts.toEmail,
        subject: `You're invited: ${d.partyName}`,
        htmlBody: `
          <h1>You're invited!</h1>
          <p>${d.honoreeName ? `Join us to celebrate <strong>${esc(d.honoreeName)}</strong>.` : `Join us for <strong>${esc(d.partyName)}</strong>.`}</p>
          ${detailsHtml(b).replace(/<p[^>]*><strong>Reference:<\/strong>[^<]*<\/p>/, "")}
          <div style="text-align:center;margin:28px 0;"><a href="${esc(url)}" class="button">RSVP now</a></div>
          <p style="font-size:13px;color:#666;">No account needed. This link is personal to you.</p>
        `,
      },
      "Party invitation"
    );
    return { sent, skipped: false };
  }
  return { sent: false, skipped: true };
}

/** Deposit / balance reminder (email + host in-app). `sent` when either channel delivered. */
export async function sendPartyBalanceReminderEmail(opts: {
  bookingId: string;
  kind: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const b = await loadNoticeParty(opts.bookingId);
  if (!b?.partyDetail) return { sent: false, reason: "not_found" };
  const d = b.partyDetail;
  const to = b.primaryContactEmail?.trim() || null;
  const outstanding =
    opts.kind === "deposit"
      ? Math.max(0, d.depositRequiredCents - d.depositPaidCents)
      : toCents(b.amountDue);
  const label = opts.kind === "deposit" ? "deposit" : "balance";
  let sent = false;
  let reason: string | undefined;
  if (!to) reason = "no_email";
  else if (!guestMailConfigured()) reason = "email_skipped";
  else {
    const payPath = await openPayPath(b.id);
    const dueAt = opts.kind === "deposit" ? d.depositDueAt : d.balanceDueAt;
    sent = await sendBrandedGuestEmail(
      {
        orgId: b.orgId,
        to,
        subject: `Party ${label} reminder: ${d.partyName}`,
        htmlBody: `
          <h1>Your party ${esc(label)} is due</h1>
          <p>${money(outstanding)} is outstanding${dueAt ? ` (due ${esc(formatPartyWhen(dueAt, b.location?.timezone))})` : ""}.</p>
          ${detailsHtml(b)}
          ${moneyHtml(b)}
          ${linksHtml([
            ["Pay now", payPath],
            ["Manage your party", `/booking/magic/${encodeURIComponent(b.viewToken)}`],
          ])}
        `,
      },
      "Party reminder"
    );
    if (!sent) reason = "email_failed";
  }
  await logNotice(b, "email", { template: `party_${label}_reminder`, to, ok: sent, ...(reason ? { reason } : {}) });
  const notified = await notifyPartyHost(b.id, `Party ${label} due`, `${money(outstanding)} is due for ${d.partyName}.`, `${label}_due`);
  return sent || notified ? { sent: true } : { sent: false, reason };
}
