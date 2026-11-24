/**
 * Public guest booking service — binds to published venue, never JWT orgId write.
 */
import prisma from "@/lib/prisma";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import { requireId, isValidId } from "@/lib/ids";
import { createHash, timingSafeEqual } from "crypto";
import { assertOrganizationActive } from "@/lib/org";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { assertTicketingEnabled } from "@/lib/ticketing/assertTicketingEnabled";
import {
  resolvePublicBookingVenue,
  toPublicVenueDto,
} from "@/lib/ticketing/publicVenue";
import {
  TicketingError,
  isTicketingError,
  HOLD_EXPIRED,
  PUBLIC_VENUE_NOT_PUBLISHED,
  SESSION_SOLD_OUT,
  BOOKING_NOT_FOUND,
  PAYMENT_INCOMPLETE,
  PAYMENT_EXCEEDS_DUE,
  INVALID_STATUS_TRANSITION,
} from "@/lib/ticketing/errors";
import { createSessionHold, releaseHoldById, getHoldByToken } from "@/lib/ticketing/holds";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import {
  createBooking,
  confirmBooking,
  holdBooking,
  holdPartyRoom,
  toGuestBookingDto,
  bookingInclude,
  toNum,
  money,
  updateBookingAmountsAfterPayment,
  type BookingLineInput,
  type CustomLineInput,
  type PartyDetailInput,
} from "@/lib/ticketing/bookingEngine";
import { syncPartyOpsFromBooking } from "@/lib/parties/bookingHooks";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { listTicketsDto, ticketViewTokenHash } from "@/lib/ticketing/credentials";
import { expireBookingHolds } from "@/lib/ticketing/expireHolds";
import { enrichSessionsWithHoldState } from "@/lib/ticketing/availabilityEnrich";
import {
  visitDayEndExclusive,
  visitDayStart,
} from "@/lib/ticketing/visitDayBounds";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { allowTicketingPaymentStub } from "@/lib/ticketing/paymentSafety";
import {
  enqueueBookingPayment,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

async function assertOrgCanSellTickets(orgId: string) {
  await assertOrganizationActive(orgId);

  // Platform host / isDefault may publish VenueLocation rows for Super-admin demos.
  // Guest booking must still work for those published venues; staff module gates
  // remain fail-closed for registered-company park ops.
  const { getStorefrontOrgId } = await import("@/lib/org");
  const storefrontOrgId = await getStorefrontOrgId().catch(() => null);
  if (storefrontOrgId && orgId === storefrontOrgId) {
    return;
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { isDefault: true },
  });
  if (org?.isDefault) {
    return;
  }

  await assertNotDemoPlanLocked(orgId);
  await assertCompanyBillingEntitled(orgId);
  await assertTicketingEnabled(orgId);
}

function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function getPublicVenue(orgSlug: string, venueSlug: string) {
  const { org, venue } = await resolvePublicBookingVenue(orgSlug, venueSlug);
  await assertOrgCanSellTickets(org.id);
  const settings = await resolveBookingSettings(org.id, venue.id);
  return {
    ...toPublicVenueDto(org, venue),
    allowOnlinePayLater: settings.allowOnlinePayLater,
    holdTtlMinutes: settings.holdTtlMinutes,
    timeFormat: settings.timeFormat,
  };
}

