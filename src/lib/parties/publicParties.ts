/**
 * Public party booking. Thin wrappers over ticketing/publicBooking (one hold
 * engine, one checkout engine) + payment links + the invitation lib. Org and
 * venue come only from published slugs; unpublished, archived, Demo,
 * storefront, or non-entitled venues are 404.
 */
import prisma from "@/lib/prisma";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import { isValidId } from "@/lib/ids";
import { resolvePublicBookingVenue, toPublicVenueDto } from "@/lib/ticketing/publicVenue";
import {
  createPublicHold,
  getPublicConfirmation,
  listPublicAvailability,
  publicCheckout,
  settlePublicPaymentLink,
} from "@/lib/ticketing/publicBooking";
import { getPaymentLinkByToken, payViaPaymentLink } from "@/lib/ticketing/paymentLinks";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import { getHoldByToken } from "@/lib/ticketing/holds";
import {
  TicketingError,
  HOLD_EXPIRED,
  PAYMENT_INCOMPLETE,
  PARTY_ONLINE_DISABLED,
  PARTY_ROOM_CONFLICT,
  partyNotFound,
} from "@/lib/parties/errors";
import { PUBLIC_VENUE_NOT_PUBLISHED } from "@/lib/ticketing/errors";
import { assertPartiesEnabled } from "@/lib/parties/assertPartiesEnabled";
import {
  effectivePackageConfig,
  partyPackageInclude,
  requireBookablePackage,
  toPartyPackageDto,
} from "@/lib/parties/packages";
import { resolvePartySettings } from "@/lib/parties/settings";
import { assertPartyCounts, buildPartyPricePlan } from "@/lib/parties/pricing";
import { computeDepositRequiredCents, computePartyDueDates, fromCents, syncPartyMoney, toCents } from "@/lib/parties/deposits";
import { findRoomConflicts, PARTY_ROOM_TYPES, requireAssignableRoom } from "@/lib/parties/rooms";
import { schedulePartyReminders } from "@/lib/parties/reminders";
import { logPartyActivity } from "@/lib/parties/activity";
import { loadPartyById } from "@/lib/parties/load";
import { toPublicPartyDto } from "@/lib/parties/serialize";

export { getPublicInvitation, applyPartyRsvp } from "@/lib/parties/invitations";

async function resolvePartyVenue(orgSlug: string, venueSlug: string) {
  const { org, venue } = await resolvePublicBookingVenue(orgSlug, venueSlug);
  try {
    await assertPartiesEnabled(org.id);
  } catch {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }
  return { org, venue };
}

async function requireOnlineParties(orgId: string, locationId: string) {
  const settings = await resolvePartySettings(orgId, locationId);
  if (!settings.allowOnlinePartyBooking) throw new TicketingError(PARTY_ONLINE_DISABLED, 403);
  return settings;
}

export async function listPublicPartyPackages(orgSlug: string, venueSlug: string) {
  const { org, venue } = await resolvePartyVenue(orgSlug, venueSlug);
  const settings = await resolvePartySettings(org.id, venue.id);
  const bookingSettings = await resolveBookingSettings(org.id, venue.id);
  const rows = await prisma.admissionProduct.findMany({
    where: { orgId: org.id, locationId: venue.id, type: "party_package", published: true, archivedAt: null },
    include: partyPackageInclude,
    orderBy: { name: "asc" },
  });
  return {
    venue: toPublicVenueDto(org, venue),
    allowOnlinePartyBooking: settings.allowOnlinePartyBooking,
    allowPayLater: bookingSettings.allowOnlinePayLater && settings.allowOnlinePartyBooking,
    packages: rows.map((row) => {
      const dto = toPartyPackageDto(row, settings);
      return {
        id: dto.id,
        name: dto.name,
        description: dto.description,
        images: dto.images,
        minGuests: dto.minGuests,
        maxGuests: dto.maxGuests,
        durationMinutes: dto.config.durationMinutes,
        includedKids: dto.config.includedKids,
        includedAdults: dto.config.includedAdults,
        extraKidPriceCents: dto.config.extraKidPriceCents,
        extraAdultPriceCents: dto.config.extraAdultPriceCents,
        basePriceCents: dto.config.basePriceCents,
        includesFood: dto.config.includesFood,
        prices: dto.prices,
        addOns: dto.addOns.filter((a) => a.published && !a.archived),
        depositPreviewCents: dto.depositPreviewCents,
      };
    }),
  };
}

