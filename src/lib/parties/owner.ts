/**
 * Party host (signed-in client) + magic-link guest-list edits. Scoped to the
 * signed-in user's own bookings; anything else is 404. Hosts can never assign
 * host staff, overbook, take staff payments, refund, manage invoices, or see
 * POS / staff notes.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { cancelBooking } from "@/lib/ticketing/bookingEngine";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import {
  TicketingError,
  HOLD_EXPIRED,
  PARTY_CANCEL_CUTOFF,
  PARTY_HOST_EDIT_DISABLED,
  PAYMENT_INCOMPLETE,
  partyNotFound,
} from "@/lib/parties/errors";
import { assertPartiesEnabled } from "@/lib/parties/assertPartiesEnabled";
import { isPartyLive, loadOwnerParty, loadPartyById, type LoadedParty } from "@/lib/parties/load";
import { resolvePartySettings } from "@/lib/parties/settings";
import { replacePartyGuestList } from "@/lib/parties/guests";
import { putFoodDraftForParty } from "@/lib/parties/food";
import { createInvitationForParty, parseInvitationInput } from "@/lib/parties/invitations";
import { toOwnerPartyDto } from "@/lib/parties/serialize";
import { logPartyActivity } from "@/lib/parties/activity";

export async function listMyParties(userId: string) {
  if (!isValidId(userId)) return [];
  const rows = await prisma.partyBookingDetail.findMany({
    where: { booking: { userId } },
    orderBy: [{ booking: { visitStartsAt: "desc" } }, { id: "desc" }],
    take: 100,
    select: {
      bookingId: true,
      partyName: true,
      honoreeName: true,
      kidCount: true,
      adultCount: true,
      opsStatus: true,
      roomNameSnapshot: true,
      depositRequiredCents: true,
      depositPaidCents: true,
      location: { select: { id: true, name: true, timezone: true } },
      booking: {
        select: { publicId: true, status: true, visitStartsAt: true, total: true, amountDue: true },
      },
    },
  });
  return rows.map((r) => ({
    bookingId: r.bookingId,
    publicId: r.booking.publicId,
    status: r.booking.status,
    opsStatus: r.opsStatus,
    partyName: r.partyName,
    honoreeName: r.honoreeName,
    kidCount: r.kidCount,
    adultCount: r.adultCount,
    room: r.roomNameSnapshot ? { name: r.roomNameSnapshot } : null,
    location: { id: r.location.id, name: r.location.name },
    timezone: r.location.timezone,
    visitStartsAt: r.booking.visitStartsAt?.toISOString() ?? null,
    totalCents: Math.round(Number(r.booking.total.toString()) * 100),
    amountDueCents: Math.round(Number(r.booking.amountDue.toString()) * 100),
    depositRequiredCents: r.depositRequiredCents,
    depositPaidCents: r.depositPaidCents,
  }));
}

async function hostCapabilities(party: LoadedParty) {
  const settings = await resolvePartySettings(party.orgId, party.locationId);
  const start = party.visitStartsAt?.getTime() ?? null;
  const now = Date.now();
  return {
    settings,
    canEditGuests: settings.allowHostEditGuestList && isPartyLive(party.status),
    canEditFood:
      settings.allowHostEditFood &&
      isPartyLive(party.status) &&
      (start == null || now < start - settings.foodOrderCutoffMinutes * 60_000),
    canCancel:
      ["hold", "reserved", "pending_payment", "confirmed"].includes(party.status) &&
      (start == null || now < start - settings.hostCancelCutoffHours * 3600_000),
    canInvite: isPartyLive(party.status),
  };
}

export async function getMyParty(userId: string, bookingId: string) {
  const party = await loadOwnerParty(userId, bookingId);
  const caps = await hostCapabilities(party);
  const menu = caps.canEditFood
    ? await prisma.partyMenuItem.findMany({
        where: { orgId: party.orgId, locationId: party.locationId, available: true, archivedAt: null },
        select: { id: true, name: true, kind: true, priceCents: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      })
    : [];
  return {
    party: toOwnerPartyDto(party, { isHost: true }),
    capabilities: {
      canEditGuests: caps.canEditGuests,
      canEditFood: caps.canEditFood,
      canCancel: caps.canCancel,
      canInvite: caps.canInvite,
      canPay: isPartyLive(party.status) && Number(party.amountDue.toString()) > 0,
      hostCancelCutoffHours: caps.settings.hostCancelCutoffHours,
      foodOrderCutoffMinutes: caps.settings.foodOrderCutoffMinutes,
    },
    menu,
  };
}

async function requireEntitled(party: LoadedParty) {
  await assertPartiesEnabled(party.orgId);
}

/** Host pay button: a payment link for the outstanding balance (existing pay page + Stripe flow). */
export async function createMyPartyPayLink(userId: string, bookingId: string) {
  const party = await loadOwnerParty(userId, bookingId);
  await requireEntitled(party);
  if (!isPartyLive(party.status)) throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  const due = Number(party.amountDue.toString());
  if (!(due > 0)) throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  const open = await prisma.bookingPaymentLink.findFirst({
    where: { bookingId: party.id, amountDue: party.amountDue, expiresAt: { gt: new Date(Date.now() + 3600_000) } },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  if (open) return { payPath: `/booking/pay/${encodeURIComponent(open.token)}` };
  const link = await prisma.bookingPaymentLink.create({
    data: {
      token: newPublicToken(),
      orgId: party.orgId,
      locationId: party.locationId,
      bookingId: party.id,
      amountDue: party.amountDue,
      expiresAt: new Date(Date.now() + 72 * 3600_000),
      channel: "email",
      sentTo: party.primaryContactEmail,
    },
  });
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "system",
    event: "host_pay_link",
    payload: { paymentLinkId: link.id, amountDue: due },
    actorUserId: userId,
  });
  return { payPath: `/booking/pay/${encodeURIComponent(link.token)}` };
}

