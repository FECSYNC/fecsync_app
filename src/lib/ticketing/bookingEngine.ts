/**
 * One booking engine for online / phone / walk-in / POS / account channels.
 * Capacity is authoritative; payments never create shop Order rows.
 */
import { randomBytes } from "crypto";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import { Decimal } from "@prisma/client/runtime/library";
import type {
  AdmissionProductType,
  BookingChannel,
  BookingCreateMode,
  BookingStatus,
  Prisma,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertWithinPlanLimit } from "@/lib/planLimits";
import { previewBookingTax } from "@/lib/ticketing/tax";
import { assertPosEnabled } from "@/lib/pos/assertPosEnabled";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  assertVenueActiveForTicketingMutate,
  locationScopeFilter,
  applyTicketingLocationScope,
  rejectClientOrgFields,
  requireActorVenue,
  type TicketingActor,
} from "@/lib/ticketing/common";
import { validateStaffBookingContact } from "@/lib/ticketing/staffBookingContact";
import {
  TicketingError,
  BOOKING_PAST_LOCKED,
  BOOKING_REVIEW_REQUIRED,
  BOOKING_NOT_FOUND,
  HOLD_EXPIRED,
  INVALID_STATUS_TRANSITION,
  OVERBOOK_FORBIDDEN,
  REDEEMED_QTY_LOCKED,
  CHECKOUT_HOLD_MISMATCH,
  CANCEL_CUTOFF_PASSED,
  RESOURCE_CONFLICT,
  SESSION_SOLD_OUT,
} from "@/lib/ticketing/errors";
import { createSessionHold, releaseHoldsForBooking } from "@/lib/ticketing/holds";
import {
  assertAddOnStockAvailable,
  consumeAddOnStockForLines,
  restoreAddOnStockForLines,
} from "@/lib/ticketing/stockPeriods";
import {
  visitDayEndExclusive,
  visitDayStart,
} from "@/lib/ticketing/visitDayBounds";
import {
  consumeCapacity,
  moveSessionCapacity,
  releaseSessionCapacity,
} from "@/lib/ticketing/capacity";
import {
  voidUnusedCredentials,
  restorableCapacityQty,
  syncLiveCredentialsToHeads,
  countRedeemedHeads,
  ticketViewToken,
} from "@/lib/ticketing/credentials";
import { logBookingActivity } from "@/lib/ticketing/activity";
import {
  sendBookingConfirmation,
  sendBookingCancellation,
} from "@/lib/ticketing/confirmations";
import { assertPartyRoomFree } from "@/lib/parties/rooms";
import { syncPartyOpsFromBooking } from "@/lib/parties/bookingHooks";
import { assertPartyDepositGate, syncPartyMoney } from "@/lib/parties/deposits";
import { resolvePartySettings } from "@/lib/parties/settings";
import {
  enqueueBookingRev,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

/** Party detail written in the same transaction as its Booking (R1). */
export type PartyDetailInput = {
  partyName: string;
  honoreeName?: string | null;
  honoreeAge?: number | null;
  honoreeBirthDate?: Date | null;
  kidCount: number;
  adultCount: number;
  roomResourceId?: string | null;
  roomNameSnapshot?: string | null;
  hostStaffUserId?: string | null;
  hostNotes?: string | null;
  foodNotes?: string | null;
  depositRequiredCents: number;
  depositDueAt?: Date | null;
  balanceDueAt?: Date | null;
};

/** Pre-priced lines without an AdmissionProduct (party food). Always add_on: no heads. */
export type CustomLineInput = {
  productName: string;
  priceBandCode: string;
  qty: number;
  unitPrice: number;
  visitDate?: Date | null;
};

export type BookingLineInput = {
  productId: string;
  priceBandCode?: string | null;
  qty: number;
  unitPrice?: number | null;
  sessionId?: string | null;
  resourceId?: string | null;
  visitDate?: string | null;
};

export type CreateBookingInput = {
  locationId: string;
  channel: BookingChannel;
  createMode?: BookingCreateMode;
  lines: BookingLineInput[];
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  accountId?: string | null;
  accountContactId?: string | null;
  notes?: string | null;
  posNotes?: string | null;
  taxExempt?: boolean;
  userId?: string | null;
  allowOverbook?: boolean;
  /** When true, immediately hold/reserve/confirm per createMode. */
  activate?: boolean;
  holdIds?: string[];
  /** Party engine only: full PartyBookingDetail (counts drive heads, not line qty). */
  party?: PartyDetailInput;
  customLines?: CustomLineInput[];
};

function money(n: number): Decimal {
  return new Decimal(Math.round(n * 100) / 100);
}

function toNum(d: Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

function actorUserId(actor: { sub?: string | null } | null | undefined): string | null {
  return actor?.sub && isValidId(actor.sub) ? actor.sub : null;
}

export function generateBookingPublicId(): string {
  return `BK-${randomBytes(4).toString("hex").toUpperCase()}`;
}

const bookingInclude = {
  lines: true,
  guests: true,
  credentials: true,
  payments: { orderBy: { createdAt: "desc" as const } },
  activities: { orderBy: { createdAt: "desc" as const }, take: 100 },
  partyDetail: { include: { guests: true, invitations: true } },
  account: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, slug: true, timezone: true } },
  assignedStaff: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} satisfies Prisma.BookingInclude;

/** List/table payload — omit guests, credentials, activities, payments, party guests. */
const bookingListInclude = {
  lines: {
    select: {
      id: true,
      productId: true,
      productName: true,
      productType: true,
      priceBandCode: true,
      qty: true,
      unitPrice: true,
      taxAmount: true,
      lineTotal: true,
      resourceId: true,
      sessionId: true,
      visitDate: true,
      passExpiresAt: true,
    },
  },
  account: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, slug: true, timezone: true } },
  assignedStaff: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  partyDetail: {
    select: {
      id: true,
      partyName: true,
      roomResourceId: true,
      roomNameSnapshot: true,
      packageProduct: { select: { name: true } },
      roomResource: { select: { name: true } },
    },
  },
} satisfies Prisma.BookingInclude;

export function toBookingDto(
  row: Prisma.BookingGetPayload<{ include: typeof bookingInclude }>
) {
  return {
    id: row.id,
    publicId: row.publicId,
    orgId: row.orgId,
    locationId: row.locationId,
    status: row.status,
    channel: row.channel,
    createMode: row.createMode,
    userId: row.userId,
    accountId: row.accountId,
    account: row.account,
    primaryContactName: row.primaryContactName,
    primaryContactEmail: row.primaryContactEmail,
    primaryContactPhone: row.primaryContactPhone,
    assignedStaffUserId: row.assignedStaffUserId,
    assignedStaff: row.assignedStaff
      ? {
          id: row.assignedStaff.id,
          name:
            [row.assignedStaff.firstName, row.assignedStaff.lastName]
              .filter(Boolean)
              .join(" ") || row.assignedStaff.email,
          email: row.assignedStaff.email,
        }
      : null,
    taxExempt: row.taxExempt,
    taxExemptReason: row.taxExemptReason,
    subtotal: toNum(row.subtotal),
    taxAmount: toNum(row.taxAmount),
    total: toNum(row.total),
    amountPaid: toNum(row.amountPaid),
    amountDue: toNum(row.amountDue),
    notes: row.notes,
    posNotes: row.posNotes,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    reservedUntil: row.reservedUntil?.toISOString() ?? null,
    visitStartsAt: row.visitStartsAt?.toISOString() ?? null,
    visitEndsAt: row.visitEndsAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    reactivatedAt: row.reactivatedAt?.toISOString() ?? null,
    confirmationSentAt: row.confirmationSentAt?.toISOString() ?? null,
    // Never return viewToken on staff DTOs — magic/confirm links are minted server-side.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    location: row.location,
    lines: row.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      productType: l.productType,
      priceBandCode: l.priceBandCode,
      qty: l.qty,
      unitPrice: toNum(l.unitPrice),
      taxAmount: toNum(l.taxAmount),
      lineTotal: toNum(l.lineTotal),
      resourceId: l.resourceId,
      sessionId: l.sessionId,
      visitDate: l.visitDate?.toISOString() ?? null,
      passExpiresAt: l.passExpiresAt?.toISOString() ?? null,
    })),
    guests: row.guests,
    credentials: row.credentials,
    payments: row.payments.map((p) => ({
      id: p.id,
      tender: p.tender,
      amount: toNum(p.amount),
      currency: p.currency,
      status: p.status,
      splitGroupId: p.splitGroupId,
      createdAt: p.createdAt.toISOString(),
    })),
    activities: row.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      payload: a.payload,
      actorUserId: a.actorUserId,
      createdAt: a.createdAt.toISOString(),
    })),
    partyDetail: sanitizeStaffPartyDetail(row.partyDetail),
  };
}

function toBookingListDto(
  row: Prisma.BookingGetPayload<{ include: typeof bookingListInclude }>
) {
  return {
    id: row.id,
    publicId: row.publicId,
    orgId: row.orgId,
    locationId: row.locationId,
    status: row.status,
    channel: row.channel,
    createMode: row.createMode,
    userId: row.userId,
    accountId: row.accountId,
    account: row.account,
    primaryContactName: row.primaryContactName,
    primaryContactEmail: row.primaryContactEmail,
    primaryContactPhone: row.primaryContactPhone,
    assignedStaffUserId: row.assignedStaffUserId,
    assignedStaff: row.assignedStaff
      ? {
          id: row.assignedStaff.id,
          name:
            [row.assignedStaff.firstName, row.assignedStaff.lastName]
              .filter(Boolean)
              .join(" ") || row.assignedStaff.email,
          email: row.assignedStaff.email,
        }
      : null,
    taxExempt: row.taxExempt,
    taxExemptReason: row.taxExemptReason,
    subtotal: toNum(row.subtotal),
    taxAmount: toNum(row.taxAmount),
    total: toNum(row.total),
    amountPaid: toNum(row.amountPaid),
    amountDue: toNum(row.amountDue),
    notes: row.notes,
    posNotes: row.posNotes,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    reservedUntil: row.reservedUntil?.toISOString() ?? null,
    visitStartsAt: row.visitStartsAt?.toISOString() ?? null,
    visitEndsAt: row.visitEndsAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    reactivatedAt: row.reactivatedAt?.toISOString() ?? null,
    confirmationSentAt: row.confirmationSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    location: row.location,
    lines: row.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      productType: l.productType,
      priceBandCode: l.priceBandCode,
      qty: l.qty,
      unitPrice: toNum(l.unitPrice),
      taxAmount: toNum(l.taxAmount),
      lineTotal: toNum(l.lineTotal),
      resourceId: l.resourceId,
      sessionId: l.sessionId,
      visitDate: l.visitDate?.toISOString() ?? null,
      passExpiresAt: l.passExpiresAt?.toISOString() ?? null,
    })),
    guests: [] as unknown[],
    credentials: [] as unknown[],
    payments: [] as Array<{
      id: string;
      tender: string;
      amount: number;
      currency: string;
      status: string;
      splitGroupId: string | null;
      createdAt: string;
    }>,
    activities: [] as Array<{
      id: string;
      kind: string;
      payload: unknown;
      actorUserId: string | null;
      createdAt: string;
    }>,
    partyDetail: row.partyDetail
      ? {
          id: row.partyDetail.id,
          partyName: row.partyDetail.partyName,
          packageName: row.partyDetail.packageProduct?.name ?? null,
          roomResourceId: row.partyDetail.roomResourceId,
          roomName: row.partyDetail.roomResource?.name ?? row.partyDetail.roomNameSnapshot ?? null,
        }
      : null,
  };
}