export async function publicPartyAvailability(opts: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  date?: string;
  from?: string;
  to?: string;
  kids?: number;
  adults?: number;
}) {
  const { org, venue } = await resolvePartyVenue(opts.orgSlug, opts.venueSlug);
  const pkg = await requireBookablePackage(org.id, venue.id, opts.productId);
  const settings = await resolvePartySettings(org.id, venue.id);
  const effective = effectivePackageConfig(pkg, settings);
  const sessions = await listPublicAvailability({
    productId: pkg.id,
    date: opts.date,
    from: opts.from,
    to: opts.to,
    qty: 1,
  });
  const kids = Number.isInteger(opts.kids) ? Number(opts.kids) : effective.includedKids;
  const adults = Number.isInteger(opts.adults) ? Number(opts.adults) : effective.includedAdults;
  let countsOk = true;
  try {
    assertPartyCounts({ kidCount: kids, adultCount: adults, minGuests: pkg.minGuests, maxGuests: pkg.maxGuests });
  } catch {
    countsOk = false;
  }
  const rooms = effective.roomAssignedAtBooking
    ? await prisma.capacityResource.findMany({
        where: { orgId: org.id, locationId: venue.id, type: { in: PARTY_ROOM_TYPES }, archivedAt: null },
        select: { id: true, defaultCapacity: true },
      })
    : [];
  const out = [];
  for (const s of sessions) {
    const startsAt = new Date(s.startsAt);
    const endsAt = new Date(s.endsAt);
    const sessionRow = await prisma.ticketSession.findFirst({ where: { id: s.id }, select: { resourceId: true } });
    const candidateRooms = effective.roomAssignedAtBooking
      ? rooms
      : [sessionRow?.resourceId ?? effective.roomResourceId].filter((id): id is string => Boolean(id)).map((id) => ({ id, defaultCapacity: 0 }));
    let roomsAvailable = 0;
    for (const room of candidateRooms) {
      const conflicts = await findRoomConflicts({ orgId: org.id, roomId: room.id, startsAt, endsAt });
      if (!conflicts.length) roomsAvailable += 1;
    }
    out.push({
      ...s,
      roomsAvailable,
      roomAvailable: candidateRooms.length === 0 ? true : roomsAvailable > 0,
      bookable: countsOk && (s.remaining ?? 0) > 0 && (candidateRooms.length === 0 || roomsAvailable > 0),
    });
  }
  return { productId: pkg.id, kids, adults, countsOk, timezone: venue.timezone, sessions: out };
}

export async function createPublicPartyHold(opts: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  sessionId: string;
}) {
  const { org, venue } = await resolvePartyVenue(opts.orgSlug, opts.venueSlug);
  await requireOnlineParties(org.id, venue.id);
  const pkg = await requireBookablePackage(org.id, venue.id, opts.productId);
  const settings = await resolvePartySettings(org.id, venue.id);
  const effective = effectivePackageConfig(pkg, settings);
  if (!isValidId(opts.sessionId)) throw new TicketingError(HOLD_EXPIRED, 410);
  const session = await prisma.ticketSession.findFirst({
    where: { id: opts.sessionId, orgId: org.id, locationId: venue.id, productId: pkg.id, isClosed: false },
  });
  if (!session) throw new TicketingError(HOLD_EXPIRED, 410);
  const roomId = effective.roomAssignedAtBooking ? null : session.resourceId ?? effective.roomResourceId;
  if (roomId) {
    const conflicts = await findRoomConflicts({
      orgId: org.id,
      roomId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    });
    if (conflicts.length) throw new TicketingError(PARTY_ROOM_CONFLICT, 409);
  }
  return createPublicHold({
    orgSlug: opts.orgSlug,
    venueSlug: opts.venueSlug,
    productId: pkg.id,
    sessionId: session.id,
    qty: 1,
  });
}

