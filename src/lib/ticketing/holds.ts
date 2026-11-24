/**
 * BookingHold rows + capacity linkage.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { consumeCapacity, releaseSessionCapacity } from "@/lib/ticketing/capacity";
import { TicketingError, HOLD_EXPIRED, SESSION_SOLD_OUT } from "@/lib/ticketing/errors";
import { requireId } from "@/lib/ids";

type Db = Prisma.TransactionClient | typeof prisma;

export async function createSessionHold(opts: {
  orgId: string;
  locationId: string;
  sessionId: string;
  qty: number;
  expiresAt: Date;
  bookingId?: string | null;
  resourceId?: string | null;
  allowOverbook?: boolean;
  db?: Db;
}) {
  if (!opts.db) {
    return prisma.$transaction((tx) =>
      createSessionHold({ ...opts, db: tx })
    );
  }
  const db = opts.db;
  const sessionId = requireId(opts.sessionId, "sessionId");
  const { overbooked } = await consumeCapacity({
    sessionId,
    qty: opts.qty,
    allowOverbook: opts.allowOverbook,
    db,
  });

  const hold = await db.bookingHold.create({
    data: {
      orgId: opts.orgId,
      locationId: opts.locationId,
      sessionId,
      resourceId: opts.resourceId ?? null,
      bookingId: opts.bookingId ?? null,
      qty: opts.qty,
      expiresAt: opts.expiresAt,
    },
  });

  return { hold, overbooked };
}

export async function releaseHoldById(
  holdId: string,
  db: Db = prisma
): Promise<void> {
  const id = requireId(holdId, "holdId");
  // Claim delete first so concurrent releases cannot double-restore capacity.
  const hold = await db.bookingHold.findFirst({ where: { id } });
  if (!hold) return;
  const deleted = await db.bookingHold.deleteMany({ where: { id } });
  if (deleted.count !== 1) return;
  if (hold.sessionId) {
    await releaseSessionCapacity(hold.sessionId, hold.qty, db);
  }
}

export async function releaseHoldsForBooking(
  bookingId: string,
  db: Db = prisma
): Promise<void> {
  const holds = await db.bookingHold.findMany({
    where: { bookingId: requireId(bookingId, "bookingId") },
  });
  for (const h of holds) {
    if (h.sessionId) {
      await releaseSessionCapacity(h.sessionId, h.qty, db);
    }
  }
  if (holds.length) {
    await db.bookingHold.deleteMany({ where: { bookingId } });
  }
}

export async function assertHoldActive(
  holdId: string,
  db: Db = prisma
) {
  const hold = await db.bookingHold.findFirst({
    where: { id: requireId(holdId, "holdId") },
  });
  if (!hold) throw new TicketingError(HOLD_EXPIRED, 410);
  if (hold.expiresAt.getTime() <= Date.now()) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  return hold;
}

export async function getHoldByToken(token: string, db: Db = prisma) {
  const hold = await db.bookingHold.findFirst({
    where: { token },
  });
  if (!hold) throw new TicketingError(HOLD_EXPIRED, 410);
  if (hold.expiresAt.getTime() <= Date.now()) {
    throw new TicketingError(HOLD_EXPIRED, 410);
  }
  return hold;
}

/** Attach orphan holds to a booking after create. */
export async function attachHoldsToBooking(
  holdIds: string[],
  bookingId: string,
  db: Db = prisma
) {
  if (!holdIds.length) return;
  await db.bookingHold.updateMany({
    where: { id: { in: holdIds } },
    data: { bookingId },
  });
}

export { SESSION_SOLD_OUT };
