/**
 * Activity stream helpers for bookings.
 */
import type { BookingActivityKind, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export async function logBookingActivity(
  opts: {
    orgId: string;
    locationId?: string | null;
    bookingId: string;
    kind: BookingActivityKind;
    payload?: Record<string, unknown> | null;
    actorUserId?: string | null;
  },
  db: Db = prisma
) {
  return db.bookingActivity.create({
    data: {
      orgId: opts.orgId,
      locationId: opts.locationId ?? null,
      bookingId: opts.bookingId,
      kind: opts.kind,
      payload: (opts.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      actorUserId: opts.actorUserId ?? null,
    },
  });
}