/**
 * Checkout: pay the deposit online (Checkout via payment link), or pay later
 * only when BookingSettings.allowOnlinePayLater AND allowOnlinePartyBooking.
 */
export async function publicPartyCheckout(opts: {
  orgSlug: string;
  venueSlug: string;
  holdId?: string;
  holdToken: string;
  kidCount: number;
  adultCount: number;
  partyName: string;
  honoreeName?: string | null;
  honoreeAge?: number | null;
  honoreeBirthDate?: string | null;
  contact: { name?: string | null; email?: string | null; phone?: string | null };
  addOns?: Array<{ productId: string; qty?: number }>;
  payLater?: boolean;
  userId?: string | null;
}) {
  const { org, venue } = await resolvePartyVenue(opts.orgSlug, opts.venueSlug);
  const settings = await requireOnlineParties(org.id, venue.id);
  const bookingSettings = await resolveBookingSettings(org.id, venue.id);
  if (opts.payLater && !bookingSettings.allowOnlinePayLater) {
    throw new TicketingError(PARTY_ONLINE_DISABLED, 403);
  }
  const hold = await getHoldByToken(String(opts.holdToken || "").trim());
  if (hold.orgId !== org.id || hold.locationId !== venue.id || !hold.sessionId || hold.bookingId) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  const session = await prisma.ticketSession.findFirst({ where: { id: hold.sessionId, orgId: org.id } });
  if (!session) throw new TicketingError(HOLD_EXPIRED, 410);
  const pkg = await requireBookablePackage(org.id, venue.id, session.productId);
  const effective = effectivePackageConfig(pkg, settings);
  const roomId = effective.roomAssignedAtBooking ? null : session.resourceId ?? effective.roomResourceId;
  const room = roomId ? await requireAssignableRoom(org.id, venue.id, roomId) : null;
  assertPartyCounts({
    kidCount: opts.kidCount,
    adultCount: opts.adultCount,
    minGuests: pkg.minGuests,
    maxGuests: pkg.maxGuests,
    roomCapacity: room?.defaultCapacity,
  });
  const partyName = opts.partyName?.trim();
  if (!partyName) throw new Error("Party name is required");
  const plan = await buildPartyPricePlan({
    orgId: org.id,
    pkg,
    effective,
    settings,
    sessionId: session.id,
    roomResourceId: room?.id ?? null,
    visitStartsAt: session.startsAt,
    kidCount: opts.kidCount,
    adultCount: opts.adultCount,
    addOns: opts.addOns,
  });
  const depositRequiredCents = plan.preview.depositRequiredCents;
  const due = computePartyDueDates({
    visitStartsAt: session.startsAt,
    timezone: venue.timezone,
    settings,
    depositRequiredCents,
  });
  const birth = opts.honoreeBirthDate ? new Date(opts.honoreeBirthDate) : null;
  const guest = await publicCheckout({
    orgSlug: opts.orgSlug,
    venueSlug: opts.venueSlug,
    holdId: opts.holdId,
    holdToken: opts.holdToken,
    primaryContactName: opts.contact.name ?? undefined,
    primaryContactEmail: opts.contact.email ?? undefined,
    primaryContactPhone: opts.contact.phone ?? undefined,
    payLater: Boolean(opts.payLater),
    userId: opts.userId ?? null,
    partyPlan: {
      lines: plan.lines,
      customLines: plan.customLines,
      party: {
        partyName,
        honoreeName: opts.honoreeName?.trim() || null,
        honoreeAge: opts.honoreeAge ?? null,
        honoreeBirthDate: birth && !Number.isNaN(birth.getTime()) ? birth : null,
        kidCount: opts.kidCount,
        adultCount: opts.adultCount,
        roomResourceId: room?.id ?? null,
        roomNameSnapshot: room?.name ?? null,
        depositRequiredCents,
        depositDueAt: due.depositDueAt,
        balanceDueAt: due.balanceDueAt,
      },
    },
  });
  const party = await loadPartyById(org.id, guest.id);
  const actualDeposit = computeDepositRequiredCents(
    toCents(party.total),
    {
      depositFixedCentsOverride: effective.depositFixedCentsOverride,
      depositPercentOverride: effective.depositPercentOverride,
    },
    settings
  );
  if (actualDeposit !== party.partyDetail.depositRequiredCents) {
    await prisma.partyBookingDetail.update({
      where: { id: party.partyDetail.id },
      data: { depositRequiredCents: actualDeposit },
    });
  }
  await syncPartyMoney(prisma, party.id);
  await schedulePartyReminders(prisma, party.partyDetail.id);
  await logPartyActivity({
    orgId: org.id,
    locationId: venue.id,
    bookingId: party.id,
    kind: "created",
    event: "party_created",
    payload: { channel: party.channel, productId: pkg.id, sessionId: session.id, payLater: Boolean(opts.payLater) },
    actorUserId: opts.userId ?? null,
  });

  let payment: Awaited<ReturnType<typeof beginPublicPartyDepositPayment>> | null = null;
  if (!opts.payLater) {
    payment = await beginPublicPartyDepositPayment(party.publicId, party.viewToken);
  }
  const fresh = await loadPartyById(org.id, party.id);
  return {
    bookingPublicId: fresh.publicId,
    viewToken: fresh.viewToken,
    party: toPublicPartyDto(fresh),
    payment,
  };
}