export async function listPublicProducts(orgSlug: string, venueSlug: string) {
  const { org, venue } = await resolvePublicBookingVenue(orgSlug, venueSlug);
  await assertOrgCanSellTickets(org.id);
  const products = await prisma.admissionProduct.findMany({
    where: {
      orgId: org.id,
      locationId: venue.id,
      published: true,
      archivedAt: null,
    },
    include: {
      prices: { orderBy: { amount: "asc" } },
      resource: { select: { id: true, name: true, defaultCapacity: true } },
      category: { select: { id: true, name: true, orgId: true } },
      parentLinks: {
        include: {
          addOnProduct: {
            select: {
              id: true,
              name: true,
              type: true,
              published: true,
              archivedAt: true,
              prices: { orderBy: { amount: "asc" }, take: 4 },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const timedIds = products
    .filter((p) =>
      ["timed_session", "party_package", "group", "camp_event"].includes(p.type)
    )
    .map((p) => p.id);
  const soldOutIds = new Set<string>();
  if (timedIds.length) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const sessions = await prisma.ticketSession.findMany({
      where: {
        productId: { in: timedIds },
        startsAt: { gte: start, lte: end },
        isClosed: false,
      },
      select: { productId: true, remaining: true },
    });
    const byProduct = new Map<string, number>();
    for (const s of sessions) {
      byProduct.set(s.productId, (byProduct.get(s.productId) ?? 0) + s.remaining);
    }
    for (const id of timedIds) {
      // Sold out if sessions exist today and none have remaining seats.
      if (byProduct.has(id) && (byProduct.get(id) ?? 0) <= 0) {
        soldOutIds.add(id);
      }
    }
  }

  return products.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    images: p.images,
    minGuests: p.minGuests,
    maxGuests: p.maxGuests,
    categoryId:
      p.category && p.category.orgId === org.id ? p.categoryId ?? null : null,
    category:
      p.category && p.category.orgId === org.id
        ? { id: p.category.id, name: p.category.name }
        : null,
    resource: p.resource,
    prices: p.prices.map((pr) => ({
      code: pr.code,
      amount: Number(pr.amount.toString()),
      currency: pr.currency,
    })),
    priceFrom: p.prices.length
      ? Math.min(...p.prices.map((pr) => Number(pr.amount.toString())))
      : null,
    soldOut: soldOutIds.has(p.id),
    addOns: p.parentLinks
      .filter(
        (l) =>
          l.addOnProduct?.published &&
          !l.addOnProduct.archivedAt &&
          l.addOnProduct.type === "add_on"
      )
      .map((l) => ({
        id: l.addOnProduct!.id,
        name: l.addOnProduct!.name,
        required: l.required,
        maxQty: l.maxQty,
        priceFrom: l.addOnProduct!.prices.length
          ? Math.min(
              ...l.addOnProduct!.prices.map((pr) =>
                Number(pr.amount.toString())
              )
            )
          : null,
      })),
  }));
}

export async function listPublicAvailability(opts: {
  productId: string;
  date?: string;
  /** Inclusive range start (ISO or YYYY-MM-DD) — for guest month calendars. */
  from?: string;
  /** Inclusive range end (ISO or YYYY-MM-DD). */
  to?: string;
  qty?: number;
}) {
  if (!opts.productId || !isValidId(opts.productId)) {
    throw new Error("Invalid productId");
  }
  const product = await prisma.admissionProduct.findFirst({
    where: {
      id: opts.productId,
      published: true,
      archivedAt: null,
    },
    include: {
      location: true,
      prices: { take: 1, orderBy: { amount: "asc" } },
    },
  });
  if (!product) throw new TicketingError(SESSION_SOLD_OUT, 404);

  // Venue must be public-booking enabled.
  const venueOk = await prisma.venueLocation.findFirst({
    where: {
      id: product.locationId,
      publicBookingEnabled: true,
      status: "active",
    },
    select: { id: true },
  });
  if (!venueOk) {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }
  await assertOrgCanSellTickets(product.orgId);

  // Release expired holds so availability stays in sync with capacity.
  void expireBookingHolds({ orgId: product.orgId, limit: 50 }).catch(
    () => undefined
  );

  const qty = Math.max(1, Number(opts.qty) || 1);
  const currency =
    (product.prices[0]?.currency || "USD").toUpperCase().slice(0, 3);
  const where: {
    orgId: string;
    productId: string;
    startsAt?: { gte: Date; lt?: Date; lte?: Date };
  } = {
    orgId: product.orgId,
    productId: product.id,
  };

  if (opts.date) {
    const start = visitDayStart(opts.date, product.location?.timezone);
    const endEx = visitDayEndExclusive(opts.date, product.location?.timezone);
    if (!start || !endEx) throw new Error("Invalid date");
    where.startsAt = { gte: start, lt: endEx };
  } else if (opts.from || opts.to) {
    const range: { gte: Date; lte?: Date } = {
      gte: new Date(0),
    };
    if (opts.from) {
      const fromYmd = String(opts.from).slice(0, 10);
      const from =
        visitDayStart(fromYmd, product.location?.timezone) ??
        new Date(opts.from);
      if (Number.isNaN(from.getTime())) throw new Error("Invalid from");
      range.gte = from;
    }
    if (opts.to) {
      const toYmd = String(opts.to).slice(0, 10);
      const endEx = visitDayEndExclusive(toYmd, product.location?.timezone);
      if (endEx) {
        range.lte = new Date(endEx.getTime() - 1);
      } else {
        const to = new Date(opts.to);
        if (Number.isNaN(to.getTime())) throw new Error("Invalid to");
        to.setUTCHours(23, 59, 59, 999);
        range.lte = to;
      }
    }
    where.startsAt = range;
  }

  const sessions = await prisma.ticketSession.findMany({
    where,
    orderBy: [{ startsAt: "asc" }, { label: "asc" }],
    take: opts.date ? 200 : 400,
  });

  const base = sessions.map((s) => ({
    id: s.id,
    label: s.label ?? null,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    remaining: s.remaining,
    capacity: s.capacity,
    isClosed: s.isClosed,
    priceOverride:
      s.priceOverride != null ? Number(s.priceOverride.toString()) : null,
    currency,
  }));

  return enrichSessionsWithHoldState(base, qty);
}

export async function createPublicHold(opts: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  sessionId: string;
  qty: number;
}) {
  const { org, venue } = await resolvePublicBookingVenue(
    opts.orgSlug,
    opts.venueSlug
  );
  await assertOrgCanSellTickets(org.id);

  const product = await prisma.admissionProduct.findFirst({
    where: {
      id: requireId(opts.productId, "productId"),
      orgId: org.id,
      locationId: venue.id,
      published: true,
      archivedAt: null,
    },
  });
  if (!product) throw new TicketingError(SESSION_SOLD_OUT, 404);

  const session = await prisma.ticketSession.findFirst({
    where: {
      id: requireId(opts.sessionId, "sessionId"),
      orgId: org.id,
      locationId: venue.id,
      productId: product.id,
      isClosed: false,
    },
  });
  if (!session) throw new TicketingError(SESSION_SOLD_OUT, 409);

  const qty = Number(opts.qty);
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Invalid qty");

  const settings = await resolveBookingSettings(org.id, venue.id);
  const expiresAt = new Date(
    Date.now() + settings.holdTtlMinutes * 60_000
  );

  // Release expired holds first so remaining seats stay accurate under concurrent guests.
  await expireBookingHolds({ orgId: org.id, limit: 80 }).catch(() => undefined);

  const { hold } = await createSessionHold({
    orgId: org.id,
    locationId: venue.id,
    sessionId: session.id,
    qty,
    expiresAt,
    resourceId: session.resourceId,
    allowOverbook: false,
  });

  return {
    holdId: hold.id,
    token: hold.token,
    expiresAt: hold.expiresAt.toISOString(),
    sessionId: session.id,
    productId: product.id,
    qty,
  };
}

export async function releasePublicHold(holdId: string, token?: string) {
  const id = requireId(holdId, "holdId");
  const secret = token?.trim() ?? "";
  if (!secret) throw new TicketingError(HOLD_EXPIRED, 410);
  const hold = await prisma.bookingHold.findFirst({ where: { id } });
  if (!hold) return { ok: true };
  if (!secretsEqual(secret, hold.token)) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  // Attached holds are owned by the booking — releasing them would free
  // capacity while checkout still thinks seats are held.
  if (hold.bookingId) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  await releaseHoldById(id);
  return { ok: true };
}

export async function publicCheckout(opts: {
  holdId?: string;
  holdToken?: string;
  orgSlug: string;
  venueSlug: string;
  priceBandCode?: string;
  lines?: Array<{
    productId: string;
    sessionId?: string;
    qty: number;
    priceBandCode?: string;
    visitDate?: string;
  }>;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  payLater?: boolean;
  userId?: string | null;
  /** Party engine: priced party lines + detail (publicParties builds this). */
  partyPlan?: {
    lines: BookingLineInput[];
    party: PartyDetailInput;
    customLines?: CustomLineInput[];
  };
}) {
  const { org, venue } = await resolvePublicBookingVenue(
    opts.orgSlug,
    opts.venueSlug
  );
  await assertOrgCanSellTickets(org.id);
  const settings = await resolveBookingSettings(org.id, venue.id);

  if (opts.payLater && !settings.allowOnlinePayLater) {
    throw new Error("Pay later is not enabled for this venue");
  }

  const email = opts.primaryContactEmail?.trim() ?? "";
  // Confirmation / magic / profile link require email — enforce server-side (UI already gates).
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email is required");
  }
  const primaryContactEmail = email.toLowerCase();

  let hold = null as Awaited<ReturnType<typeof getHoldByToken>> | null;
  // Hold capacity is gated by hold.token — never accept bare holdId.
  if (opts.holdToken?.trim()) {
    hold = await getHoldByToken(opts.holdToken.trim());
    if (
      opts.holdId &&
      hold &&
      hold.id !== requireId(opts.holdId, "holdId")
    ) {
      throw new TicketingError(HOLD_EXPIRED, 410);
    }
  } else if (opts.holdId) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  if (hold && (hold.orgId !== org.id || hold.locationId !== venue.id)) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }

  // Hold is the capacity authority. Client line qty/session cannot inflate sold seats.
  let lines: Array<{
    productId: string;
    sessionId?: string;
    qty: number;
    priceBandCode?: string;
    visitDate?: string;
  }> = [];
  if (hold) {
    if (!hold.sessionId) {
      throw new TicketingError(HOLD_EXPIRED, 410);
    }
    const session = await prisma.ticketSession.findFirst({
      where: {
        id: hold.sessionId,
        orgId: org.id,
        locationId: venue.id,
      },
      select: { productId: true },
    });
    if (!session) throw new TicketingError(HOLD_EXPIRED, 410);
    if (opts.partyPlan) {
      const main = opts.partyPlan.lines.filter((l) => l.sessionId);
      if (
        main.length !== 1 ||
        main[0]!.sessionId !== hold.sessionId ||
        main[0]!.productId !== session.productId ||
        main[0]!.qty !== hold.qty
      ) {
        throw new TicketingError(HOLD_EXPIRED, 410);
      }
    }
    lines = opts.partyPlan
      ? opts.partyPlan.lines.map((l) => ({
          productId: l.productId,
          sessionId: l.sessionId ?? undefined,
          qty: l.qty,
          priceBandCode: l.priceBandCode ?? undefined,
          visitDate: l.visitDate ?? undefined,
        }))
      : [
      {
        productId: session.productId,
        sessionId: hold.sessionId,
        qty: hold.qty,
        // Prefer explicit main-line band from client (ProductBook → checkout query).
        priceBandCode:
          (opts.lines ?? []).find((l) => l.productId === session.productId)
            ?.priceBandCode || opts.priceBandCode,
      },
    ];
    const extraIds = opts.partyPlan
      ? []
      : (opts.lines ?? [])
          .filter((l) => l.productId && l.productId !== session.productId)
          .map((l) => l.productId);
    if (extraIds.length) {
      const links = await prisma.admissionAddOnLink.findMany({
        where: {
          orgId: org.id,
          parentProductId: session.productId,
          addOnProductId: { in: extraIds },
        },
        select: {
          addOnProductId: true,
          maxQty: true,
          addOnProduct: {
            select: {
              id: true,
              published: true,
              archivedAt: true,
              type: true,
            },
          },
        },
      });
      const allowed = new Map(
        links
          .filter(
            (l) =>
              l.addOnProduct?.type === "add_on" &&
              l.addOnProduct.published &&
              !l.addOnProduct.archivedAt
          )
          .map((l) => [l.addOnProductId, l.maxQty] as const)
      );
      for (const extra of opts.lines ?? []) {
        if (extra.productId === session.productId) continue;
        const maxQty = allowed.get(extra.productId);
        if (maxQty === undefined) {
          throw new Error("Add-on is not available for this product");
        }
        const qty = Math.max(1, Number(extra.qty) || 1);
        if (maxQty != null && qty > maxQty) {
          throw new Error(`Add-on quantity exceeds max (${maxQty})`);
        }
        lines.push({
          productId: extra.productId,
          qty,
          priceBandCode: extra.priceBandCode,
        });
      }
    }
  } else {
    lines = opts.lines?.length ? opts.lines : [];
  }

  if (!lines.length || !lines[0]?.productId) {
    throw new Error("Checkout requires hold or lines");
  }

  const actor = { orgId: org.id, sub: opts.userId ?? "guest" };
  const booking = await createBooking(
    actor,
    {
      locationId: venue.id,
      channel: opts.userId ? "account" : "online",
      createMode: "hold",
      lines: lines.map((l) => ({
        productId: l.productId,
        // Never attach the hold's session to add-on lines (wrong productId → SESSION_SOLD_OUT).
        sessionId: l.sessionId ?? null,
        qty: l.qty,
        priceBandCode: l.priceBandCode,
        visitDate: l.visitDate ?? null,
      })),
      primaryContactName: opts.primaryContactName,
      primaryContactEmail,
      primaryContactPhone: opts.primaryContactPhone,
      userId: opts.userId ?? null,
      activate: false,
      holdIds: hold ? [hold.id] : undefined,
      party: opts.partyPlan?.party,
      customLines: opts.partyPlan?.customLines,
    },
    { skipStaffGate: true, orgId: org.id }
  );

  // Attach capacity: if hold exists, capacity already consumed — just mark hold status.
  // Else hold now (consumes session + add-on stock).
  let held;
  if (hold) {
    const { consumeAddOnStockForLines } = await import(
      "@/lib/ticketing/stockPeriods"
    );
    const { releaseHoldsForBooking } = await import("@/lib/ticketing/holds");
    try {
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: "hold",
            holdExpiresAt: hold.expiresAt,
          },
        });
        await tx.bookingHold.update({
          where: { id: hold.id },
          data: { bookingId: booking.id },
        });
        const live = await tx.booking.findFirstOrThrow({
          where: { id: booking.id },
          include: { lines: true },
        });
        await holdPartyRoom(tx, live, false);
        await consumeAddOnStockForLines(
          {
            bookingId: booking.id,
            orgId: org.id,
            locationId: venue.id,
            lines: live.lines,
          },
          tx
        );
        await syncPartyOpsFromBooking(tx, booking.id);
        await logBookingActivity(
          {
            orgId: org.id,
            locationId: venue.id,
            bookingId: booking.id,
            kind: "status",
            payload: { to: "hold", source: "public_checkout" },
          },
          tx
        );
      });
    } catch (err) {
      // createBooking already committed — detach hold + cancel so capacity and
      // guest retry stay consistent (add-on consume rolled back with the TX).
      try {
        await prisma.$transaction(async (tx) => {
          await releaseHoldsForBooking(booking.id, tx);
          await tx.bookingHold.updateMany({
            where: { id: hold.id, bookingId: booking.id },
            data: { bookingId: null },
          });
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: "cancelled",
              cancelledAt: new Date(),
              holdExpiresAt: null,
              reservedUntil: null,
            },
          });
          await syncPartyOpsFromBooking(tx, booking.id);
        });
      } catch (cleanupErr) {
        console.error(
          "[publicCheckout] cleanup after stock/hold failure",
          booking.id,
          cleanupErr
        );
      }
      throw err;
    }
    held = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: bookingInclude,
    });
  } else {
    held = (
      await holdBooking(actor, booking.id, {
        skipStaffGate: true,
        orgId: org.id,
      })
    );
    // holdBooking returns dto — reload
    held = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: bookingInclude,
    });
  }

  if (opts.payLater) {
    if (!settings.allowOnlinePayLater) {
      throw new Error("Pay later is not enabled for this venue");
    }
    if (settings.payLaterMarksConfirmed) {
      try {
        await confirmBooking(actor, booking.id, {
          skipStaffGate: true,
          orgId: org.id,
          allowUnpaid: true,
          autoReview: true,
        });
        return guestBookingById(booking.id);
      } catch (err) {
        // Party deposit still owed: stay pending_payment instead of confirming.
        if (!(isTicketingError(err) && err.code === "PARTY_DEPOSIT_REQUIRED")) throw err;
      }
    }
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "pending_payment" },
    });
    await syncPartyOpsFromBooking(prisma, booking.id);
    return guestBookingById(booking.id);
  }

  // Pay-now: leave on hold / pending_payment for Stripe.
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "pending_payment" },
  });
  await syncPartyOpsFromBooking(prisma, booking.id);
  return guestBookingById(booking.id);
}