function sanitizeStaffPartyDetail(
  party: Prisma.BookingGetPayload<{
    include: typeof bookingInclude;
  }>["partyDetail"]
) {
  if (!party) return null;
  const invitations =
    "invitations" in party && Array.isArray(party.invitations)
      ? party.invitations.map((inv) => ({
          id: inv.id,
          channel: inv.channel,
          sentTo: inv.sentTo,
          status: inv.status,
          sentAt: inv.sentAt?.toISOString?.() ?? inv.sentAt ?? null,
          respondedAt:
            inv.respondedAt?.toISOString?.() ?? inv.respondedAt ?? null,
          createdAt: inv.createdAt?.toISOString?.() ?? inv.createdAt,
          // Never expose RSVP tokens on bookings:read DTOs — copy from create invite.
        }))
      : [];
  const { invitations: _inv, ...rest } = party as typeof party & {
    invitations?: unknown;
  };
  return { ...rest, invitations };
}

function sanitizeGuestPartyDetail(
  party: Prisma.BookingGetPayload<{
    include: typeof bookingInclude;
  }>["partyDetail"]
) {
  if (!party) return null;
  const invitations =
    "invitations" in party && Array.isArray(party.invitations)
      ? party.invitations.map((inv) => ({
          id: inv.id,
          status: inv.status,
          sentTo: "sentTo" in inv ? inv.sentTo : null,
        }))
      : [];
  return {
    id: party.id,
    kidCount: party.kidCount,
    guests: "guests" in party ? party.guests : [],
    invitations,
  };
}

/** Guest-safe DTO — never expose POS notes, staff activity, staff assign, or invite tokens. */
export function toGuestBookingDto(
  row: Prisma.BookingGetPayload<{ include: typeof bookingInclude }>
) {
  const staff = toBookingDto(row);
  const {
    posNotes: _posNotes,
    activities: _activities,
    assignedStaff: _assignedStaff,
    assignedStaffUserId: _assignedStaffUserId,
    partyDetail: _partyDetail,
    ...guest
  } = staff;
  return {
    ...guest,
    // Guest already authenticated with this secret (checkout / confirmation / magic).
    viewToken: row.viewToken,
    credentials: row.credentials.map((c) => ({
      id: c.id,
      code: c.code,
      qrPayload: c.qrPayload,
      status: c.status,
      customTicketId: c.customTicketId,
      ticketToken: ticketViewToken(c.code, row.viewToken, row.publicId),
    })),
    partyDetail: sanitizeGuestPartyDetail(row.partyDetail),
  };
}

type LineSnapshot = {
  productId: string | null;
  productName: string;
  productType: AdmissionProductType;
  priceBandCode: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  resourceId: string | null;
  sessionId: string | null;
  visitDate: Date | null;
  passExpiresAt: Date | null;
  defaultPassExpiryDays: number | null;
};

function customLineSnapshots(custom: CustomLineInput[] | undefined): LineSnapshot[] {
  return (custom ?? []).map((c) => {
    const qty = Number(c.qty);
    const unitPrice = Math.round(Number(c.unitPrice) * 100) / 100;
    if (!Number.isInteger(qty) || qty < 1) throw new Error("Line qty must be a positive integer");
    if (!(unitPrice >= 0)) throw new Error("unitPrice must be 0 or more");
    return {
      productId: null,
      productName: c.productName.slice(0, 200),
      productType: "add_on" as AdmissionProductType,
      priceBandCode: c.priceBandCode,
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty * 100) / 100,
      resourceId: null,
      sessionId: null,
      visitDate: c.visitDate ?? null,
      passExpiresAt: null,
      defaultPassExpiryDays: null,
    };
  });
}

/**
 * Ticket heads for credentials + the ticketsPerMonth meter. Add-ons never count.
 * Party bookings count kidCount + adultCount once; their party_package lines
 * (one per party, plus extra-head pricing lines) are not counted by qty.
 */
export function bookingTicketHeads(
  lines: Array<{ productType: string; qty: number; passExpiresAt?: Date | null }>,
  party?: { kidCount: number; adultCount: number } | null
): Array<{ passExpiresAt?: Date | null }> {
  if (!party) return ticketHeadsFromLines(lines);
  const heads = ticketHeadsFromLines(
    lines.filter((l) => l.productType !== "party_package")
  );
  const pass = lines.find((l) => l.productType === "party_package")?.passExpiresAt ?? null;
  const partyHeads = Math.max(0, party.kidCount) + Math.max(0, party.adultCount);
  for (let i = 0; i < partyHeads; i++) heads.push({ passExpiresAt: pass });
  return heads;
}

async function resolveLineSnapshots(
  orgId: string,
  locationId: string,
  lines: BookingLineInput[],
  opts?: {
    requirePublished?: boolean;
    ignoreClientUnitPrice?: boolean;
    /** Party engine: guest counts are validated on PartyBookingDetail, not line qty. */
    partyCounted?: boolean;
  }
) {
  if (!lines.length) throw new Error("At least one booking line is required");
  const out: Array<{
    productId: string;
    productName: string;
    productType: AdmissionProductType;
    priceBandCode: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    resourceId: string | null;
    sessionId: string | null;
    visitDate: Date | null;
    passExpiresAt: Date | null;
    defaultPassExpiryDays: number | null;
  }> = [];

  for (const line of lines) {
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error("Line qty must be a positive integer");
    }
    const product = await prisma.admissionProduct.findFirst({
      where: {
        id: requireId(line.productId, "productId"),
        orgId,
        locationId,
        archivedAt: null,
        ...(opts?.requirePublished ? { published: true } : {}),
      },
      include: { prices: true },
    });
    if (!product) throw new ForbiddenError("Admission product not found");

    const countsOnDetail = opts?.partyCounted && product.type === "party_package";
    if (!countsOnDetail && product.minGuests != null && qty < product.minGuests) {
      throw new Error(`Quantity below minimum (${product.minGuests})`);
    }
    if (!countsOnDetail && product.maxGuests != null && qty > product.maxGuests) {
      throw new Error(`Quantity above maximum (${product.maxGuests})`);
    }

    // Add-ons rarely carry sessionId (session belongs to the admission product).
    // Inherit visit day from an earlier non-add-on line so stock periods align
    // with the booked visit instead of "now".
    const inheritedVisitDate =
      product.type === "add_on"
        ? out.find((l) => l.productType !== "add_on" && l.visitDate)?.visitDate ??
          null
        : null;

    const requestedVisitDate = line.visitDate ? new Date(line.visitDate) : null;
    if (requestedVisitDate && Number.isNaN(requestedVisitDate.getTime())) {
      throw new Error("visitDate is invalid");
    }

    if (product.type === "add_on") {
      const at = requestedVisitDate
        ? requestedVisitDate
        : inheritedVisitDate
          ? inheritedVisitDate
          : line.sessionId
            ? (
                await prisma.ticketSession.findFirst({
                  where: { id: line.sessionId },
                  select: { startsAt: true },
                })
              )?.startsAt ?? new Date()
            : new Date();
      await assertAddOnStockAvailable({
        orgId,
        locationId,
        productId: product.id,
        qty,
        at,
      });
    }

    let sessionId: string | null = null;
    let resourceId: string | null = product.resourceId;
    let visitDate: Date | null = requestedVisitDate;
    let unitPrice: number | null =
      opts?.ignoreClientUnitPrice || line.unitPrice == null
        ? null
        : Number(line.unitPrice);

    if (line.sessionId) {
      const session = await prisma.ticketSession.findFirst({
        where: {
          id: requireId(line.sessionId, "sessionId"),
          orgId,
          locationId,
          productId: product.id,
          isClosed: false,
        },
      });
      if (!session) throw new TicketingError(SESSION_SOLD_OUT, 409);
      sessionId = session.id;
      resourceId = line.resourceId ?? session.resourceId ?? resourceId;
      visitDate = session.startsAt;
      if (session.priceOverride != null && unitPrice == null) {
        unitPrice = toNum(session.priceOverride);
      }
    } else if (line.resourceId) {
      const resource = await prisma.capacityResource.findFirst({
        where: {
          id: requireId(line.resourceId, "resourceId"),
          orgId,
          locationId,
          archivedAt: null,
        },
      });
      if (!resource) throw new ForbiddenError("Capacity resource not found");
      resourceId = resource.id;
    }

    if (!visitDate && inheritedVisitDate) {
      visitDate = inheritedVisitDate;
    }

    const requestedBand = (line.priceBandCode || "").trim().toLowerCase();
    let bandCode = requestedBand;
    if (unitPrice == null) {
      if (!product.prices.length) {
        throw new Error("Product has no price bands");
      }
      let band;
      if (requestedBand) {
        band = product.prices.find(
          (p) => p.code.trim().toLowerCase() === requestedBand
        );
        if (!band) {
          throw new Error(
            `Unknown price band "${line.priceBandCode}" for ${product.name}`
          );
        }
      } else {
        // Legacy callers with no band: prefer adult, else first configured band.
        band =
          product.prices.find((p) => p.code.trim().toLowerCase() === "adult") ||
          product.prices[0];
      }
      bandCode = band.code.trim().toLowerCase();
      unitPrice = toNum(band.amount);
    } else if (!bandCode) {
      bandCode = "flat";
    }
    if (!(unitPrice > 0)) throw new Error("unitPrice must be > 0");

    let passExpiresAt: Date | null = null;
    if (product.defaultPassExpiryDays != null && visitDate) {
      passExpiresAt = new Date(visitDate);
      passExpiresAt.setUTCDate(
        passExpiresAt.getUTCDate() + product.defaultPassExpiryDays
      );
    }

    out.push({
      productId: product.id,
      productName: product.name,
      productType: product.type,
      priceBandCode: bandCode,
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty * 100) / 100,
      resourceId,
      sessionId,
      visitDate,
      passExpiresAt,
      defaultPassExpiryDays: product.defaultPassExpiryDays,
    });
  }

  // Required / maxQty / membership when non–add-on parents are present.
  const parentIds = [
    ...new Set(
      out.filter((l) => l.productType !== "add_on").map((l) => l.productId)
    ),
  ];
  if (parentIds.length) {
    const links = await prisma.admissionAddOnLink.findMany({
      where: {
        orgId,
        parentProductId: { in: parentIds },
      },
      select: {
        parentProductId: true,
        addOnProductId: true,
        required: true,
        maxQty: true,
      },
    });
    const linkedAddOnIds = new Set(links.map((l) => l.addOnProductId));
    for (const line of out) {
      if (line.productType !== "add_on") continue;
      if (!linkedAddOnIds.has(line.productId)) {
        throw new Error(
          "Add-on is not linked to a product on this booking"
        );
      }
    }
    const addOnQtyById = new Map<string, number>();
    for (const line of out) {
      if (line.productType !== "add_on") continue;
      addOnQtyById.set(
        line.productId,
        (addOnQtyById.get(line.productId) ?? 0) + line.qty
      );
    }
    for (const link of links) {
      if (link.required && !addOnQtyById.has(link.addOnProductId)) {
        throw new Error("Required add-on missing from booking lines");
      }
      if (link.maxQty != null) {
        const qty = addOnQtyById.get(link.addOnProductId) ?? 0;
        if (qty > link.maxQty) {
          throw new Error(
            `Add-on quantity exceeds max (${link.maxQty})`
          );
        }
      }
    }
  }

  return out;
}

