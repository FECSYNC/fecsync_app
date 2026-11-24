/**
 * Party activity: BookingActivity (per-booking stream) + ActivityLog
 * (company audit, entity PartyBooking / PartyInvitation / PartyFoodOrder).
 */
import type { ActivityEntityType, BookingActivityKind, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { logActivityEntry } from "@/lib/audit/activityLog";
import { logBookingActivity } from "@/lib/ticketing/activity";

type Db = Prisma.TransactionClient | typeof prisma;

export type PartyActivityEntity = "PartyBooking" | "PartyInvitation" | "PartyFoodOrder";

export async function logPartyActivity(
  opts: {
    orgId: string;
    locationId: string;
    bookingId: string;
    kind: BookingActivityKind;
    event: string;
    payload?: Record<string, unknown>;
    actorUserId?: string | null;
    entity?: PartyActivityEntity;
    entityId?: string | null;
    description?: string;
  },
  db: Db = prisma
) {
  const actorUserId =
    opts.actorUserId && isValidId(opts.actorUserId) ? opts.actorUserId : null;
  await logBookingActivity(
    {
      orgId: opts.orgId,
      locationId: opts.locationId,
      bookingId: opts.bookingId,
      kind: opts.kind,
      payload: { event: opts.event, ...(opts.payload ?? {}) },
      actorUserId,
    },
    db
  );
  logActivityEntry({
    actorSub: actorUserId,
    orgId: opts.orgId,
    action: `parties.${opts.event}`,
    entityType: (opts.entity ?? "PartyBooking") as ActivityEntityType,
    entityId: opts.entityId ?? opts.bookingId,
    description: (opts.description ?? `Party ${opts.event.replace(/_/g, " ")}`).slice(0, 500),
    metadata: {
      bookingId: opts.bookingId,
      locationId: opts.locationId,
      ...(opts.payload ?? {}),
    },
  });
}

/** Catalog / settings audit (no booking stream). */
export function logPartyAudit(
  actor: { sub?: string | null },
  orgId: string,
  entry: {
    action: string;
    entityType: ActivityEntityType;
    entityId?: string | null;
    description: string;
    metadata?: Record<string, unknown>;
  }
) {
  logActivityEntry({
    actorSub: actor.sub ?? null,
    orgId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    description: entry.description,
    metadata: entry.metadata,
  });
}
