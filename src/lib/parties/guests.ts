/**
 * Named party guests (PartyGuest; optional BookingGuest link). Never staff
 * Membership rows. Caps (S1-F10): kids + honoree ≤ kidCount, adults +
 * chaperones ≤ adultCount, one honoree, unique emails per party, and the
 * package max / room capacity on the whole named list.
 */
import type { PartyGuestKind, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import {
  TicketingError,
  INVALID_STATUS_TRANSITION,
  PARTY_GUEST_CAP,
  PARTY_GUEST_DUPLICATE_EMAIL,
  PARTY_HONOREE_EXISTS,
  partyNotFound,
} from "@/lib/parties/errors";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { isPartyLive, loadStaffParty, type LoadedParty } from "@/lib/parties/load";
import { logPartyActivity } from "@/lib/parties/activity";
import { recomputePartyWaiverStatusSafe } from "@/lib/parties/waivers";

type Db = Prisma.TransactionClient | typeof prisma;

const KINDS: PartyGuestKind[] = ["honoree", "kid", "adult", "chaperone", "other"];

export type PartyGuestInput = {
  kind?: PartyGuestKind;
  name?: string | null;
  age?: number | null;
  email?: string | null;
  phone?: string | null;
};

type GuestShape = { id?: string; kind: PartyGuestKind; email: string | null };

export function parseGuestInput(raw: unknown, defaultKind: PartyGuestKind | null = "kid"): PartyGuestInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: PartyGuestInput = {};
  if (b.kind !== undefined) {
    const kind = String(b.kind) as PartyGuestKind;
    if (!KINDS.includes(kind)) throw new Error("Guest kind must be honoree, kid, adult, chaperone, or other");
    out.kind = kind;
  } else if (defaultKind) {
    out.kind = defaultKind;
  }
  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 160) : "";
    out.name = name || null;
  }
  if (b.age !== undefined) {
    if (b.age === null || b.age === "") out.age = null;
    else {
      const n = Number(b.age);
      if (!Number.isInteger(n) || n < 0 || n > 120) throw new Error("Guest age must be 0–120");
      out.age = n;
    }
  }
  if (b.email !== undefined) {
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Guest email is invalid");
    out.email = email || null;
  }
  if (b.phone !== undefined) {
    const phone = typeof b.phone === "string" ? b.phone.trim().slice(0, 40) : "";
    out.phone = phone || null;
  }
  return out;
}

export function assertGuestCaps(
  party: Pick<LoadedParty, "partyDetail">,
  guests: GuestShape[]
) {
  const detail = party.partyDetail;
  const honorees = guests.filter((g) => g.kind === "honoree").length;
  if (honorees > 1) throw new TicketingError(PARTY_HONOREE_EXISTS, 409);
  const kids = guests.filter((g) => g.kind === "kid" || g.kind === "honoree").length;
  const adults = guests.filter((g) => g.kind === "adult" || g.kind === "chaperone").length;
  if (kids > detail.kidCount || adults > detail.adultCount) {
    throw new TicketingError(PARTY_GUEST_CAP, 409);
  }
  const max = detail.packageProduct?.maxGuests ?? null;
  const roomCap = detail.roomResource?.defaultCapacity ?? 0;
  if ((max != null && guests.length > max) || (roomCap > 0 && guests.length > roomCap)) {
    throw new TicketingError(PARTY_GUEST_CAP, 409);
  }
  const seen = new Set<string>();
  for (const g of guests) {
    if (!g.email) continue;
    const key = g.email.toLowerCase();
    if (seen.has(key)) throw new TicketingError(PARTY_GUEST_DUPLICATE_EMAIL, 409);
    seen.add(key);
  }
}