async function recomputeTotals(
  orgId: string,
  lines: Array<{ lineTotal: number }>,
  taxExempt: boolean
) {
  const subtotal =
    Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  const tax = await previewBookingTax({ orgId, subtotal, taxExempt });
  // Booking money columns are numeric(12,2).
  if (!Number.isFinite(tax.total) || Math.abs(tax.total) >= 1e10) {
    throw new Error("Booking total is too large");
  }
  return {
    subtotal,
    taxAmount: tax.taxAmount,
    total: tax.total,
  };
}

/** Split booking-level tax across lines (last line absorbs rounding). */
function allocateLineTaxes(lineTotals: number[], taxAmount: number): number[] {
  const n = lineTotals.length;
  if (n === 0 || !(taxAmount > 0)) return lineTotals.map(() => 0);
  const subtotal = lineTotals.reduce((s, t) => s + t, 0);
  if (!(subtotal > 0)) return lineTotals.map(() => 0);
  const shares = lineTotals.map(
    (t) => Math.round((t / subtotal) * taxAmount * 100) / 100
  );
  const drift =
    Math.round((taxAmount - shares.reduce((s, x) => s + x, 0)) * 100) / 100;
  shares[n - 1] = Math.round((shares[n - 1] + drift) * 100) / 100;
  return shares;
}

function ticketHeadsFromLines(
  lines: Array<{ productType: string; qty: number; passExpiresAt?: Date | null }>
): Array<{ passExpiresAt?: Date | null }> {
  const heads: Array<{ passExpiresAt?: Date | null }> = [];
  for (const line of lines) {
    if (line.productType === "add_on") continue;
    for (let i = 0; i < line.qty; i++) {
      heads.push({ passExpiresAt: line.passExpiresAt });
    }
  }
  return heads;
}

async function restoreRestorableSessionCapacity(
  bookingId: string,
  lines: Array<{ sessionId: string | null; qty: number }>,
  tx: Prisma.TransactionClient
) {
  const heldQty = lines
    .filter((l) => l.sessionId)
    .reduce((s, l) => s + l.qty, 0);
  const restore = await restorableCapacityQty(bookingId, heldQty, tx);
  let remainingRestore = restore;
  for (const line of lines) {
    if (!line.sessionId || remainingRestore <= 0) continue;
    const qty = Math.min(line.qty, remainingRestore);
    await releaseSessionCapacity(line.sessionId, qty, tx);
    remainingRestore -= qty;
  }
  return restore;
}

async function consumeSessionQtySkippingRedeemed(
  snapshots: Array<{ sessionId: string | null; qty: number }>,
  redeemed: number,
  opts: { allowOverbook?: boolean },
  tx: Prisma.TransactionClient
) {
  let skip = Math.max(0, redeemed);
  for (const s of snapshots) {
    if (!s.sessionId) continue;
    let qty = s.qty;
    const absorb = Math.min(qty, skip);
    skip -= absorb;
    qty -= absorb;
    if (qty > 0) {
      await consumeCapacity({
        sessionId: s.sessionId,
        qty,
        allowOverbook: opts.allowOverbook,
        db: tx,
      });
    }
  }
}

async function syncDraftInvoiceAmounts(
  bookingId: string,
  amountDue: number,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (amountDue <= 0) {
    await syncPaidBookingInvoices(bookingId, db);
    return;
  }
  // Keep open invoices aligned with current debt (draft + still-collectible).
  await db.bookingInvoice.updateMany({
    where: { bookingId, status: { in: ["draft", "sent", "overdue"] } },
    data: { amount: money(amountDue), amountDue: money(amountDue) },
  });
  // Upsell / tax change after full pay: reopen paid invoices so ops see remaining due.
  await db.bookingInvoice.updateMany({
    where: { bookingId, status: "paid" },
    data: { status: "sent", amount: money(amountDue), amountDue: money(amountDue) },
  });
}

async function syncPaidBookingInvoices(
  bookingId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  await db.bookingInvoice.updateMany({
    where: {
      bookingId,
      status: { in: ["draft", "sent", "overdue"] },
    },
    data: { status: "paid", amountDue: money(0) },
  });
}

/** Guest self-cancel: status + optional visit cutoff (staff cancel bypasses). */
export function assertGuestCancelAllowed(
  booking: {
    status: BookingStatus;
    visitStartsAt: Date | null;
  },
  settings: { cancelCutoffMinutes: number | null }
) {
  const allowed: BookingStatus[] = [
    "hold",
    "reserved",
    "pending_payment",
    "confirmed",
  ];
  if (!allowed.includes(booking.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  if (
    settings.cancelCutoffMinutes != null &&
    booking.visitStartsAt
  ) {
    const cutoffMs = settings.cancelCutoffMinutes * 60_000;
    if (Date.now() >= booking.visitStartsAt.getTime() - cutoffMs) {
      throw new TicketingError(CANCEL_CUTOFF_PASSED, 403);
    }
  }
}

function visitBounds(
  lines: Array<{ visitDate: Date | null; sessionId: string | null }>,
  sessions: Array<{ id: string; startsAt: Date; endsAt: Date }>
) {
  const starts: Date[] = [];
  const ends: Date[] = [];
  for (const l of lines) {
    if (l.sessionId) {
      const s = sessions.find((x) => x.id === l.sessionId);
      if (s) {
        starts.push(s.startsAt);
        ends.push(s.endsAt);
      }
    } else if (l.visitDate) {
      starts.push(l.visitDate);
      ends.push(l.visitDate);
    }
  }
  if (!starts.length) return { visitStartsAt: null, visitEndsAt: null };
  return {
    visitStartsAt: new Date(Math.min(...starts.map((d) => d.getTime()))),
    visitEndsAt: new Date(Math.max(...ends.map((d) => d.getTime()))),
  };
}

export async function assertBookingNotPastLocked(
  booking: {
    visitStartsAt: Date | null;
    visitEndsAt: Date | null;
  },
  pastEditGraceMinutes: number
) {
  const now = Date.now();
  const graceMs = Math.max(0, pastEditGraceMinutes) * 60_000;
  if (pastEditGraceMinutes === 0) {
    if (booking.visitStartsAt && booking.visitStartsAt.getTime() < now) {
      throw new TicketingError(BOOKING_PAST_LOCKED, 403);
    }
    return;
  }
  const end = booking.visitEndsAt ?? booking.visitStartsAt;
  if (end && end.getTime() < now - graceMs) {
    throw new TicketingError(BOOKING_PAST_LOCKED, 403);
  }
}

export async function createBooking(
  actor: TicketingActor,
  input: CreateBookingInput,
  opts?: { skipStaffGate?: boolean; orgId?: string }
) {
  const orgId = opts?.orgId
    ? opts.orgId
    : opts?.skipStaffGate
      ? requireId(String(actor.orgId), "orgId")
      : await assertTicketingStaffMutate(actor);

  if (input.channel === "pos") {
    await assertPosEnabled(orgId);
  }

  if (!input.locationId || !isValidId(input.locationId)) {
    throw new Error("Venue location is required");
  }
  await requireActorVenue(orgId, input.locationId);
  if (!opts?.skipStaffGate) {
    await assertLocationInHqScope(actor, input.locationId);
    // Guest self-serve channels must come from publicBooking (skipStaffGate), not staff APIs.
    if (input.channel === "online" || input.channel === "account") {
      throw new Error(
        "Online bookings are created automatically when guests use your public booking page"
      );
    }
  }

  if (input.allowOverbook && opts?.skipStaffGate) {
    throw new TicketingError(OVERBOOK_FORBIDDEN, 403);
  }
  // Public/guest checkout cannot self-mark tax-exempt.
  if (opts?.skipStaffGate) {
    input.taxExempt = undefined;
  }

  const settings = await resolveBookingSettings(orgId, input.locationId);
  let createMode: BookingCreateMode =
    input.createMode ??
    (settings.defaultCreateMode === "prompt"
      ? "hold"
      : settings.defaultCreateMode);
  if (createMode !== "hold" && createMode !== "reserve" && createMode !== "prompt") {
    createMode = "hold";
  }
  if (input.channel === "online") {
    createMode = "hold";
  }
  // Persist prompt as hold until staff chooses at activate time.
  const persistedCreateMode: BookingCreateMode =
    createMode === "prompt" ? "hold" : createMode;
  // Activate must follow the same mapping — raw "prompt" must not skip hold.
  const activateMode: BookingCreateMode =
    createMode === "prompt" ? "hold" : createMode;

  const snapshots: LineSnapshot[] = [
    ...(await resolveLineSnapshots(
      orgId,
      input.locationId,
      input.lines,
      opts?.skipStaffGate
        ? { requirePublished: true, ignoreClientUnitPrice: true, partyCounted: Boolean(input.party) }
        : { ignoreClientUnitPrice: true, partyCounted: Boolean(input.party) }
    )),
    ...customLineSnapshots(input.customLines),
  ];
  const totals = await recomputeTotals(
    orgId,
    snapshots,
    Boolean(input.taxExempt ?? settings.defaultTaxExempt)
  );

  const sessionIds = snapshots
    .map((s) => s.sessionId)
    .filter((id): id is string => Boolean(id));
  const sessions = sessionIds.length
    ? await prisma.ticketSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, startsAt: true, endsAt: true },
      })
    : [];
  const bounds = visitBounds(snapshots, sessions);

  let primaryContactName = input.primaryContactName?.trim() || null;
  let primaryContactEmail = input.primaryContactEmail?.trim() || null;
  let primaryContactPhone = input.primaryContactPhone?.trim() || null;
  let accountId = input.accountId ? requireId(input.accountId, "accountId") : null;

  if (accountId) {
    const account = await prisma.bookingAccount.findFirst({
      where: { id: accountId, orgId, archivedAt: null },
      include: { contacts: true },
    });
    if (!account) throw new ForbiddenError("Booking account not found");
    if (input.accountContactId) {
      const contact = account.contacts.find(
        (c) => c.id === input.accountContactId
      );
      if (contact) {
        primaryContactName =
          primaryContactName ||
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
          null;
        primaryContactEmail = primaryContactEmail || contact.email;
        primaryContactPhone = primaryContactPhone || contact.phone;
      }
    }
  }

  // Online / account channels need email for confirmation + magic link.
  if (
    (input.channel === "online" || input.channel === "account") &&
    (!primaryContactEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primaryContactEmail))
  ) {
    throw new Error("Email is required for online bookings");
  }

  // Staff channels (walk_in / phone / pos): soft contact checks only.
  // Admin Create wizard enforces stricter guest-name rules client-side.
  // Public checkout is unchanged above. Marketing flags are not stored.
  if (
    input.channel === "walk_in" ||
    input.channel === "phone" ||
    input.channel === "pos"
  ) {
    const contactErr = validateStaffBookingContact({
      channel: input.channel,
      holderType: accountId ? "company" : "guest",
      accountId,
      name: primaryContactName,
      email: primaryContactEmail,
      phone: primaryContactPhone,
      // Wizard enforces guest-name UX; engine/POS keep API-compatible soft rules.
      requireGuestName: false,
    });
    if (contactErr) throw new Error(contactErr);
  }

  // Only attach userId from an authenticated session (never email-guess on public checkout).
  const userId = input.userId ?? null;
  if (primaryContactEmail) {
    primaryContactEmail = primaryContactEmail.toLowerCase();
  }

  const bookingId = await prisma.$transaction(
    async (tx) => {
    let publicId = generateBookingPublicId();
    for (let i = 0; i < 5; i++) {
      const clash = await tx.booking.findFirst({
        where: { publicId },
        select: { id: true },
      });
      if (!clash) break;
      publicId = generateBookingPublicId();
    }

    const row = await tx.booking.create({
      data: {
        publicId,
        viewToken: newPublicToken(),
        orgId,
        locationId: input.locationId,
        status: "draft",
        channel: input.channel,
        createMode: persistedCreateMode,
        userId,
        accountId,
        primaryContactName,
        primaryContactEmail,
        primaryContactPhone,
        taxExempt: Boolean(input.taxExempt ?? settings.defaultTaxExempt),
        subtotal: money(totals.subtotal),
        taxAmount: money(totals.taxAmount),
        total: money(totals.total),
        amountPaid: money(0),
        amountDue: money(totals.total),
        notes: input.notes?.trim() || null,
        posNotes: input.posNotes?.trim() || null,
        visitStartsAt: bounds.visitStartsAt,
        visitEndsAt: bounds.visitEndsAt,
        createdById: actorUserId(actor),
        updatedById: actorUserId(actor),
        lines: {
          create: snapshots.map((s, i) => ({
            orgId,
            productId: s.productId,
            productName: s.productName,
            productType: s.productType,
            priceBandCode: s.priceBandCode,
            qty: s.qty,
            unitPrice: money(s.unitPrice),
            taxAmount: money(
              allocateLineTaxes(
                snapshots.map((x) => x.lineTotal),
                totals.taxAmount
              )[i] ?? 0
            ),
            lineTotal: money(s.lineTotal),
            resourceId: s.resourceId,
            sessionId: s.sessionId,
            visitDate: s.visitDate,
            passExpiresAt: s.passExpiresAt,
          })),
        },
      },
      select: { id: true },
    });

    if (input.holdIds?.length) {
      const uniqueIds = [
        ...new Set(input.holdIds.map((id) => requireId(id, "holdId"))),
      ];
      const holds = await tx.bookingHold.findMany({
        where: {
          id: { in: uniqueIds },
          orgId,
          locationId: input.locationId,
          bookingId: null,
        },
      });
      if (holds.length !== uniqueIds.length) {
        throw new TicketingError(HOLD_EXPIRED, 410);
      }
      if (opts?.skipStaffGate) {
        const holdQty = new Map<string, number>();
        for (const h of holds) {
          if (!h.sessionId) continue;
          holdQty.set(h.sessionId, (holdQty.get(h.sessionId) ?? 0) + h.qty);
        }
        const lineQty = new Map<string, number>();
        for (const s of snapshots) {
          if (!s.sessionId) continue;
          lineQty.set(s.sessionId, (lineQty.get(s.sessionId) ?? 0) + s.qty);
        }
        if (holdQty.size !== lineQty.size) {
          throw new TicketingError(CHECKOUT_HOLD_MISMATCH, 400);
        }
        for (const [sessionId, qty] of holdQty) {
          if (lineQty.get(sessionId) !== qty) {
            throw new TicketingError(CHECKOUT_HOLD_MISMATCH, 400);
          }
        }
      }
      await tx.bookingHold.updateMany({
        where: { id: { in: uniqueIds } },
        data: { bookingId: row.id },
      });
      // So TTL expire can find attached holds before status flips to hold.
      const maxExp = holds.reduce(
        (m, h) => Math.max(m, h.expiresAt.getTime()),
        0
      );
      if (maxExp > 0) {
        await tx.booking.update({
          where: { id: row.id },
          data: { holdExpiresAt: new Date(maxExp) },
        });
      }
    }

    const partyLine = snapshots.find((s) => s.productType === "party_package");
    if (partyLine) {
      const roomId = input.party
        ? input.party.roomResourceId ?? null
        : partyLine.resourceId ?? null;
      const room = roomId
        ? await tx.capacityResource.findFirst({
            where: { id: roomId, orgId },
            select: { name: true },
          })
        : null;
      // Legacy creates (no party payload) keep line qty as heads.
      const legacyHeads = snapshots
        .filter((s) => s.productType === "party_package")
        .reduce((sum, s) => sum + s.qty, 0);
      await tx.partyBookingDetail.create({
        data: {
          bookingId: row.id,
          orgId,
          locationId: input.locationId,
          packageProductId: partyLine.productId,
          partyName:
            input.party?.partyName?.trim() ||
            primaryContactName ||
            partyLine.productName ||
            "Party",
          honoreeName: input.party?.honoreeName ?? null,
          honoreeAge: input.party?.honoreeAge ?? null,
          honoreeBirthDate: input.party?.honoreeBirthDate ?? null,
          kidCount: input.party ? input.party.kidCount : legacyHeads,
          adultCount: input.party ? input.party.adultCount : 0,
          roomResourceId: roomId,
          roomNameSnapshot: input.party?.roomNameSnapshot ?? room?.name ?? null,
          hostStaffUserId: input.party?.hostStaffUserId ?? null,
          hostNotes: input.party?.hostNotes ?? null,
          foodNotes: input.party?.foodNotes ?? null,
          opsStatus: "inquiry",
          depositRequiredCents: input.party?.depositRequiredCents ?? 0,
          depositDueAt: input.party?.depositDueAt ?? null,
          balanceDueAt: input.party?.balanceDueAt ?? null,
        },
      });
    }

    await logBookingActivity(
      {
        orgId,
        locationId: input.locationId,
        bookingId: row.id,
        kind: "created",
        payload: { channel: input.channel, createMode },
        actorUserId:
          actorUserId(actor),
      },
      tx
    );

    return row.id;
  },
    { maxWait: 15_000, timeout: 90_000 }
  );

  const booking = await prisma.booking.findFirstOrThrow({
    where: { id: bookingId },
    include: bookingInclude,
  });

  if (input.activate !== false && input.channel !== "online") {
    try {
      if (activateMode === "hold") {
        return await holdBooking(actor, booking.id, {
          allowOverbook: input.allowOverbook,
          orgId,
          skipStaffGate: opts?.skipStaffGate,
        });
      }
      if (activateMode === "reserve") {
        return await reserveBooking(actor, booking.id, {
          allowOverbook: input.allowOverbook,
          orgId,
          skipStaffGate: opts?.skipStaffGate,
        });
      }
    } catch (err) {
      // Draft was committed before activate. Clean up without leaking capacity:
      // - still draft → delete (no capacity held)
      // - hold/reserve already applied then a later step failed → cancel (releases seats)
      try {
        const live = await prisma.booking.findFirst({
          where: { id: bookingId },
          select: { status: true },
        });
        if (live?.status === "draft") {
          await prisma.booking.delete({ where: { id: bookingId } });
        } else if (
          live &&
          (live.status === "hold" || live.status === "reserved")
        ) {
          await cancelBooking(actor, bookingId, {
            orgId,
            skipStaffGate: opts?.skipStaffGate,
            reason: "activate_failed",
          });
        }
      } catch {
        // Best-effort cleanup; surface the activate error to the caller.
      }
      throw err;
    }
  }

  return toBookingDto(booking);
}

