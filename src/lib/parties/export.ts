/**
 * Company workspace export — parties section. Same-org only. No card data,
 * Stripe ids, tokens, or guest contact details.
 */
import prisma from "@/lib/prisma";
import { toCents } from "@/lib/parties/deposits";
import { PARTY_ROOM_TYPES } from "@/lib/parties/rooms";

export async function buildPartiesExport(orgId: string) {
  const [packages, details, rooms, menuItems, guests, invitations, foodOrders] = await Promise.all([
    prisma.admissionProduct.findMany({
      where: { orgId, type: "party_package" },
      select: {
        id: true,
        name: true,
        locationId: true,
        published: true,
        archivedAt: true,
        location: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.partyBookingDetail.findMany({
      where: { orgId },
      select: {
        bookingId: true,
        locationId: true,
        partyName: true,
        roomNameSnapshot: true,
        kidCount: true,
        adultCount: true,
        opsStatus: true,
        depositRequiredCents: true,
        depositPaidCents: true,
        roomResource: { select: { name: true } },
        location: { select: { name: true } },
        booking: { select: { publicId: true, status: true, visitStartsAt: true, amountDue: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.capacityResource.findMany({
      where: { orgId, type: { in: PARTY_ROOM_TYPES } },
      select: { id: true, name: true, locationId: true, defaultCapacity: true, archivedAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.partyMenuItem.findMany({
      where: { orgId },
      select: { id: true, name: true, locationId: true, kind: true, priceCents: true, available: true, archivedAt: true },
      orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.partyGuest.count({ where: { orgId } }),
    prisma.partyInvitation.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } }),
    prisma.partyFoodOrder.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } }),
  ]);

  const byStatus = (rows: Array<{ status: string; _count: { _all: number } }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

  return {
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      locationId: p.locationId,
      venueName: p.location?.name ?? null,
      published: p.published,
      archived: Boolean(p.archivedAt),
    })),
    bookings: details.map((d) => ({
      publicId: d.booking.publicId,
      visitStartsAt: d.booking.visitStartsAt?.toISOString() ?? null,
      locationId: d.locationId,
      venueName: d.location?.name ?? null,
      partyName: d.partyName,
      roomName: d.roomResource?.name ?? d.roomNameSnapshot ?? null,
      kidCount: d.kidCount,
      adultCount: d.adultCount,
      opsStatus: d.opsStatus,
      bookingStatus: d.booking.status,
      depositRequiredCents: d.depositRequiredCents,
      depositPaidCents: d.depositPaidCents,
      amountDueCents: toCents(d.booking.amountDue),
    })),
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      locationId: r.locationId,
      capacity: r.defaultCapacity,
      archived: Boolean(r.archivedAt),
    })),
    menuItems: menuItems.map((m) => ({
      id: m.id,
      name: m.name,
      locationId: m.locationId,
      kind: m.kind,
      priceCents: m.priceCents,
      available: m.available,
      archived: Boolean(m.archivedAt),
    })),
    counts: {
      parties: details.length,
      guests,
      invitationsByStatus: byStatus(invitations),
      foodOrdersByStatus: byStatus(foodOrders),
    },
  };
}
