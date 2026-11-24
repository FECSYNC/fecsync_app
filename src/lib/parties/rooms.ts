/**
 * Party rooms = CapacityResource (party_room; legacy `room` rows stay assignable).
 * A party occupies its room for [visitStartsAt, visitEndsAt) while the booking
 * is live, or while the party is checked in / in progress (a refund after the
 * party started never frees the room).
 *
 * Must not import bookingEngine — the engine calls `assertPartyRoomFree`.
 */
import type { BookingStatus, CapacityResourceType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import {
  assertVenueWritable,
  locationInPartyScope,
  partyLocationWhere,
  rejectBodyOrgId,
  resolvePartyLocationId,
} from "@/lib/parties/scope";
import {
  TicketingError,
  PARTY_NAME_TAKEN,
  PARTY_ROOM_ARCHIVED,
  PARTY_ROOM_CONFLICT,
  partyNotFound,
} from "@/lib/parties/errors";
import { logPartyAudit } from "@/lib/parties/activity";

type Db = Prisma.TransactionClient | typeof prisma;

export const PARTY_ROOM_TYPES: CapacityResourceType[] = ["party_room", "room"];

export const ROOM_OCCUPYING_BOOKING_STATUSES: BookingStatus[] = [
  "hold",
  "reserved",
  "pending_payment",
  "confirmed",
];

export function toPartyRoomDto(row: {
  id: string;
  locationId: string;
  name: string;
  type: CapacityResourceType;
  defaultCapacity: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  location?: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    locationId: row.locationId,
    name: row.name,
    type: row.type,
    defaultCapacity: row.defaultCapacity,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    location: row.location ?? null,
  };
}

function parseRoomName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length < 2) throw new Error("Room name is required");
  if (name.length > 160) throw new Error("Room name is too long");
  return name;
}

function parseCapacity(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100_000) {
    throw new Error("Capacity must be a whole number of 0 or more");
  }
  return n;
}