async function loadBookingForMutate(
  actor: TicketingActor,
  bookingId: string,
  opts?: { skipStaffGate?: boolean; orgId?: string; write?: boolean }
) {
  const orgId = opts?.orgId
    ? opts.orgId
    : opts?.skipStaffGate
      ? requireId(String(actor.orgId), "orgId")
      : opts?.write === false
        ? await assertTicketingStaffRead(actor)
        : await assertTicketingStaffMutate(actor);

  const booking = await prisma.booking.findFirst({
    where: { id: requireId(bookingId, "bookingId"), orgId },
    include: bookingInclude,
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  if (!opts?.skipStaffGate) {
    await assertLocationInHqScope(actor, booking.locationId);
  }
  return { orgId, booking };
}

/**
 * Party room occupancy for the booking's visit window. Row-locks the room so
 * concurrent holds on the same window serialize (last-room race).
 */
async function holdPartyRoom(
  tx: Prisma.TransactionClient,
  booking: { id: string; orgId: string; visitStartsAt: Date | null; visitEndsAt: Date | null },
  allowOverbook?: boolean
): Promise<{ overbooked: boolean }> {
  const party = await tx.partyBookingDetail.findUnique({
    where: { bookingId: booking.id },
    select: { roomResourceId: true },
  });
  if (!party?.roomResourceId || !booking.visitStartsAt) return { overbooked: false };
  const startsAt = booking.visitStartsAt;
  const endsAt =
    booking.visitEndsAt && booking.visitEndsAt > startsAt
      ? booking.visitEndsAt
      : new Date(startsAt.getTime() + 60_000);
  return assertPartyRoomFree(tx, {
    orgId: booking.orgId,
    roomId: party.roomResourceId,
    startsAt,
    endsAt,
    excludeBookingId: booking.id,
    allowOverbook,
  });
}

async function holdCapacityForBooking(
  booking: Prisma.BookingGetPayload<{ include: { lines: true } }>,
  opts: {
    ttlMinutes: number;
    mode: "hold" | "reserved";
    allowOverbook?: boolean;
    actorUserId?: string | null;
  }
) {
  const expiresAt = new Date(
    Date.now() + Math.max(1, opts.ttlMinutes) * 60_000
  );
  const wasHolding = ["hold", "reserved", "pending_payment", "confirmed"].includes(
    booking.status
  );

  return prisma.$transaction(
    async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
    `;
    const live = await tx.booking.findFirst({
      where: { id: booking.id },
      select: { status: true },
    });
    if (!live) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    if (["cancelled", "expired", "refunded"].includes(live.status)) {
      throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
    }

    // Release any prior holds then re-consume (idempotent re-hold).
    await releaseHoldsForBooking(booking.id, tx);
    if (wasHolding) {
      await restoreAddOnStockForLines(
        {
          bookingId: booking.id,
          orgId: booking.orgId,
          locationId: booking.locationId,
          lines: booking.lines,
        },
        tx
      );
    }

    let overbooked = false;
    for (const line of booking.lines) {
      if (!line.sessionId) continue;
      const result = await createSessionHold({
        orgId: booking.orgId,
        locationId: booking.locationId,
        sessionId: line.sessionId,
        qty: line.qty,
        expiresAt,
        bookingId: booking.id,
        resourceId: line.resourceId,
        allowOverbook: opts.allowOverbook,
        db: tx,
      });
      if (result.overbooked) overbooked = true;
    }

    // Re-holding a booking that already occupies its room must not re-judge the room.
    if (!wasHolding) {
      const roomCheck = await holdPartyRoom(tx, booking, opts.allowOverbook);
      if (roomCheck.overbooked) overbooked = true;
    }

    await consumeAddOnStockForLines(
      {
        bookingId: booking.id,
        orgId: booking.orgId,
        locationId: booking.locationId,
        lines: booking.lines,
      },
      tx
    );

    const status: BookingStatus =
      opts.mode === "hold" ? "hold" : "reserved";
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status,
        holdExpiresAt: opts.mode === "hold" ? expiresAt : null,
        reservedUntil: opts.mode === "reserved" ? expiresAt : null,
        cancelledAt: null,
        updatedById: opts.actorUserId ?? null,
      },
      include: bookingInclude,
    });
    await syncPartyOpsFromBooking(tx, booking.id);

    await logBookingActivity(
      {
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "status",
        payload: { to: status, overbooked },
        actorUserId: opts.actorUserId ?? null,
      },
      tx
    );
    if (overbooked) {
      await logBookingActivity(
        {
          orgId: booking.orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "system",
          payload: { event: "overbook" },
          actorUserId: opts.actorUserId ?? null,
        },
        tx
      );
    }
    return updated;
  },
    { maxWait: 15_000, timeout: 90_000 }
  );
}

export async function holdBooking(
  actor: TicketingActor,
  bookingId: string,
  opts?: {
    allowOverbook?: boolean;
    orgId?: string;
    skipStaffGate?: boolean;
  }
) {
  if (opts?.allowOverbook && opts.skipStaffGate) {
    throw new TicketingError(OVERBOOK_FORBIDDEN, 403);
  }
  const { booking } = await loadBookingForMutate(actor, bookingId, opts);
  if (booking.channel === "pos") {
    await assertPosEnabled(booking.orgId);
  }
  // Cancelled bookings must use reactivateBooking (clears cancelledAt).
  if (!["draft", "hold"].includes(booking.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  await assertVenueActiveForTicketingMutate(
    booking.orgId,
    booking.locationId
  );
  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );
  const updated = await holdCapacityForBooking(booking, {
    ttlMinutes: settings.holdTtlMinutes,
    mode: "hold",
    allowOverbook: opts?.allowOverbook,
    actorUserId: actorUserId(actor),
  });
  return toBookingDto(updated);
}

export async function reserveBooking(
  actor: TicketingActor,
  bookingId: string,
  opts?: {
    allowOverbook?: boolean;
    orgId?: string;
    skipStaffGate?: boolean;
  }
) {
  if (opts?.allowOverbook && opts.skipStaffGate) {
    throw new TicketingError(OVERBOOK_FORBIDDEN, 403);
  }
  const { booking } = await loadBookingForMutate(actor, bookingId, opts);
  // Cancelled bookings must use reactivateBooking (clears cancelledAt).
  if (!["draft", "hold", "reserved"].includes(booking.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  await assertVenueActiveForTicketingMutate(
    booking.orgId,
    booking.locationId
  );
  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );
  const updated = await holdCapacityForBooking(booking, {
    ttlMinutes: settings.reserveTtlHours * 60,
    mode: "reserved",
    allowOverbook: opts?.allowOverbook,
    actorUserId: actorUserId(actor),
  });
  return toBookingDto(updated);
}

export async function markBookingReviewed(
  actor: TicketingActor,
  bookingId: string
) {
  const { booking } = await loadBookingForMutate(actor, bookingId);
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      reviewedAt: new Date(),
      reviewedById: actorUserId(actor),
    },
    include: bookingInclude,
  });
  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "system",
    payload: { event: "reviewed" },
    actorUserId: actorUserId(actor),
  });
  return toBookingDto(updated);
}

export async function confirmBooking(
  actor: TicketingActor,
  bookingId: string,
  opts?: {
    orgId?: string;
    skipStaffGate?: boolean;
    autoReview?: boolean;
    allowUnpaid?: boolean;
    /** Party only: confirm below the deposit when settings allow it (partyEngine checks parties:write). */
    partyDepositOverrideReason?: string | null;
  }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId, opts);
  if (booking.channel === "pos") {
    await assertPosEnabled(booking.orgId);
  }
  if (
    !["hold", "reserved", "pending_payment", "draft", "confirmed"].includes(
      booking.status
    )
  ) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  if (booking.status === "confirmed") {
    return toBookingDto(booking);
  }

  const now = Date.now();
  let holdExpired =
    (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= now) ||
    (booking.reservedUntil && booking.reservedUntil.getTime() <= now);
  if (
    holdExpired &&
    ["hold", "reserved", "pending_payment"].includes(booking.status)
  ) {
    const { expireBookingHolds } = await import("@/lib/ticketing/expireHolds");
    await expireBookingHolds({
      orgId: booking.orgId,
      bookingId: booking.id,
      now: new Date(),
    });
    // Paid / in-flight Checkout extends TTL — reload and continue when still live.
    const reloaded = await prisma.booking.findFirst({
      where: { id: booking.id },
      include: bookingInclude,
    });
    if (!reloaded) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    if (
      ["cancelled", "expired", "refunded"].includes(reloaded.status)
    ) {
      throw new TicketingError(HOLD_EXPIRED, 410);
    }
    const stillExpired =
      (reloaded.holdExpiresAt &&
        reloaded.holdExpiresAt.getTime() <= Date.now()) ||
      (reloaded.reservedUntil &&
        reloaded.reservedUntil.getTime() <= Date.now());
    if (
      stillExpired &&
      ["hold", "reserved", "pending_payment"].includes(reloaded.status)
    ) {
      throw new TicketingError(HOLD_EXPIRED, 410);
    }
    Object.assign(booking, reloaded);
    holdExpired = false;
  }

  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );

  if (settings.requireReviewBeforeConfirm) {
    if (!booking.reviewedAt && !opts?.autoReview) {
      throw new TicketingError(BOOKING_REVIEW_REQUIRED, 403);
    }
  }

  const ticketHeads = bookingTicketHeads(booking.lines, booking.partyDetail).length;
  if (ticketHeads > 0) {
    await assertWithinPlanLimit(booking.orgId, "ticketsPerMonth", ticketHeads);
  }

  const willConfirm = toNum(booking.amountDue) <= 0 || Boolean(opts?.allowUnpaid);
  let depositOverride: string | null = null;
  if (willConfirm && booking.partyDetail) {
    const partySettings = await resolvePartySettings(booking.orgId, booking.locationId);
    const gate = assertPartyDepositGate({
      depositRequiredCents: booking.partyDetail.depositRequiredCents,
      amountPaidCents: Math.round(toNum(booking.amountPaid) * 100),
      settings: partySettings,
      overrideReason: opts?.partyDepositOverrideReason,
    });
    if (gate.overridden) depositOverride = opts?.partyDepositOverrideReason?.trim() ?? null;
  }

  // Ensure capacity is held for draft → confirm.
  if (booking.status === "draft") {
    await holdCapacityForBooking(booking, {
      ttlMinutes: settings.holdTtlMinutes,
      mode: "hold",
      actorUserId: actorUserId(actor),
    });
  }

  const amountDue = toNum(booking.amountDue);
  if (amountDue > 0 && !opts?.allowUnpaid) {
    // Stay pending_payment unless caller explicitly allows unpaid confirm
    // (pay-later / invoice / walk-in staff confirm).
    const pendingClaim = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        status: { in: ["draft", "hold", "reserved", "pending_payment"] },
      },
      data: {
        status: "pending_payment",
        reviewedAt:
          opts?.autoReview && !booking.reviewedAt
            ? new Date()
            : booking.reviewedAt,
        reviewedById:
          opts?.autoReview && !booking.reviewedAt
            ? actorUserId(actor)
            : booking.reviewedById,
      },
    });
    if (pendingClaim.count !== 1) {
      const live = await prisma.booking.findFirst({
        where: { id: booking.id },
        select: { status: true },
      });
      if (live && ["cancelled", "expired", "refunded"].includes(live.status)) {
        throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
      }
      throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
    }
    await syncPartyOpsFromBooking(prisma, booking.id);
    const pending = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: bookingInclude,
    });
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "status",
      payload: { to: "pending_payment" },
      actorUserId: actorUserId(actor),
    });
    return toBookingDto(pending);
  }

  const confirmed = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
      `;
      const live = await tx.booking.findFirst({
        where: { id: booking.id },
        select: { status: true },
      });
      if (!live) throw new TicketingError(BOOKING_NOT_FOUND, 404);
      if (live.status === "confirmed") {
        return tx.booking.findFirstOrThrow({
          where: { id: booking.id },
          include: bookingInclude,
        });
      }
      if (
        !["draft", "hold", "reserved", "pending_payment"].includes(live.status)
      ) {
        // Cancel/expire won the race — never resurrect.
        throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
      }

      // Capacity already held — convert holds into sold (delete hold rows without release).
      await tx.bookingHold.deleteMany({ where: { bookingId: booking.id } });

      const liveParty = await tx.partyBookingDetail.findUnique({
        where: { bookingId: booking.id },
        select: { kidCount: true, adultCount: true },
      });
      const heads = bookingTicketHeads(booking.lines, liveParty);
      await tx.ticketCredential.deleteMany({
        where: {
          bookingId: booking.id,
          status: { in: ["void", "expired"] },
        },
      });
      await syncLiveCredentialsToHeads(
        {
          orgId: booking.orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          heads,
        },
        tx
      );

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "confirmed",
          holdExpiresAt: null,
          reservedUntil: null,
          cancelledAt: null,
          reviewedAt:
            opts?.autoReview && !booking.reviewedAt
              ? new Date()
              : booking.reviewedAt,
          reviewedById:
            opts?.autoReview && !booking.reviewedAt
              ? actorUserId(actor)
              : booking.reviewedById,
          updatedById: actorUserId(actor),
        },
      });
      await syncPartyOpsFromBooking(tx, booking.id);
      await syncPartyMoney(tx, booking.id);
      const confirmedRow = await tx.booking.findFirstOrThrow({
        where: { id: booking.id },
        include: bookingInclude,
      });
      await enqueueBookingRev(tx, confirmedRow, confirmedRow.updatedAt.getTime());
      return confirmedRow;
    },
    { maxWait: 15_000, timeout: 90_000 }
  );
  flushAccountingQueueSoon(booking.orgId);

  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "status",
    payload: { to: "confirmed", ...(depositOverride ? { depositOverride } : {}) },
    actorUserId: actorUserId(actor),
  });
  if (depositOverride) {
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "system",
      payload: { event: "party_deposit_override", reason: depositOverride },
      actorUserId: actorUserId(actor),
    });
  }

  void sendBookingConfirmation({ bookingId: booking.id }).catch(() => undefined);

  if (confirmed.primaryContactEmail?.trim()) {
    void import("@/lib/guests/visitTouch")
      .then(({ touchGuestVisitFromBookingContact }) =>
        touchGuestVisitFromBookingContact({
          orgId: confirmed.orgId,
          locationId: confirmed.locationId,
          email: confirmed.primaryContactEmail!,
          name: confirmed.primaryContactName,
          phone: confirmed.primaryContactPhone,
        })
      )
      .catch(() => undefined);
  }

  return toBookingDto(confirmed);
}

