/**
 * Party loaders. Cross-tenant and out-of-scope ids are 404 (PARTY_NOT_FOUND)
 * so a party id is never confirmed to exist outside the actor's scope.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { partyNotFound } from "@/lib/parties/errors";
import { locationInPartyScope } from "@/lib/parties/scope";
import type { PartyStaffContext } from "@/lib/parties/gate";

export const partyDetailInclude = {
  guests: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  invitations: { orderBy: { createdAt: "desc" } },
  runSheetItems: { orderBy: { sortOrder: "asc" } },
  foodOrders: {
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  },
  roomResource: { select: { id: true, name: true, defaultCapacity: true, archivedAt: true } },
  packageProduct: {
    select: { id: true, name: true, minGuests: true, maxGuests: true, locationId: true },
  },
  hostStaff: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.PartyBookingDetailInclude;

export const partyBookingInclude = {
  lines: true,
  payments: { orderBy: { createdAt: "desc" } },
  location: { select: { id: true, name: true, slug: true, timezone: true } },
  partyDetail: { include: partyDetailInclude },
} satisfies Prisma.BookingInclude;

export type PartyBookingRow = Prisma.BookingGetPayload<{ include: typeof partyBookingInclude }>;
export type LoadedParty = PartyBookingRow & {
  partyDetail: NonNullable<PartyBookingRow["partyDetail"]>;
};

/** Booking statuses where the party can still be edited / invited / fed. */
export const LIVE_PARTY_BOOKING_STATUSES = ["draft", "hold", "reserved", "pending_payment", "confirmed"];

export function isPartyLive(status: string): boolean {
  return LIVE_PARTY_BOOKING_STATUSES.includes(status);
}

/**
 * Party bookings created before PartyBookingDetail existed get a detail row on
 * first read (same shape the engine writes for legacy creates).
 */
async function ensureLegacyDetail(booking: PartyBookingRow): Promise<PartyBookingRow> {
  if (booking.partyDetail) return booking;
  const partyLines = booking.lines.filter((l) => l.productType === "party_package");
  if (!partyLines.length) return booking;
  await prisma.partyBookingDetail.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      orgId: booking.orgId,
      locationId: booking.locationId,
      packageProductId: partyLines[0]!.productId,
      roomResourceId: partyLines[0]!.resourceId,
      partyName: booking.primaryContactName || partyLines[0]!.productName || "Party",
      kidCount: partyLines.reduce((s, l) => s + l.qty, 0),
    },
    update: {},
  });
  return prisma.booking.findFirstOrThrow({
    where: { id: booking.id },
    include: partyBookingInclude,
  });
}

export async function loadPartyById(
  orgId: string,
  bookingId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<LoadedParty> {
  if (!isValidId(bookingId)) throw partyNotFound();
  let booking = await db.booking.findFirst({
    where: { id: bookingId, orgId },
    include: partyBookingInclude,
  });
  if (!booking) throw partyNotFound();
  booking = await ensureLegacyDetail(booking);
  if (!booking.partyDetail) throw partyNotFound();
  return booking as LoadedParty;
}

export async function loadStaffParty(ctx: PartyStaffContext, bookingId: string): Promise<LoadedParty> {
  const party = await loadPartyById(ctx.orgId, bookingId);
  if (!locationInPartyScope(ctx.scope, party.locationId)) throw partyNotFound();
  return party;
}

/** Signed-in host: own booking only (userId match). Others → 404. */
export async function loadOwnerParty(userId: string, bookingId: string): Promise<LoadedParty> {
  if (!isValidId(bookingId) || !isValidId(userId)) throw partyNotFound();
  let booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: partyBookingInclude,
  });
  if (!booking) throw partyNotFound();
  booking = await ensureLegacyDetail(booking);
  if (!booking.partyDetail) throw partyNotFound();
  return booking as LoadedParty;
}