/** PATCH guests. `legacy` keeps the old {name, age} replace payload working. */
export async function patchMyPartyGuests(
  userId: string,
  bookingId: string,
  guests: unknown[],
  opts: { legacy?: boolean } = {}
) {
  const party = await loadOwnerParty(userId, bookingId);
  await requireEntitled(party);
  const caps = await hostCapabilities(party);
  if (!caps.canEditGuests) throw new TicketingError(PARTY_HOST_EDIT_DISABLED, 403);
  return replacePartyGuestList(party, guests, { legacy: Boolean(opts.legacy), actorUserId: userId });
}

/** Legacy owner guest replace (me/bookings party-guests, magic link guests). */
export async function patchPartyGuestsForOwner(opts: {
  bookingId?: string;
  viewToken?: string;
  userId?: string;
  guests: unknown[];
}) {
  if (opts.viewToken?.trim()) {
    return patchPartyGuestsByViewToken(opts.viewToken, opts.guests);
  }
  const party = await loadOwnerParty(opts.userId || "", opts.bookingId || "");
  await requireEntitled(party);
  const caps = await hostCapabilities(party);
  if (!caps.canEditGuests) throw new TicketingError(PARTY_HOST_EDIT_DISABLED, 403);
  const guests = await replacePartyGuestList(party, opts.guests, {
    legacy: true,
    actorUserId: opts.userId || null,
  });
  return { guests, bookingId: party.id, publicId: party.publicId };
}

export async function putMyPartyFood(userId: string, bookingId: string, body: Record<string, unknown>) {
  const party = await loadOwnerParty(userId, bookingId);
  await requireEntitled(party);
  const caps = await hostCapabilities(party);
  if (!caps.settings.allowHostEditFood) throw new TicketingError(PARTY_HOST_EDIT_DISABLED, 403);
  return putFoodDraftForParty(party, body, {
    actor: { orgId: party.orgId, sub: userId },
    allowPriceOverride: false,
    enforceCutoff: true,
    asHost: true,
  });
}

export async function cancelMyParty(userId: string, bookingId: string, reason?: string | null) {
  const party = await loadOwnerParty(userId, bookingId);
  await requireEntitled(party);
  const caps = await hostCapabilities(party);
  if (!caps.canCancel) throw new TicketingError(PARTY_CANCEL_CUTOFF, 403);
  await cancelBooking({ orgId: party.orgId, sub: userId }, party.id, {
    orgId: party.orgId,
    skipStaffGate: true,
    guestCancel: true,
    reason: reason?.trim() || "host_cancel",
  });
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "status",
    event: "party_cancelled_by_host",
    payload: { reason: reason?.trim() || null },
    actorUserId: userId,
  });
  return getMyParty(userId, bookingId);
}

export async function createMyPartyInvitation(userId: string, bookingId: string, raw: unknown) {
  const party = await loadOwnerParty(userId, bookingId);
  await requireEntitled(party);
  const input = parseInvitationInput(raw);
  if (input.guestId && !party.partyDetail.guests.some((g) => g.id === input.guestId)) {
    throw partyNotFound();
  }
  const invite = await createInvitationForParty(party, input, userId);
  return {
    id: invite.id,
    status: invite.status,
    channel: invite.channel,
    expiresAt: invite.expiresAt,
    rsvpPath: invite.rsvpPath,
    rsvpUrl: invite.rsvpUrl,
  };
}

/** Magic-link guest-list edits (same 72h window as validateMagicToken). */
export async function patchPartyGuestsByViewToken(viewToken: string, guests: unknown[]) {
  const token = viewToken.trim();
  if (!token) throw partyNotFound();
  const booking = await prisma.booking.findFirst({
    where: { viewToken: token },
    select: { id: true, orgId: true, createdAt: true, confirmationSentAt: true },
  });
  if (!booking) throw partyNotFound();
  const start = booking.confirmationSentAt ?? booking.createdAt;
  if (Date.now() - start.getTime() > 72 * 3600_000) throw new TicketingError(HOLD_EXPIRED, 410);
  const party = await loadPartyById(booking.orgId, booking.id);
  await requireEntitled(party);
  const caps = await hostCapabilities(party);
  if (!caps.canEditGuests) throw new TicketingError(PARTY_HOST_EDIT_DISABLED, 403);
  const fresh = await replacePartyGuestList(party, guests, { legacy: true, actorUserId: null });
  return { guests: fresh, bookingId: party.id, publicId: party.publicId };
}