export async function cancelBooking(
  actor: TicketingActor,
  bookingId: string,
  opts?: {
    reason?: string;
    orgId?: string;
    skipStaffGate?: boolean;
    /** Profile guest cancel — enforces cancelCutoffMinutes; staff bypasses. */
    guestCancel?: boolean;
  }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId, opts);
  if (["cancelled", "expired", "refunded"].includes(booking.status)) {
    return toBookingDto(booking);
  }

  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );
  if (opts?.guestCancel) {
    assertGuestCancelAllowed(booking, settings);
  } else {
    // SSOT D5: past-locked bookings allow notes/activity/assign/refund/void — not cancel.
    await assertBookingNotPastLocked(booking, settings.pastEditGraceMinutes);
  }

  const { cancelPendingStripeForBooking, voidPendingBookingPayments } =
    await import("@/lib/ticketing/pendingStripe");
  if (["hold", "reserved", "pending_payment"].includes(booking.status)) {
    await cancelPendingStripeForBooking(booking.id);
  }

  await prisma.$transaction(async (tx) => {
    // Serialize cancel vs refund so capacity is restored at most once.
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
    `;
    const locked = await tx.booking.findFirst({
      where: { id: booking.id },
      select: { status: true },
    });
    if (
      !locked ||
      ["cancelled", "expired", "refunded"].includes(locked.status)
    ) {
      return;
    }

    if (["hold", "reserved", "pending_payment"].includes(locked.status)) {
      await releaseHoldsForBooking(booking.id, tx);
      await restoreAddOnStockForLines(
        {
          bookingId: booking.id,
          orgId: booking.orgId,
          locationId: booking.locationId,
          lines: booking.lines,
        },
        tx
      );
    } else if (locked.status === "confirmed") {
      await restoreRestorableSessionCapacity(booking.id, booking.lines, tx);
      await voidUnusedCredentials(booking.id, tx);
      await restoreAddOnStockForLines(
        {
          bookingId: booking.id,
          orgId: booking.orgId,
          locationId: booking.locationId,
          lines: booking.lines,
        },
        tx
      );
    } else if (locked.status === "draft") {
      // No capacity held — still release any attached holds if present.
      await releaseHoldsForBooking(booking.id, tx);
    }

    await voidPendingBookingPayments(booking.id, tx);

    await tx.bookingPaymentLink.deleteMany({
      where: { bookingId: booking.id },
    });

    const cancelled = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        holdExpiresAt: null,
        reservedUntil: null,
        updatedById: actorUserId(actor),
      },
    });
    await syncPartyOpsFromBooking(tx, booking.id);
    await enqueueBookingRev(tx, cancelled, cancelled.updatedAt.getTime());

    await logBookingActivity(
      {
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "status",
        payload: {
          to: "cancelled",
          reason: opts?.reason ?? null,
          amountPaid: toNum(booking.amountPaid),
          refundPrompt: toNum(booking.amountPaid) > 0,
        },
        actorUserId: actorUserId(actor),
      },
      tx
    );
  });
  flushAccountingQueueSoon(booking.orgId);

  const fresh = await prisma.booking.findFirstOrThrow({
    where: { id: booking.id },
    include: bookingInclude,
  });
  void sendBookingCancellation({ bookingId: booking.id }).catch(() => undefined);
  return toBookingDto(fresh);
}

export async function reactivateBooking(
  actor: TicketingActor,
  bookingId: string,
  opts: {
    targetStatus: "draft" | "hold" | "reserved";
    allowOverbook?: boolean;
  }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId);
  if (booking.status !== "cancelled") {
    // Refunded (and other statuses) cannot reactivate without a finance epic.
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "draft",
        cancelledAt: null,
        reactivatedAt: new Date(),
      },
    });
    await syncPartyOpsFromBooking(tx, booking.id);
    await enqueueBookingRev(tx, updated, updated.updatedAt.getTime());
    await logBookingActivity(
      {
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "status",
        payload: { to: "draft", event: "reactivate" },
        actorUserId: actorUserId(actor),
      },
      tx
    );
  });
  flushAccountingQueueSoon(booking.orgId);

  if (opts.targetStatus === "draft") {
    const fresh = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: bookingInclude,
    });
    return toBookingDto(fresh);
  }
  try {
    if (opts.targetStatus === "hold") {
      return await holdBooking(actor, booking.id, {
        allowOverbook: opts.allowOverbook,
      });
    }
    return await reserveBooking(actor, booking.id, {
      allowOverbook: opts.allowOverbook,
    });
  } catch (err) {
    // Capacity unavailable — restore cancelled so we never leave a zombie draft.
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "cancelled",
        cancelledAt: booking.cancelledAt ?? new Date(),
        reactivatedAt: null,
        holdExpiresAt: null,
        reservedUntil: null,
      },
    });
    await syncPartyOpsFromBooking(prisma, booking.id);
    await logBookingActivity({
      orgId: booking.orgId,
      locationId: booking.locationId,
      bookingId: booking.id,
      kind: "status",
      payload: {
        to: "cancelled",
        event: "reactivate_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      actorUserId: actorUserId(actor),
    });
    throw err;
  }
}

export async function getBooking(
  actor: TicketingActor,
  bookingId: string,
  opts?: { skipStaffGate?: boolean; orgId?: string }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId, {
    ...opts,
    write: false,
  });
  return toBookingDto(booking);
}

/**
 * Transactional replace of booking lines (products/qty/sessions/resources/dates).
 * Restocks old sessions and re-holds when status holds capacity.
 */
export async function replaceBookingLines(
  actor: TicketingActor,
  bookingId: string,
  lines: BookingLineInput[],
  opts?: {
    allowOverbook?: boolean;
    /** Party engine edit: detail fields written in the same transaction. */
    party?: Partial<PartyDetailInput>;
    customLines?: CustomLineInput[];
    /** Party host / system reprice: org already resolved by the caller. */
    orgId?: string;
    skipStaffGate?: boolean;
  }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId, {
    orgId: opts?.orgId,
    skipStaffGate: opts?.skipStaffGate,
  });
  if (["cancelled", "expired", "refunded"].includes(booking.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );
  await assertBookingNotPastLocked(booking, settings.pastEditGraceMinutes);
  await assertVenueActiveForTicketingMutate(
    booking.orgId,
    booking.locationId
  );

  // Line replace changes due — void in-flight card Checkout only (keep invoice markers).
  if (["hold", "reserved", "pending_payment"].includes(booking.status)) {
    const { cancelPendingStripeForBooking, voidPendingCardPayments } =
      await import("@/lib/ticketing/pendingStripe");
    await cancelPendingStripeForBooking(booking.id);
    await voidPendingCardPayments(booking.id);
  }

  const partyEdit = opts?.party;
  const snapshots: LineSnapshot[] = [
    ...(await resolveLineSnapshots(booking.orgId, booking.locationId, lines, {
      partyCounted: Boolean(partyEdit),
    })),
    ...customLineSnapshots(opts?.customLines),
  ];
  const totals = await recomputeTotals(
    booking.orgId,
    snapshots,
    booking.taxExempt
  );
  const sessionIds = snapshots
    .map((s) => s.sessionId)
    .filter((id): id is string => Boolean(id));
  const sessions = sessionIds.length
    ? await prisma.ticketSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, startsAt: true, endsAt: true },
      })
    : [];
  const bounds = visitBounds(snapshots, sessions);
  const holdsCapacity = [
    "hold",
    "reserved",
    "pending_payment",
    "confirmed",
  ].includes(booking.status);
  const amountPaid = toNum(booking.amountPaid);
  const amountDue = Math.max(
    0,
    Math.round((totals.total - amountPaid) * 100) / 100
  );
  const lineTaxes = allocateLineTaxes(
    snapshots.map((s) => s.lineTotal),
    totals.taxAmount
  );
  const partyLine = snapshots.find((s) => s.productType === "party_package");
  if (partyLine?.productId && !partyEdit) {
    const product = await prisma.admissionProduct.findFirst({
      where: { id: partyLine.productId },
      select: { minGuests: true, maxGuests: true },
    });
    const detail = await prisma.partyBookingDetail.findFirst({
      where: { bookingId: booking.id },
      include: { guests: { select: { id: true } } },
    });
    const guestCount = detail?.guests.length ?? 0;
    if (guestCount > 0) {
      if (product?.minGuests != null && guestCount < product.minGuests) {
        throw new Error(
          `Party guests below package minimum (${product.minGuests})`
        );
      }
      if (product?.maxGuests != null && guestCount > product.maxGuests) {
        throw new Error(
          `Party guests above package maximum (${product.maxGuests})`
        );
      }
      if (partyLine.resourceId) {
        const room = await prisma.capacityResource.findFirst({
          where: { id: partyLine.resourceId, orgId: booking.orgId },
          select: { defaultCapacity: true },
        });
        const cap = room?.defaultCapacity ?? 0;
        if (cap > 0 && guestCount > cap) {
          throw new Error(`Party guests exceed room capacity (${cap})`);
        }
      }
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
      `;
      const liveStatus = await tx.booking.findFirst({
        where: { id: booking.id },
        select: { status: true },
      });
      if (!liveStatus) throw new TicketingError(BOOKING_NOT_FOUND, 404);
      if (
        ["cancelled", "expired", "refunded"].includes(liveStatus.status)
      ) {
        throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
      }

      if (holdsCapacity) {
        if (["hold", "reserved", "pending_payment"].includes(booking.status)) {
          await releaseHoldsForBooking(booking.id, tx);
          await restoreAddOnStockForLines(
            {
              bookingId: booking.id,
              orgId: booking.orgId,
              locationId: booking.locationId,
              lines: booking.lines,
            },
            tx
          );
        } else if (booking.status === "confirmed") {
          const nextParty = booking.partyDetail
            ? {
                kidCount: partyEdit?.kidCount ?? booking.partyDetail.kidCount,
                adultCount: partyEdit?.adultCount ?? booking.partyDetail.adultCount,
              }
            : null;
          const newHeldQty = nextParty
            ? bookingTicketHeads(snapshots, nextParty).length
            : snapshots
                .filter((s) => s.sessionId)
                .reduce((s, l) => s + l.qty, 0);
          const redeemed = await countRedeemedHeads(booking.id, tx);
          if (newHeldQty < redeemed) {
            throw new TicketingError(REDEEMED_QTY_LOCKED, 400);
          }
          await restoreRestorableSessionCapacity(
            booking.id,
            booking.lines,
            tx
          );
          await restoreAddOnStockForLines(
            {
              bookingId: booking.id,
              orgId: booking.orgId,
              locationId: booking.locationId,
              lines: booking.lines,
            },
            tx
          );
        }
      }

      await tx.bookingLine.deleteMany({ where: { bookingId: booking.id } });
      await tx.bookingLine.createMany({
        data: snapshots.map((s, i) => ({
          bookingId: booking.id,
          orgId: booking.orgId,
          productId: s.productId,
          productName: s.productName,
          productType: s.productType,
          priceBandCode: s.priceBandCode,
          qty: s.qty,
          unitPrice: money(s.unitPrice),
          taxAmount: money(lineTaxes[i] ?? 0),
          lineTotal: money(s.lineTotal),
          resourceId: s.resourceId,
          sessionId: s.sessionId,
          visitDate: s.visitDate,
          passExpiresAt: s.passExpiresAt,
        })),
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          subtotal: money(totals.subtotal),
          taxAmount: money(totals.taxAmount),
          total: money(totals.total),
          amountDue: money(amountDue),
          visitStartsAt: bounds.visitStartsAt,
          visitEndsAt: bounds.visitEndsAt,
          updatedById: actorUserId(actor),
        },
      });
      await syncDraftInvoiceAmounts(booking.id, amountDue, tx);

      let partyRoomMoved = false;
      if (partyLine) {
        const roomId =
          partyEdit && partyEdit.roomResourceId !== undefined
            ? partyEdit.roomResourceId
            : partyEdit
              ? booking.partyDetail?.roomResourceId ?? null
              : partyLine.resourceId;
        const roomName = roomId
          ? (
              await tx.capacityResource.findFirst({
                where: { id: roomId, orgId: booking.orgId },
                select: { name: true },
              })
            )?.name ?? null
          : null;
        partyRoomMoved =
          roomId !== (booking.partyDetail?.roomResourceId ?? null) ||
          bounds.visitStartsAt?.getTime() !== booking.visitStartsAt?.getTime() ||
          bounds.visitEndsAt?.getTime() !== booking.visitEndsAt?.getTime();
        const detailPatch = {
          packageProductId: partyLine.productId,
          roomResourceId: roomId,
          roomNameSnapshot: partyEdit?.roomNameSnapshot ?? roomName,
          ...(partyEdit?.partyName !== undefined ? { partyName: partyEdit.partyName } : {}),
          ...(partyEdit?.honoreeName !== undefined ? { honoreeName: partyEdit.honoreeName } : {}),
          ...(partyEdit?.honoreeAge !== undefined ? { honoreeAge: partyEdit.honoreeAge } : {}),
          ...(partyEdit?.honoreeBirthDate !== undefined
            ? { honoreeBirthDate: partyEdit.honoreeBirthDate }
            : {}),
          ...(partyEdit?.kidCount !== undefined ? { kidCount: partyEdit.kidCount } : {}),
          ...(partyEdit?.adultCount !== undefined ? { adultCount: partyEdit.adultCount } : {}),
          ...(partyEdit?.hostNotes !== undefined ? { hostNotes: partyEdit.hostNotes } : {}),
          ...(partyEdit?.foodNotes !== undefined ? { foodNotes: partyEdit.foodNotes } : {}),
          ...(partyEdit?.depositRequiredCents !== undefined
            ? { depositRequiredCents: partyEdit.depositRequiredCents }
            : {}),
          ...(partyEdit?.depositDueAt !== undefined ? { depositDueAt: partyEdit.depositDueAt } : {}),
          ...(partyEdit?.balanceDueAt !== undefined ? { balanceDueAt: partyEdit.balanceDueAt } : {}),
        };
        await tx.partyBookingDetail.upsert({
          where: { bookingId: booking.id },
          create: {
            bookingId: booking.id,
            orgId: booking.orgId,
            locationId: booking.locationId,
            partyName: booking.primaryContactName || partyLine.productName || "Party",
            kidCount: snapshots
              .filter((s) => s.productType === "party_package")
              .reduce((sum, s) => sum + s.qty, 0),
            ...detailPatch,
          },
          update: detailPatch,
        });
      } else {
        await tx.partyBookingDetail.deleteMany({
          where: { bookingId: booking.id },
        });
      }

      if (holdsCapacity) {
        const ttlMinutes =
          booking.status === "reserved"
            ? settings.reserveTtlHours * 60
            : settings.holdTtlMinutes;
        const expiresAt = new Date(
          Date.now() + Math.max(1, ttlMinutes) * 60_000
        );
        if (booking.status === "confirmed") {
          const redeemed = await countRedeemedHeads(booking.id, tx);
          await consumeSessionQtySkippingRedeemed(
            snapshots,
            redeemed,
            { allowOverbook: opts?.allowOverbook },
            tx
          );
          const liveParty = partyLine
            ? await tx.partyBookingDetail.findUnique({
                where: { bookingId: booking.id },
                select: { kidCount: true, adultCount: true },
              })
            : null;
          await syncLiveCredentialsToHeads(
            {
              orgId: booking.orgId,
              locationId: booking.locationId,
              bookingId: booking.id,
              heads: bookingTicketHeads(snapshots, liveParty),
            },
            tx
          );
        } else {
          for (const s of snapshots) {
            if (!s.sessionId) continue;
            await createSessionHold({
              orgId: booking.orgId,
              locationId: booking.locationId,
              sessionId: s.sessionId,
              qty: s.qty,
              expiresAt,
              bookingId: booking.id,
              resourceId: s.resourceId,
              allowOverbook: opts?.allowOverbook,
              db: tx,
            });
          }
        }
        await consumeAddOnStockForLines(
          {
            bookingId: booking.id,
            orgId: booking.orgId,
            locationId: booking.locationId,
            lines: snapshots,
          },
          tx
        );
        if (
          booking.status === "hold" ||
          booking.status === "pending_payment"
        ) {
          await tx.booking.update({
            where: { id: booking.id },
            data: { holdExpiresAt: expiresAt, reservedUntil: null },
          });
        } else if (booking.status === "reserved") {
          await tx.booking.update({
            where: { id: booking.id },
            data: { reservedUntil: expiresAt, holdExpiresAt: null },
          });
        }
        // Unchanged room + window keeps its (possibly approved-overbook) occupancy.
        if (partyLine && partyRoomMoved) {
          await holdPartyRoom(
            tx,
            {
              id: booking.id,
              orgId: booking.orgId,
              visitStartsAt: bounds.visitStartsAt,
              visitEndsAt: bounds.visitEndsAt,
            },
            opts?.allowOverbook
          );
        }
      }
      if (partyLine) await syncPartyMoney(tx, booking.id);

      const afterReplace = await tx.booking.findFirstOrThrow({
        where: { id: booking.id },
        select: { id: true, orgId: true, locationId: true, updatedAt: true },
      });
      await enqueueBookingRev(tx, afterReplace, afterReplace.updatedAt.getTime());

      await logBookingActivity(
        {
          orgId: booking.orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "edited",
          payload: { event: "lines_replaced", lineCount: snapshots.length },
          actorUserId: actorUserId(actor),
        },
        tx
      );
    },
    { maxWait: 15_000, timeout: 90_000 }
  );
  flushAccountingQueueSoon(booking.orgId);

  return getBooking(actor, booking.id, {
    orgId: opts?.orgId,
    skipStaffGate: opts?.skipStaffGate,
  });
}

