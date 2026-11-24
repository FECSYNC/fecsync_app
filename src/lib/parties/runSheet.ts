/**
 * Party run sheets (per party timeline + daily sheets per venue day).
 */
import prisma from "@/lib/prisma";
import { TicketingError, INVALID_STATUS_TRANSITION } from "@/lib/parties/errors";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { isPartyLive, loadStaffParty } from "@/lib/parties/load";
import { listPartiesCore } from "@/lib/parties/partyEngine";
import { logPartyActivity } from "@/lib/parties/activity";

export type RunSheetItemInput = {
  title?: string;
  notes?: string | null;
  startsAt?: string | null;
  sortOrder?: number;
};

function itemDto(i: { id: string; title: string; notes: string | null; startsAt: Date | null; sortOrder: number }) {
  return {
    id: i.id,
    title: i.title,
    notes: i.notes,
    startsAt: i.startsAt?.toISOString() ?? null,
    sortOrder: i.sortOrder,
  };
}

export async function getPartyRunSheet(actor: PartyActor, bookingId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  return {
    bookingId: party.id,
    publicId: party.publicId,
    partyName: party.partyDetail.partyName,
    visitStartsAt: party.visitStartsAt?.toISOString() ?? null,
    timezone: party.location?.timezone ?? null,
    room: party.partyDetail.roomResourceId
      ? {
          id: party.partyDetail.roomResourceId,
          name: party.partyDetail.roomResource?.name ?? party.partyDetail.roomNameSnapshot ?? "",
        }
      : null,
    items: party.partyDetail.runSheetItems.map(itemDto),
  };
}

/** PUT (and the legacy PATCH): replace the timeline. */
export async function putPartyRunSheet(actor: PartyActor, bookingId: string, items: unknown) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (!isPartyLive(party.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  const list = (Array.isArray(items) ? items : []) as RunSheetItemInput[];
  const rows = list.map((item, i) => {
    const title = (typeof item.title === "string" ? item.title : "").trim();
    if (!title) throw new Error("Run-sheet item title is required");
    const startsAt = item.startsAt ? new Date(item.startsAt) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) throw new Error("Run-sheet time is invalid");
    return {
      orgId: party.orgId,
      locationId: party.locationId,
      partyDetailId: party.partyDetail.id,
      title: title.slice(0, 200),
      notes: typeof item.notes === "string" && item.notes.trim() ? item.notes.trim().slice(0, 2000) : null,
      startsAt,
      sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : i,
    };
  });
  await prisma.$transaction(async (tx) => {
    await tx.partyRunSheetItem.deleteMany({ where: { partyDetailId: party.partyDetail.id } });
    if (rows.length) await tx.partyRunSheetItem.createMany({ data: rows });
  });
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event: "party_run_sheet",
    payload: { count: rows.length },
    actorUserId: actor.sub ?? null,
  });
  return getPartyRunSheet(actor, bookingId);
}

/** Daily run sheets for a venue day (venue timezone). Park-locked with no venue → empty. */
export async function listDailyPartyRunSheets(
  actor: PartyActor,
  opts: { date: string; locationId?: string | null }
) {
  const ctx = await partyStaffContext(actor);
  if (ctx.scope.parkLocked && !ctx.scope.locationId && !ctx.scope.locationIds?.length) return [];
  const list = await listPartiesCore(ctx, {
    date: opts.date,
    locationId: opts.locationId,
    opsStatus: "held,confirmed,checked_in,in_progress,completed",
    take: 200,
  });
  if (!list.parties.length) return [];
  const details = await prisma.partyBookingDetail.findMany({
    where: { bookingId: { in: list.parties.map((p) => p.bookingId) } },
    select: {
      bookingId: true,
      hostNotes: true,
      foodNotes: true,
      runSheetItems: { orderBy: { sortOrder: "asc" } },
      foodOrders: {
        where: { status: { not: "cancelled" } },
        select: { status: true, lines: { select: { nameSnapshot: true, qty: true } } },
      },
      booking: {
        select: {
          notes: true,
          lines: { where: { productType: "add_on" }, select: { productName: true, qty: true } },
        },
      },
    },
  });
  const byBooking = new Map(details.map((d) => [d.bookingId, d]));
  return list.parties.map((p) => {
    const extra = byBooking.get(p.bookingId);
    return {
      bookingId: p.bookingId,
      publicId: p.publicId,
      partyName: p.partyName,
      honoreeName: p.honoreeName,
      status: p.status,
      opsStatus: p.opsStatus,
      visitStartsAt: p.visitStartsAt,
      visitEndsAt: p.visitEndsAt,
      timezone: p.timezone,
      location: p.location,
      room: p.room,
      kidCount: p.kidCount,
      adultCount: p.adultCount,
      hostName: p.host?.name ?? p.contactName ?? null,
      amountDue: p.amountDueCents / 100,
      amountDueCents: p.amountDueCents,
      food: (extra?.foodOrders ?? []).flatMap((o) => o.lines),
      addOns: (extra?.booking.lines ?? []).map((l) => ({ name: l.productName, qty: l.qty })),
      notes: extra?.booking.notes ?? null,
      hostNotes: extra?.hostNotes ?? null,
      foodNotes: extra?.foodNotes ?? null,
      items: (extra?.runSheetItems ?? []).map(itemDto),
    };
  });
}