/** Pay the outstanding deposit (or the balance when no deposit is due) through a payment link. */
export async function beginPublicPartyDepositPayment(bookingPublicId: string, viewToken: string) {
  const booking = await getPublicConfirmation(bookingPublicId, viewToken);
  const party = await loadPartyById(booking.orgId, booking.id);
  const outstandingDeposit = Math.max(0, party.partyDetail.depositRequiredCents - toCents(party.amountPaid));
  const dueCents = toCents(party.amountDue);
  const payCents = outstandingDeposit > 0 ? Math.min(outstandingDeposit, dueCents) : dueCents;
  if (payCents <= 0) throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  const link = await prisma.bookingPaymentLink.create({
    data: {
      token: newPublicToken(),
      orgId: party.orgId,
      locationId: party.locationId,
      bookingId: party.id,
      amountDue: fromCents(payCents),
      expiresAt: new Date(Date.now() + 2 * 3600_000),
      channel: "email",
      sentTo: party.primaryContactEmail,
    },
  });
  const result = await settlePublicPaymentLink(link.token, { amount: fromCents(payCents) });
  return {
    amountCents: payCents,
    checkoutUrl: (result as { checkoutUrl?: string | null }).checkoutUrl ?? null,
    paymentLinkToken: link.token,
  };
}

/** Confirmation for the view-token holder (no guest contacts). */
export async function getPublicPartyConfirmation(bookingPublicId: string, viewToken: string) {
  const booking = await getPublicConfirmation(bookingPublicId, viewToken);
  const party = await loadPartyById(booking.orgId, booking.id).catch(() => null);
  if (!party) throw partyNotFound();
  return { booking, party: toPublicPartyDto(party) };
}

export async function getPublicPartyPayLink(token: string) {
  const link = await getPaymentLinkByToken(token);
  const bookingId = (link as { booking?: { id?: string } }).booking?.id;
  const party = bookingId
    ? await prisma.partyBookingDetail.findUnique({
        where: { bookingId },
        select: {
          partyName: true,
          honoreeName: true,
          depositRequiredCents: true,
          depositPaidCents: true,
          booking: { select: { visitStartsAt: true, location: { select: { name: true, timezone: true } } } },
        },
      })
    : null;
  return {
    link,
    party: party
      ? {
          partyName: party.partyName,
          honoreeName: party.honoreeName,
          depositRequiredCents: party.depositRequiredCents,
          depositPaidCents: party.depositPaidCents,
          visitStartsAt: party.booking.visitStartsAt?.toISOString() ?? null,
          venueName: party.booking.location?.name ?? null,
          timezone: party.booking.location?.timezone ?? null,
        }
      : null,
  };
}

export async function payPublicPartyPayLink(token: string, amount?: number) {
  return payViaPaymentLink(token, amount != null ? { amount } : {});
}