/**
 * Staff booking list + search (HQ scope applied).
 * Search SSOT for guest/email/phone/publicId/cardFingerprint — used by list UI + export.
 */
export async function listBookings(
  actor: TicketingActor,
  filters: {
    status?: BookingStatus;
    locationId?: string;
    q?: string;
    amountDueOnly?: boolean;
    /** Alias for amountDueOnly when truthy ("true"/"1"). */
    amountDue?: boolean;
    sessionId?: string;
    accountId?: string;
    channel?: BookingChannel;
    partyOnly?: boolean;
    productType?: AdmissionProductType;
    visitDate?: string;
    visitFrom?: string;
    visitTo?: string;
    assignedStaffUserId?: string;
    /** When true (and no status filter), include cancelled/expired/refunded. */
    includeClosed?: boolean;
    skip?: number;
    take?: number;
  } = {}
) {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.BookingWhereInput = { orgId: scope.orgId };
  applyTicketingLocationScope(scope, where);
  if (
    !scope.parkLocked &&
    !scope.locationId &&
    filters.locationId &&
    isValidId(filters.locationId)
  ) {
    where.locationId = filters.locationId;
  }
  const STATUSES: BookingStatus[] = [
    "draft",
    "hold",
    "reserved",
    "pending_payment",
    "confirmed",
    "cancelled",
    "expired",
    "refunded",
  ];
  const CHANNELS: BookingChannel[] = [
    "online",
    "phone",
    "walk_in",
    "pos",
    "account",
  ];
  if (filters.status) {
    if (!STATUSES.includes(filters.status)) {
      throw new Error("Invalid status");
    }
    where.status = filters.status;
  } else if (!filters.includeClosed) {
    // Default list hides terminal soft-delete statuses so Cancel/Delete
    // removes the row from the working table (reload-safe).
    where.status = {
      notIn: ["cancelled", "expired", "refunded"],
    };
  }
  if (filters.amountDueOnly || filters.amountDue) {
    where.amountDue = { gt: 0 };
  }
  if (filters.channel) {
    if (!CHANNELS.includes(filters.channel)) {
      throw new Error("Invalid channel");
    }
    where.channel = filters.channel;
  }
  if (filters.accountId && isValidId(filters.accountId)) {
    where.accountId = filters.accountId;
  }
  if (filters.sessionId && isValidId(filters.sessionId)) {
    where.lines = { some: { sessionId: filters.sessionId } };
  }
  if (filters.productType) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { lines: { some: { productType: filters.productType } } },
    ];
  }
  if (filters.partyOnly) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { partyDetail: { isNot: null } },
          { lines: { some: { productType: "party_package" } } },
        ],
      },
    ];
  }
  if (filters.assignedStaffUserId && isValidId(filters.assignedStaffUserId)) {
    where.assignedStaffUserId = filters.assignedStaffUserId;
  }
  // Date filters: park TZ when a single venue is in scope; else UTC (multi-park).
  const scopedLocationId =
    (typeof where.locationId === "string" && where.locationId) ||
    (filters.locationId && isValidId(filters.locationId)
      ? filters.locationId
      : null);
  let visitTz: string | null = null;
  if (
    scopedLocationId &&
    (filters.visitFrom?.trim() ||
      filters.visitTo?.trim() ||
      filters.visitDate?.trim())
  ) {
    const venue = await prisma.venueLocation.findFirst({
      where: { id: scopedLocationId, orgId: scope.orgId },
      select: { timezone: true },
    });
    visitTz = venue?.timezone ?? null;
  }
  if (filters.visitFrom?.trim() || filters.visitTo?.trim()) {
    const range: { gte?: Date; lt?: Date } = {};
    if (filters.visitFrom?.trim()) {
      const start = visitDayStart(filters.visitFrom, visitTz);
      if (start) range.gte = start;
    }
    if (filters.visitTo?.trim()) {
      const end = visitDayEndExclusive(filters.visitTo, visitTz);
      if (end) range.lt = end;
    }
    if (range.gte || range.lt) where.visitStartsAt = range;
  } else if (filters.visitDate?.trim()) {
    const start = visitDayStart(filters.visitDate, visitTz);
    const end = visitDayEndExclusive(filters.visitDate, visitTz);
    if (start && end) where.visitStartsAt = { gte: start, lt: end };
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { publicId: { contains: q, mode: "insensitive" } },
      { primaryContactEmail: { contains: q, mode: "insensitive" } },
      { primaryContactName: { contains: q, mode: "insensitive" } },
      { primaryContactPhone: { contains: q } },
      { payments: { some: { stripePaymentIntentId: { contains: q } } } },
      { payments: { some: { cardFingerprint: { contains: q } } } },
      {
        credentials: {
          some: {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { customTicketId: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const take = Math.min(200, Math.max(1, Number(filters.take) || 50));
  const skip = Math.max(0, Number(filters.skip) || 0);
  // Parallel — avoid interactive transaction overhead on the hot list path.
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: bookingListInclude,
      orderBy: { visitStartsAt: "desc" },
      take,
      skip,
    }),
    prisma.booking.count({ where }),
  ]);
  return { bookings: rows.map(toBookingListDto), total, take, skip };
}