export async function beginPublicCardPayment(opts: {
  bookingPublicId: string;
  viewToken: string;
  /** Company category site only. Every other caller keeps hosted Checkout. */
  embedded?: EmbeddedCheckoutReturn;
}) {
  const booking = await getPublicConfirmation(
    opts.bookingPublicId,
    opts.viewToken
  );
  if (
    !["hold", "reserved", "pending_payment", "confirmed", "draft"].includes(
      booking.status
    )
  ) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  const due = toNum(booking.amountDue);
  if (!(due > 0)) throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  const link = await prisma.bookingPaymentLink.create({
    data: {
      token: newPublicToken(),
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      amountDue: money(due),
      expiresAt: new Date(Date.now() + 2 * 3600_000),
      channel: "email",
      sentTo: booking.primaryContactEmail,
    },
  });
  return settlePublicPaymentLink(link.token, {
    amount: due,
    embedded: opts.embedded,
  });
}

export type EmbeddedCheckoutReturn = {
  /** Must contain `{CHECKOUT_SESSION_ID}`. */
  returnUrl: string;
};

async function guestBookingDto(
  row: Parameters<typeof toGuestBookingDto>[0]
) {
  const dto = toGuestBookingDto(row);
  const settings = await resolveBookingSettings(row.orgId, row.locationId);
  return { ...dto, timeFormat: settings.timeFormat };
}