async function lockParty(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
  const live = await tx.booking.findFirst({ where: { id: bookingId }, select: { status: true } });
  if (!live || !isPartyLive(live.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
}

async function currentGuests(db: Db, partyDetailId: string) {
  return db.partyGuest.findMany({
    where: { partyDetailId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function syncLinkedBookingGuest(
  db: Db,
  guest: { bookingGuestId: string | null; name: string | null }
) {
  if (!guest.bookingGuestId) return;
  await db.bookingGuest.update({
    where: { id: guest.bookingGuestId },
    data: { name: guest.name },
  });
}

/** Core add (staff, host, RSVP). Runs inside the caller's transaction. */
export async function insertPartyGuest(
  tx: Prisma.TransactionClient,
  party: LoadedParty,
  input: PartyGuestInput & { invitationId?: string | null; rsvpStatus?: "pending" | "accepted" }
) {
  const existing = await currentGuests(tx, party.partyDetail.id);
  const kind = input.kind ?? "kid";
  assertGuestCaps(party, [
    ...existing.map((g) => ({ id: g.id, kind: g.kind, email: g.email })),
    { kind, email: input.email ?? null },
  ]);
  return tx.partyGuest.create({
    data: {
      orgId: party.orgId,
      locationId: party.locationId,
      partyDetailId: party.partyDetail.id,
      kind,
      name: input.name ?? null,
      age: input.age ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      invitationId: input.invitationId ?? null,
      rsvpStatus: input.rsvpStatus ?? "pending",
    },
  });
}

export async function listPartyGuests(actor: PartyActor, bookingId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  return party.partyDetail.guests;
}

export async function addPartyGuest(actor: PartyActor, bookingId: string, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const input = parseGuestInput(raw);
  const guest = await prisma.$transaction(async (tx) => {
    await lockParty(tx, party.id);
    return insertPartyGuest(tx, party, input);
  });
  await afterGuestChange(party, actor.sub ?? null, "guest_added", { guestId: guest.id, kind: guest.kind });
  return guest;
}

export async function updatePartyGuest(
  actor: PartyActor,
  bookingId: string,
  guestId: string,
  raw: unknown
) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (!isValidId(guestId)) throw partyNotFound();
  const input = parseGuestInput(raw, null);
  const guest = await prisma.$transaction(async (tx) => {
    await lockParty(tx, party.id);
    const existing = await currentGuests(tx, party.partyDetail.id);
    const target = existing.find((g) => g.id === guestId);
    if (!target) throw partyNotFound();
    const nextKind = input.kind ?? target.kind;
    const nextEmail = input.email !== undefined ? input.email : target.email;
    assertGuestCaps(
      party,
      existing.map((g) =>
        g.id === guestId ? { id: g.id, kind: nextKind, email: nextEmail } : { id: g.id, kind: g.kind, email: g.email }
      )
    );
    const updated = await tx.partyGuest.update({
      where: { id: guestId },
      data: {
        kind: nextKind,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.age !== undefined ? { age: input.age } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
    });
    await syncLinkedBookingGuest(tx, updated);
    return updated;
  });
  await afterGuestChange(party, actor.sub ?? null, "guest_updated", { guestId });
  return guest;
}

export async function removePartyGuest(actor: PartyActor, bookingId: string, guestId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (!isValidId(guestId)) throw partyNotFound();
  await prisma.$transaction(async (tx) => {
    await lockParty(tx, party.id);
    const removed = await tx.partyGuest.deleteMany({
      where: { id: guestId, partyDetailId: party.partyDetail.id },
    });
    if (removed.count !== 1) throw partyNotFound();
  });
  await afterGuestChange(party, actor.sub ?? null, "guest_removed", { guestId });
  return { ok: true };
}

/**
 * Replace the whole guest list. Strict mode (new APIs) defaults a missing kind
 * to `kid`; the legacy PATCH payload has no kind concept, so entries without a
 * kind keep their stored kind (matched by id) or become `other`.
 */
export async function replacePartyGuestList(
  party: LoadedParty,
  rawGuests: unknown[],
  opts: { legacy: boolean; actorUserId: string | null }
) {
  const parsed = rawGuests.map((raw) => {
    const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const input = parseGuestInput(raw, opts.legacy ? null : "kid");
    return { id: typeof b.id === "string" && isValidId(b.id) ? b.id : undefined, input };
  });
  await prisma.$transaction(async (tx) => {
    await lockParty(tx, party.id);
    const existing = await currentGuests(tx, party.partyDetail.id);
    const byId = new Map(existing.map((g) => [g.id, g]));
    const next = parsed.map(({ id, input }) => {
      const prior = id ? byId.get(id) : undefined;
      return {
        id: prior?.id,
        kind: input.kind ?? prior?.kind ?? ("other" as PartyGuestKind),
        name: input.name !== undefined ? input.name : prior?.name ?? null,
        age: input.age !== undefined ? input.age : prior?.age ?? null,
        email: input.email !== undefined ? input.email : prior?.email ?? null,
        phone: input.phone !== undefined ? input.phone : prior?.phone ?? null,
      };
    });
    assertGuestCaps(party, next.map((g) => ({ id: g.id, kind: g.kind, email: g.email })));
    const keep = new Set(next.map((g) => g.id).filter((id): id is string => Boolean(id)));
    await tx.partyGuest.deleteMany({
      where: { partyDetailId: party.partyDetail.id, id: { notIn: [...keep] } },
    });
    for (const g of next) {
      if (g.id) {
        const updated = await tx.partyGuest.update({
          where: { id: g.id },
          data: { kind: g.kind, name: g.name, age: g.age, email: g.email, phone: g.phone },
        });
        await syncLinkedBookingGuest(tx, updated);
      } else {
        await tx.partyGuest.create({
          data: {
            orgId: party.orgId,
            locationId: party.locationId,
            partyDetailId: party.partyDetail.id,
            kind: g.kind,
            name: g.name,
            age: g.age,
            email: g.email,
            phone: g.phone,
          },
        });
      }
    }
  });
  await afterGuestChange(party, opts.actorUserId, "guests_replaced", { count: parsed.length });
  return currentGuests(prisma, party.partyDetail.id);
}

/** Staff PATCH (legacy replace payload) on the new lib. */
export async function replacePartyGuestsForStaff(
  actor: PartyActor,
  bookingId: string,
  rawGuests: unknown[]
) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  return replacePartyGuestList(party, rawGuests, { legacy: true, actorUserId: actor.sub ?? null });
}

export async function afterGuestChange(
  party: Pick<LoadedParty, "id" | "orgId" | "locationId">,
  actorUserId: string | null,
  event: string,
  payload: Record<string, unknown>
) {
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event,
    payload,
    actorUserId,
  });
  await recomputePartyWaiverStatusSafe(party.id);
}