export async function patchBookingNotes(
  actor: TicketingActor,
  bookingId: string,
  notes: string | null
) {
  const { booking } = await loadBookingForMutate(actor, bookingId);
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { notes, updatedById: actorUserId(actor) },
    include: bookingInclude,
  });
  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "note",
    payload: { field: "notes" },
    actorUserId: actorUserId(actor),
  });
  return toBookingDto(updated);
}

export async function patchBookingPosNotes(
  actor: TicketingActor,
  bookingId: string,
  posNotes: string | null,
  opts?: { skipStaffGate?: boolean; orgId?: string }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId, opts);
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { posNotes, updatedById: actorUserId(actor) },
    include: bookingInclude,
  });
  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "note",
    payload: { field: "posNotes" },
    actorUserId: actorUserId(actor),
  });
  return toBookingDto(updated);
}

export async function patchBookingTaxExemption(
  actor: TicketingActor,
  bookingId: string,
  taxExempt: boolean,
  reason?: string | null
) {
  const { booking } = await loadBookingForMutate(actor, bookingId);
  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );
  await assertBookingNotPastLocked(booking, settings.pastEditGraceMinutes);

  const lineSnapshots = booking.lines.map((l) => ({
    lineTotal: toNum(l.lineTotal),
  }));
  const totals = await recomputeTotals(booking.orgId, lineSnapshots, taxExempt);
  const amountPaid = toNum(booking.amountPaid);
  const amountDue = Math.max(0, Math.round((totals.total - amountPaid) * 100) / 100);
  const lineTaxes = allocateLineTaxes(
    booking.lines.map((l) => toNum(l.lineTotal)),
    totals.taxAmount
  );

  const updated = await prisma.$transaction(async (tx) => {
    for (let i = 0; i < booking.lines.length; i++) {
      const line = booking.lines[i]!;
      await tx.bookingLine.update({
        where: { id: line.id },
        data: { taxAmount: money(lineTaxes[i] ?? 0) },
      });
    }
    const row = await tx.booking.update({
      where: { id: booking.id },
      data: {
        taxExempt,
        taxExemptReason: reason?.trim() || null,
        subtotal: money(totals.subtotal),
        taxAmount: money(totals.taxAmount),
        total: money(totals.total),
        amountDue: money(amountDue),
        updatedById: actorUserId(actor),
      },
      include: bookingInclude,
    });
    await syncDraftInvoiceAmounts(booking.id, amountDue, tx);
    await enqueueBookingRev(tx, row, row.updatedAt.getTime());
    return row;
  });
  flushAccountingQueueSoon(booking.orgId);
  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "edited",
    payload: { event: "tax_exempt", taxExempt, reason },
    actorUserId: actorUserId(actor),
  });
  return toBookingDto(updated);
}