async function guestBookingById(bookingId: string) {
  return guestBookingDto(
    await prisma.booking.findFirstOrThrow({
      where: { id: bookingId },
      include: bookingInclude,
    })
  );
}

export async function getPublicConfirmation(
  bookingPublicId: string,
  viewToken?: string
) {
  const token = viewToken?.trim() ?? "";
  if (!token) {
    throw new TicketingError(BOOKING_NOT_FOUND, 404);
  }
  const booking = await prisma.booking.findFirst({
    where: { publicId: bookingPublicId },
    include: {
      ...bookingInclude,
      credentials: true,
    },
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  if (!secretsEqual(booking.viewToken, token)) {
    throw new TicketingError(BOOKING_NOT_FOUND, 404);
  }
  // Never expose posNotes / staff activity / invite tokens to guests.
  return guestBookingDto(booking);
}

export async function getPublicTicketByToken(
  ticketToken: string,
  bookingPublicIdHint?: string
) {
  const token = ticketToken.trim();
  if (!token || token.length < 16) {
    throw new TicketingError(BOOKING_NOT_FOUND, 404);
  }

  // Prefer publicId.hash so we never scan credentials across tenants.
  let publicId: string | null = null;
  let hash = token;
  const dot = token.lastIndexOf(".");
  if (dot > 0 && dot < token.length - 1) {
    publicId = token.slice(0, dot);
    hash = token.slice(dot + 1);
  } else if (bookingPublicIdHint?.trim()) {
    // Phase 3 bare-hash links: require booking publicId hint (no cross-tenant scan).
    publicId = bookingPublicIdHint.trim();
    hash = token;
  } else {
    throw new TicketingError(BOOKING_NOT_FOUND, 404);
  }
  if (!publicId || hash.length < 16) {
    throw new TicketingError(BOOKING_NOT_FOUND, 404);
  }

  const booking = await prisma.booking.findFirst({
    where: { publicId },
    select: {
      publicId: true,
      viewToken: true,
      status: true,
      credentials: {
        where: { status: { in: ["unused", "redeemed"] } },
      },
    },
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);

  const match = booking.credentials.find((c) =>
    secretsEqual(ticketViewTokenHash(c.code, booking.viewToken), hash)
  );
  if (!match) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  return {
    bookingPublicId: booking.publicId,
    ticket: listTicketsDto([match])[0],
  };
}

export async function validateMagicToken(token: string) {
  const raw = token.trim();
  if (!raw || raw.length < 8) {
    throw new TicketingError(BOOKING_NOT_FOUND, 404);
  }
  const booking = await prisma.booking.findFirst({
    where: { viewToken: raw },
    include: bookingInclude,
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  const start = booking.confirmationSentAt ?? booking.createdAt;
  const ageMs = Date.now() - start.getTime();
  const expired = ageMs > 72 * 3600_000;
  if (expired) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  return {
    valid: true as const,
    bookingPublicId: booking.publicId,
    status: booking.status,
    viewToken: booking.viewToken,
    booking: await guestBookingDto(booking),
  };
}

/** Public payment-link settle without staff gates. */
export async function settlePublicPaymentLink(
  token: string,
  opts?: { amount?: number; embedded?: EmbeddedCheckoutReturn }
) {
  const link = await prisma.bookingPaymentLink.findFirst({
    where: { token },
  });
  if (!link) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  if (link.expiresAt.getTime() <= Date.now()) {
    throw new TicketingError(PAYMENT_INCOMPLETE, 410);
  }
  const booking = await prisma.booking.findFirst({
    where: { id: link.bookingId },
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertOrgCanSellTickets(booking.orgId);
  if (
    !["hold", "reserved", "pending_payment", "confirmed", "draft"].includes(
      booking.status
    )
  ) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  const due = toNum(booking.amountDue);
  if (due <= 0) {
    throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  }
  const pendingCard = await prisma.bookingPayment.aggregate({
    where: {
      bookingId: booking.id,
      status: "pending",
      tender: { in: ["card", "stored_card"] },
    },
    _sum: { amount: true },
  });
  const reserved = toNum(pendingCard._sum.amount ?? 0);
  const available = Math.round((due - reserved) * 100) / 100;
  if (!(available > 0)) {
    throw new TicketingError(PAYMENT_EXCEEDS_DUE, 400);
  }

  const requested =
    opts?.amount != null
      ? Math.round(Number(opts.amount) * 100) / 100
      : toNum(link.amountDue);
  if (!(requested > 0)) throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  const amount = Math.min(requested, available);

  // Prefer Stripe Checkout when configured. Stub settlement only when
  // TICKETING_PAYMENT_LINK_STUB=1 outside production — never because Stripe is missing.
  const allowStub = allowTicketingPaymentStub();
  if (!process.env.STRIPE_SECRET_KEY?.trim() && !allowStub) {
    throw new Error("Card payments are not configured for this workspace");
  }

  if (!allowStub || process.env.STRIPE_SECRET_KEY?.trim()) {
    const { createCheckoutSession, CompanyBillingConfigError } = await import(
      "@/lib/stripe"
    );
    const { createPendingCardPaymentLocked } = await import(
      "@/lib/ticketing/payments"
    );
    const { resolveVenueBookingCheckoutDestination } = await import(
      "@/lib/marketplace/guestPayoutDestination"
    );
    const amountMinor = Math.round(amount * 100);
    const dest = await resolveVenueBookingCheckoutDestination({
      orgId: booking.orgId,
      locationId: booking.locationId,
      amountMinor,
    });
    const reserved = await createPendingCardPaymentLocked({
      bookingId: booking.id,
      orgId: booking.orgId,
      locationId: booking.locationId,
      amount,
      tender: "card",
      connectedAccountId: dest.connectedAccountId,
      platformFeeMinor: dest.applicationFeeMinor,
    });
    const payment = { id: reserved.id };
    const base = publicAppBaseUrl();
    const isParty = Boolean(
      await prisma.partyBookingDetail.findUnique({ where: { bookingId: booking.id }, select: { id: true } })
    );
    try {
      const metadata = {
        type: isParty ? "venue_party" : "venue_booking",
        amount,
        uuid: "payment_link",
        bookingId: booking.id,
        orgId: booking.orgId,
        locationId: booking.locationId,
        paymentId: payment.id,
        // Do not put viewToken in Stripe metadata — load from DB on success.
      };
      const lineCopy = {
        amount,
        email: booking.primaryContactEmail || "guest@example.com",
        productName: `Booking ${booking.publicId}`,
        productDescription: "Venue booking payment link",
        metadata,
        connectedAccountId: dest.connectedAccountId,
        applicationFeeMinor: dest.applicationFeeMinor,
      };
      const session = opts?.embedded
        ? await createCheckoutSession({
            ...lineCopy,
            uiMode: "embedded",
            returnUrl: opts.embedded.returnUrl,
          })
        : await createCheckoutSession({
            ...lineCopy,
            successUrl: `${base}/payment/booking/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${base}/payment/booking/cancel?token=${encodeURIComponent(token)}&bookingId=${booking.id}&paymentId=${payment.id}`,
          });
      if (
        session.payment_intent &&
        typeof session.payment_intent === "string"
      ) {
        await prisma.bookingPayment
          .update({
            where: { id: payment.id },
            data: { stripePaymentIntentId: session.payment_intent },
          })
          .catch(() => undefined);
      }
      await logBookingActivity({
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "payment",
        payload: {
          paymentId: payment.id,
          source: "payment_link",
          amount,
          status: "pending",
          checkoutSessionId: session.id,
        },
      });
      return {
        checkoutUrl: session.url,
        paymentId: payment.id,
        ...(opts?.embedded
          ? {
              clientSecret: session.client_secret,
              checkoutSessionId: session.id,
              paymentLinkToken: token,
            }
          : {}),
        booking: await guestBookingDto(
          await prisma.booking.findFirstOrThrow({
            where: { id: booking.id },
            include: bookingInclude,
          })
        ),
      };
    } catch (err) {
      // Only delete when Checkout was never created (caught before session return).
      await prisma.bookingPayment
        .delete({ where: { id: payment.id } })
        .catch(() => undefined);
      if (err instanceof CompanyBillingConfigError && allowStub) {
        // Fall through to stub only when explicitly enabled.
      } else if (err instanceof CompanyBillingConfigError) {
        throw new Error("Card payments are not configured for this workspace");
      } else {
        throw err;
      }
    }
  }

  if (!allowStub) {
    throw new Error("Card payments are not configured for this workspace");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
    `;
    const freshBooking = await tx.booking.findFirst({
      where: { id: booking.id },
    });
    if (!freshBooking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    const freshDue = toNum(freshBooking.amountDue);
    if (!(freshDue > 0)) {
      throw new TicketingError(PAYMENT_INCOMPLETE, 400);
    }
    const payAmt = Math.min(amount, freshDue);
    const payment = await tx.bookingPayment.create({
      data: {
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        tender: "card",
        amount: money(payAmt),
        status: "completed",
      },
    });
    await updateBookingAmountsAfterPayment(booking.id, payAmt, tx);
    await enqueueBookingPayment(tx, payment);
    await logBookingActivity(
      {
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "payment",
        payload: {
          paymentId: payment.id,
          source: "payment_link",
          amount: payAmt,
          stub: true,
        },
      },
      tx
    );
  });
  flushAccountingQueueSoon(booking.orgId);

  const fresh = await prisma.booking.findFirstOrThrow({
    where: { id: booking.id },
  });
  if (toNum(fresh.amountDue) <= 0) {
    await confirmBooking(
      { orgId: booking.orgId, sub: "payment_link" },
      booking.id,
      {
        skipStaffGate: true,
        orgId: booking.orgId,
        allowUnpaid: true,
        autoReview: true,
      }
    );
    return guestBookingById(booking.id);
  }
  const { confirmPartyWhenDepositPaid } = await import("@/lib/ticketing/payments");
  await confirmPartyWhenDepositPaid(booking.id);
  return guestBookingDto(
    await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: bookingInclude,
    })
  );
}

/** Notes prefix — staff list/detail treat these as guest special requests. */
export const SPECIAL_REQUEST_NOTES_PREFIX = "SPECIAL_REQUEST";

/**
 * Guest special request / oversized party / custom timing — no capacity hold.
 * Creates a draft booking for the company inbox + email + in-app alerts.
 */
export async function submitPublicSpecialRequest(opts: {
  orgSlug: string;
  venueSlug: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  productId?: string;
  preferredDate?: string;
  qty?: number;
}) {
  const name = opts.name?.trim() || "";
  const email = opts.email?.trim().toLowerCase() || "";
  const message = opts.message?.trim() || "";
  if (name.length < 2) throw new Error("Name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email is required");
  }
  if (message.length < 8) {
    throw new Error("Please share a bit more about your request");
  }
  if (message.length > 4000) throw new Error("Message is too long");

  const { org, venue } = await resolvePublicBookingVenue(
    opts.orgSlug,
    opts.venueSlug
  );
  await assertOrgCanSellTickets(org.id);

  let productName: string | null = null;
  let productId: string | null = null;
  if (opts.productId) {
    if (!isValidId(opts.productId)) throw new Error("Invalid product");
    const product = await prisma.admissionProduct.findFirst({
      where: {
        id: opts.productId,
        orgId: org.id,
        locationId: venue.id,
        published: true,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
    if (product) {
      productId = product.id;
      productName = product.name;
    }
  }

  const qty =
    opts.qty != null && Number.isFinite(Number(opts.qty))
      ? Math.max(1, Math.min(500, Math.floor(Number(opts.qty))))
      : null;

  let visitStartsAt: Date | null = null;
  if (opts.preferredDate) {
    const d = new Date(opts.preferredDate);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCHours(12, 0, 0, 0);
      visitStartsAt = d;
    }
  }

  const { generateBookingPublicId } = await import(
    "@/lib/ticketing/bookingEngine"
  );
  let publicId = generateBookingPublicId();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.booking.findFirst({
      where: { publicId },
      select: { id: true },
    });
    if (!clash) break;
    publicId = generateBookingPublicId();
  }

  const notes = [
    SPECIAL_REQUEST_NOTES_PREFIX,
    `Guest: ${name}`,
    `Email: ${email}`,
    opts.phone?.trim() ? `Phone: ${opts.phone.trim()}` : null,
    productName ? `Interested in: ${productName}` : null,
    productId ? `ProductId: ${productId}` : null,
    qty != null ? `Party size: ${qty}` : null,
    opts.preferredDate ? `Preferred date: ${opts.preferredDate}` : null,
    "",
    message,
  ]
    .filter((line) => line != null)
    .join("\n");

  const booking = await prisma.booking.create({
    data: {
      publicId,
      viewToken: newPublicToken(),
      orgId: org.id,
      locationId: venue.id,
      status: "draft",
      channel: "online",
      createMode: "hold",
      primaryContactName: name,
      primaryContactEmail: email,
      primaryContactPhone: opts.phone?.trim() || null,
      notes,
      visitStartsAt,
      subtotal: money(0),
      taxAmount: money(0),
      total: money(0),
      amountPaid: money(0),
      amountDue: money(0),
    },
  });

  await logBookingActivity({
    orgId: org.id,
    locationId: venue.id,
    bookingId: booking.id,
    kind: "note",
    payload: {
      event: "special_request",
      productId,
      qty,
      preferredDate: opts.preferredDate ?? null,
    },
  }).catch(() => undefined);

  // In-app: active company staff at this org.
  const staff = await prisma.membership.findMany({
    where: { orgId: org.id, status: "active" },
    select: { userId: true },
    take: 40,
  });
  const { createNotification } = await import(
    "@/services/notificationService"
  );
  const notifTitle = "New guest special request";
  const notifMsg = `${name} asked about ${productName || venue.name}. Open Bookings → ${publicId}.`;
  await Promise.allSettled(
    staff.map((m) =>
      createNotification(m.userId, notifTitle, notifMsg, "booking", {
        bookingId: booking.id,
        publicId,
        href: `/admin/bookings/${booking.id}`,
      })
    )
  );

  // Email: company profile support / billing / reply-to.
  try {
    const { getCompanyProfile, resolveBrandForOrg } = await import(
      "@/lib/companyProfile"
    );
    const { sendBookingSpecialRequestEmail } = await import("@/lib/mailer");
    const [profile, brand] = await Promise.all([
      getCompanyProfile(org.id),
      resolveBrandForOrg(org.id),
    ]);
    const to =
      profile?.supportEmail?.trim() ||
      profile?.billingEmail?.trim() ||
      profile?.replyToEmail?.trim() ||
      brand.supportEmail?.trim() ||
      "";
    if (to.includes("@")) {
      const base = publicAppBaseUrl();
      await sendBookingSpecialRequestEmail({
        to,
        orgName: brand.displayName || org.name,
        venueName: venue.name,
        publicId,
        guestName: name,
        guestEmail: email,
        guestPhone: opts.phone?.trim() || null,
        productName,
        preferredDate: opts.preferredDate ?? null,
        qty,
        message,
        dashboardUrl: `${base}/admin/bookings/${booking.id}`,
        orgId: org.id,
      });
    }
  } catch (err) {
    console.warn("[public-booking] special request email:", err);
  }

  return {
    ok: true as const,
    publicId: booking.publicId,
    bookingId: booking.id,
    message:
      "Thanks — your request was sent to the venue team. They will follow up by email.",
  };
}