async function assertRoomNameFree(
  orgId: string,
  locationId: string,
  name: string,
  excludeId?: string
) {
  const clash = await prisma.capacityResource.findFirst({
    where: {
      orgId,
      locationId,
      type: { in: PARTY_ROOM_TYPES },
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new TicketingError(PARTY_NAME_TAKEN, 409);
}

export async function listPartyRooms(
  actor: PartyActor,
  opts: { locationId?: string | null; includeArchived?: boolean } = {}
) {
  const ctx = await partyStaffContext(actor);
  const rows = await prisma.capacityResource.findMany({
    where: {
      orgId: ctx.orgId,
      type: { in: PARTY_ROOM_TYPES },
      ...partyLocationWhere(ctx.scope, opts.locationId),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    include: { location: { select: { id: true, name: true } } },
    orderBy: [{ locationId: "asc" }, { name: "asc" }],
  });
  return rows.map(toPartyRoomDto);
}

export async function createPartyRoom(actor: PartyActor, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  const locationId = await resolvePartyLocationId(actor, ctx.scope, body.locationId);
  await assertVenueWritable(ctx.orgId, locationId);
  const name = parseRoomName(body.name);
  const defaultCapacity = parseCapacity(body.defaultCapacity ?? 0);
  await assertRoomNameFree(ctx.orgId, locationId, name);
  const row = await prisma.capacityResource.create({
    data: { orgId: ctx.orgId, locationId, name, type: "party_room", defaultCapacity },
    include: { location: { select: { id: true, name: true } } },
  });
  logPartyAudit(actor, ctx.orgId, {
    action: "parties.room.create",
    entityType: "Settings",
    entityId: row.id,
    description: `Party room ${name} created`,
    metadata: { locationId },
  });
  return toPartyRoomDto(row);
}

export async function updatePartyRoom(actor: PartyActor, roomId: string, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  if (!isValidId(roomId)) throw partyNotFound();
  const existing = await prisma.capacityResource.findFirst({
    where: { id: roomId, orgId: ctx.orgId, type: { in: PARTY_ROOM_TYPES } },
  });
  if (!existing || !locationInPartyScope(ctx.scope, existing.locationId)) {
    throw partyNotFound();
  }
  const data: Prisma.CapacityResourceUpdateInput = {};
  if (body.archive === true) {
    data.archivedAt = new Date();
  } else if (body.unarchive === true) {
    await assertVenueWritable(ctx.orgId, existing.locationId);
    await assertRoomNameFree(ctx.orgId, existing.locationId, existing.name, existing.id);
    data.archivedAt = null;
  } else {
    await assertVenueWritable(ctx.orgId, existing.locationId);
  }
  if (body.name !== undefined) {
    const name = parseRoomName(body.name);
    await assertRoomNameFree(ctx.orgId, existing.locationId, name, existing.id);
    data.name = name;
  }
  if (body.defaultCapacity !== undefined) {
    data.defaultCapacity = parseCapacity(body.defaultCapacity);
  }
  const row = await prisma.capacityResource.update({
    where: { id: existing.id },
    data,
    include: { location: { select: { id: true, name: true } } },
  });
  logPartyAudit(actor, ctx.orgId, {
    action: body.archive === true ? "parties.room.archive" : "parties.room.update",
    entityType: "Settings",
    entityId: row.id,
    description: `Party room ${row.name} ${body.archive === true ? "archived" : "updated"}`,
    metadata: { locationId: row.locationId },
  });
  return toPartyRoomDto(row);
}

/**
 * A room that may be newly assigned to a party: same org + venue, room type,
 * not archived. Cross-tenant ids are 404; archived rooms are PARTY_ROOM_ARCHIVED.
 */
export async function requireAssignableRoom(
  orgId: string,
  locationId: string,
  roomId: string,
  db: Db = prisma
) {
  if (!isValidId(roomId)) throw partyNotFound();
  const room = await db.capacityResource.findFirst({
    where: { id: roomId, orgId, locationId, type: { in: PARTY_ROOM_TYPES } },
  });
  if (!room) throw partyNotFound();
  if (room.archivedAt) throw new TicketingError(PARTY_ROOM_ARCHIVED, 400);
  return room;
}

function occupyingWhere(opts: {
  orgId: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  excludeBookingId?: string | null;
}): Prisma.PartyBookingDetailWhereInput {
  return {
    orgId: opts.orgId,
    roomResourceId: opts.roomId,
    ...(opts.excludeBookingId ? { bookingId: { not: opts.excludeBookingId } } : {}),
    booking: {
      visitStartsAt: { lt: opts.endsAt },
      visitEndsAt: { gt: opts.startsAt },
    },
    OR: [
      { booking: { status: { in: ROOM_OCCUPYING_BOOKING_STATUSES } } },
      { opsStatus: { in: ["checked_in", "in_progress"] } },
    ],
  };
}

export async function findRoomConflicts(
  opts: {
    orgId: string;
    roomId: string;
    startsAt: Date;
    endsAt: Date;
    excludeBookingId?: string | null;
  },
  db: Db = prisma
) {
  return db.partyBookingDetail.findMany({
    where: occupyingWhere(opts),
    select: {
      bookingId: true,
      partyName: true,
      opsStatus: true,
      booking: {
        select: { publicId: true, status: true, visitStartsAt: true, visitEndsAt: true },
      },
    },
    orderBy: { booking: { visitStartsAt: "asc" } },
  });
}

/**
 * Race-safe room check inside the caller's transaction: row-lock the room, then
 * look for overlapping occupants. Two concurrent holds on the last free window
 * serialize on the lock, so only one can win.
 */
export async function assertPartyRoomFree(
  tx: Prisma.TransactionClient,
  opts: {
    orgId: string;
    roomId: string;
    startsAt: Date;
    endsAt: Date;
    excludeBookingId?: string | null;
    allowOverbook?: boolean;
  }
): Promise<{ overbooked: boolean; conflicts: number }> {
  await tx.$queryRaw`SELECT id FROM capacity_resources WHERE id = ${opts.roomId} FOR UPDATE`;
  const conflicts = await tx.partyBookingDetail.count({ where: occupyingWhere(opts) });
  if (conflicts > 0 && !opts.allowOverbook) {
    throw new TicketingError(PARTY_ROOM_CONFLICT, 409);
  }
  return { overbooked: conflicts > 0, conflicts };
}

/** Room availability for a window at a venue (staff picker + conflict warning). */
export async function partyRoomAvailability(
  actor: PartyActor,
  opts: {
    locationId?: string | null;
    startsAt: string;
    endsAt: string;
    excludeBookingId?: string | null;
  }
) {
  const ctx = await partyStaffContext(actor);
  const startsAt = new Date(opts.startsAt);
  const endsAt = new Date(opts.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new Error("startsAt and endsAt must be a valid window");
  }
  const locationId = await resolvePartyLocationId(actor, ctx.scope, opts.locationId, {
    allowArchived: true,
  });
  const excludeBookingId =
    opts.excludeBookingId && isValidId(opts.excludeBookingId) ? opts.excludeBookingId : null;
  const rooms = await prisma.capacityResource.findMany({
    where: { orgId: ctx.orgId, locationId, type: { in: PARTY_ROOM_TYPES }, archivedAt: null },
    orderBy: { name: "asc" },
  });
  const occupants = rooms.length
    ? await prisma.partyBookingDetail.findMany({
        where: {
          orgId: ctx.orgId,
          roomResourceId: { in: rooms.map((r) => r.id) },
          ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}),
          booking: { visitStartsAt: { lt: endsAt }, visitEndsAt: { gt: startsAt } },
          OR: [
            { booking: { status: { in: ROOM_OCCUPYING_BOOKING_STATUSES } } },
            { opsStatus: { in: ["checked_in", "in_progress"] } },
          ],
        },
        select: {
          roomResourceId: true,
          bookingId: true,
          partyName: true,
          booking: { select: { publicId: true, visitStartsAt: true, visitEndsAt: true } },
        },
      })
    : [];
  return {
    locationId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    rooms: rooms.map((room) => {
      const conflicts = occupants
        .filter((o) => o.roomResourceId === room.id)
        .map((o) => ({
          bookingId: o.bookingId,
          publicId: o.booking.publicId,
          partyName: o.partyName,
          visitStartsAt: o.booking.visitStartsAt?.toISOString() ?? null,
          visitEndsAt: o.booking.visitEndsAt?.toISOString() ?? null,
        }));
      return {
        id: room.id,
        name: room.name,
        defaultCapacity: room.defaultCapacity,
        available: conflicts.length === 0,
        conflicts,
      };
    }),
  };
}