export async function assignBookingStaff(
  actor: TicketingActor,
  bookingId: string,
  staffUserId: string
) {
  const { booking, orgId } = await loadBookingForMutate(actor, bookingId);
  const membership = await prisma.membership.findFirst({
    where: {
      userId: requireId(staffUserId, "staffUserId"),
      orgId,
      status: "active",
    },
  });
  if (!membership) throw new ForbiddenError("Staff membership not found");

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      assignedStaffUserId: staffUserId,
      updatedById: actorUserId(actor),
    },
    include: bookingInclude,
  });
  await logBookingActivity({
    orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "staff_assign",
    payload: { staffUserId },
    actorUserId: actorUserId(actor),
  });
  try {
    const { createNotification } = await import(
      "@/services/notificationService"
    );
    await createNotification(
      staffUserId,
      "Booking assigned",
      `You were assigned booking ${booking.publicId}.`,
      "system",
      { bookingId: booking.id, publicId: booking.publicId }
    );
  } catch {
    /* optional */
  }
  return toBookingDto(updated);
}

export async function moveBookingLineResource(
  actor: TicketingActor,
  bookingId: string,
  patch: {
    lineId: string;
    resourceId: string;
    sessionId?: string | null;
    allowOverbook?: boolean;
  }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId);
  const settings = await resolveBookingSettings(
    booking.orgId,
    booking.locationId
  );
  await assertBookingNotPastLocked(booking, settings.pastEditGraceMinutes);

  const line = booking.lines.find((l) => l.id === patch.lineId);
  if (!line) throw new Error("Booking line not found");

  const resource = await prisma.capacityResource.findFirst({
    where: {
      id: requireId(patch.resourceId, "resourceId"),
      orgId: booking.orgId,
      locationId: booking.locationId,
      archivedAt: null,
    },
  });
  if (!resource) throw new ForbiddenError("Capacity resource not found");

  let nextSessionId = patch.sessionId === undefined ? line.sessionId : patch.sessionId;
  if (nextSessionId) {
    const session = await prisma.ticketSession.findFirst({
      where: {
        id: requireId(nextSessionId, "sessionId"),
        orgId: booking.orgId,
        locationId: booking.locationId,
        isClosed: false,
      },
    });
    if (!session) throw new TicketingError(RESOURCE_CONFLICT, 409);
    nextSessionId = session.id;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (
        line.sessionId &&
        nextSessionId &&
        line.sessionId !== nextSessionId &&
        ["hold", "reserved", "pending_payment", "confirmed"].includes(
          booking.status
        )
      ) {
        await moveSessionCapacity({
          fromSessionId: line.sessionId,
          toSessionId: nextSessionId,
          qty: line.qty,
          allowOverbook: patch.allowOverbook,
          db: tx,
        });
        // Keep BookingHold.sessionId in sync so cancel/expire release the right session.
        if (
          ["hold", "reserved", "pending_payment"].includes(booking.status)
        ) {
          // Retarget one hold for this line (not every hold on the old session).
          const hold = await tx.bookingHold.findFirst({
            where: {
              bookingId: booking.id,
              sessionId: line.sessionId,
              qty: line.qty,
            },
            orderBy: { createdAt: "asc" },
          });
          if (hold) {
            await tx.bookingHold.update({
              where: { id: hold.id },
              data: { sessionId: nextSessionId },
            });
          } else {
            // Fallback: oldest hold on that session (legacy rows without qty match).
            const fallback = await tx.bookingHold.findFirst({
              where: {
                bookingId: booking.id,
                sessionId: line.sessionId,
              },
              orderBy: { createdAt: "asc" },
            });
            if (fallback) {
              await tx.bookingHold.update({
                where: { id: fallback.id },
                data: { sessionId: nextSessionId },
              });
            }
          }
        }
      }
      await tx.bookingLine.update({
        where: { id: line.id },
        data: {
          resourceId: resource.id,
          sessionId: nextSessionId,
        },
      });

      const lines = await tx.bookingLine.findMany({
        where: { bookingId: booking.id },
        select: { visitDate: true, sessionId: true },
      });
      const sessionIds = lines
        .map((l) => l.sessionId)
        .filter((id): id is string => Boolean(id));
      const sessions = sessionIds.length
        ? await tx.ticketSession.findMany({
            where: { id: { in: sessionIds } },
            select: { id: true, startsAt: true, endsAt: true },
          })
        : [];
      const bounds = visitBounds(lines, sessions);
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          visitStartsAt: bounds.visitStartsAt,
          visitEndsAt: bounds.visitEndsAt,
          updatedById: actorUserId(actor),
        },
      });
      if (line.productType === "party_package" && booking.partyDetail) {
        if (!["party_room", "room"].includes(resource.type)) {
          throw new ForbiddenError("Party packages need a room or party room");
        }
        await tx.partyBookingDetail.update({
          where: { bookingId: booking.id },
          data: { roomResourceId: resource.id, roomNameSnapshot: resource.name },
        });
        if (
          ["hold", "reserved", "pending_payment", "confirmed"].includes(booking.status)
        ) {
          await holdPartyRoom(
            tx,
            {
              id: booking.id,
              orgId: booking.orgId,
              visitStartsAt: bounds.visitStartsAt,
              visitEndsAt: bounds.visitEndsAt,
            },
            patch.allowOverbook
          );
        }
      }
    });
  } catch (err) {
    if (err instanceof TicketingError && err.code === SESSION_SOLD_OUT) {
      throw new TicketingError(RESOURCE_CONFLICT, 409);
    }
    throw err;
  }

  await logBookingActivity({
    orgId: booking.orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "edited",
    payload: {
      event: "resource_move",
      lineId: line.id,
      resourceId: resource.id,
      sessionId: nextSessionId,
    },
    actorUserId: actorUserId(actor),
  });

  return getBooking(actor, booking.id);
}

/** Move admission lines onto another session. Past-lock uses BookingSettings. */
export async function rescheduleBooking(
  actor: TicketingActor,
  bookingId: string,
  input: { sessionId: string; lineId?: string | null; allowOverbook?: boolean }
) {
  const { booking } = await loadBookingForMutate(actor, bookingId);
  if (booking.channel === "pos") {
    await assertPosEnabled(booking.orgId);
  }
  const settings = await resolveBookingSettings(booking.orgId, booking.locationId);
  await assertBookingNotPastLocked(booking, settings.pastEditGraceMinutes);
  const targetId = requireId(input.sessionId, "sessionId");
  const session = await prisma.ticketSession.findFirst({
    where: {
      id: targetId,
      orgId: booking.orgId,
      locationId: booking.locationId,
      isClosed: false,
    },
  });
  if (!session) throw new TicketingError(RESOURCE_CONFLICT, 409);
  const lines = booking.lines.filter((l) => !input.lineId || l.id === input.lineId);
  if (!lines.length) throw new Error("Booking line not found");
  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.sessionId && line.sessionId !== session.id) {
        await moveSessionCapacity({
          fromSessionId: line.sessionId,
          toSessionId: session.id,
          qty: line.qty,
          allowOverbook: input.allowOverbook,
          db: tx,
        });
      }
      await tx.bookingLine.update({
        where: { id: line.id },
        data: { sessionId: session.id },
      });
    }
  });
  return getBooking(actor, booking.id);
}

export async function updateBookingAmountsAfterPayment(
  bookingId: string,
  paidDelta: number,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const booking = await db.booking.findFirst({ where: { id: bookingId } });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  const amountPaid =
    Math.round((toNum(booking.amountPaid) + paidDelta) * 100) / 100;
  const amountDue = Math.max(
    0,
    Math.round((toNum(booking.total) - amountPaid) * 100) / 100
  );
  const updated = await db.booking.update({
    where: { id: bookingId },
    data: {
      amountPaid: money(amountPaid),
      amountDue: money(amountDue),
    },
  });
  if (amountDue <= 0) {
    await syncPaidBookingInvoices(bookingId, db);
  } else {
    await syncDraftInvoiceAmounts(bookingId, amountDue, db);
  }
  // Every booking payment path (staff tenders, Stripe settle, payment link,
  // invoice pay) lands here, so party deposit state cannot drift.
  await syncPartyMoney(db, bookingId);
  // AR balance changed — enqueue rev sync inside the caller's transaction.
  // Callers flush after commit; do not flush here (may be nested in a TX).
  await enqueueBookingRev(db, updated, updated.updatedAt.getTime());
  return updated;
}

export function parseCreateBookingBody(body: unknown): CreateBookingInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  const CHANNELS: BookingChannel[] = [
    "online",
    "phone",
    "walk_in",
    "pos",
    "account",
  ];
  // Default staff creates to at-venue; public checkout always passes online|account.
  const rawChannel = String(b.channel ?? "walk_in");
  if (!CHANNELS.includes(rawChannel as BookingChannel)) {
    throw new Error("Invalid channel");
  }
  const channel = rawChannel as BookingChannel;
  const linesRaw = Array.isArray(b.lines) ? b.lines : [];
  return {
    locationId: String(b.locationId ?? ""),
    channel,
    createMode:
      b.createMode !== undefined
        ? (String(b.createMode) as BookingCreateMode)
        : undefined,
    lines: linesRaw.map((raw) => {
      const l = raw as Record<string, unknown>;
      return {
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
      };
    }),
    primaryContactName:
      typeof b.primaryContactName === "string" ? b.primaryContactName : null,
    primaryContactEmail:
      typeof b.primaryContactEmail === "string" ? b.primaryContactEmail : null,
    primaryContactPhone:
      typeof b.primaryContactPhone === "string" ? b.primaryContactPhone : null,
    accountId:
      b.accountId == null || b.accountId === ""
        ? null
        : String(b.accountId),
    accountContactId:
      b.accountContactId == null || b.accountContactId === ""
        ? null
        : String(b.accountContactId),
    notes: typeof b.notes === "string" ? b.notes : null,
    posNotes: typeof b.posNotes === "string" ? b.posNotes : null,
    taxExempt: b.taxExempt !== undefined ? Boolean(b.taxExempt) : undefined,
    allowOverbook: Boolean(b.allowOverbook),
    activate: b.activate === undefined ? true : Boolean(b.activate),
    holdIds: Array.isArray(b.holdIds)
      ? (b.holdIds as string[])
      : undefined,
  };
}

export { bookingInclude, toNum, money, holdPartyRoom };
