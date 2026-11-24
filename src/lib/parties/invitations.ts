/**
 * Party invitations + RSVP. Tokens are crypto-random base64url (24 bytes).
 * A token can only touch its own invitation and guest — never prices, other
 * guests, or the booking.
 */
import type { PartyInvitationChannel, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import { deliverPartyInvitation, notifyPartyHost } from "@/lib/parties/notifications";
import {
  TicketingError,
  INVALID_STATUS_TRANSITION,
  PARTY_INVITE_EXPIRED,
  PARTY_INVITE_INVALID,
  partyNotFound,
} from "@/lib/parties/errors";
import { assertPartiesEnabled } from "@/lib/parties/assertPartiesEnabled";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import {
  isPartyLive,
  loadPartyById,
  loadStaffParty,
  type LoadedParty,
} from "@/lib/parties/load";
import { resolvePartySettings } from "@/lib/parties/settings";
import { insertPartyGuest, afterGuestChange } from "@/lib/parties/guests";
import { logPartyActivity } from "@/lib/parties/activity";

export function generateInvitationToken(): string {
  return newPublicToken();
}

/** Canonical invitation landing. */
export function partyInvitePath(token: string): string {
  return `/party/invite/${encodeURIComponent(token)}`;
}

export function toStaffInvitationDto(
  inv: Prisma.PartyInvitationGetPayload<Record<string, never>>
) {
  return {
    id: inv.id,
    guestId: inv.guestId,
    channel: inv.channel,
    toEmail: inv.toEmail,
    toPhone: inv.toPhone,
    sentTo: inv.sentTo,
    status: inv.status,
    sentAt: inv.sentAt?.toISOString() ?? null,
    respondedAt: inv.respondedAt?.toISOString() ?? null,
    expiresAt: inv.expiresAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}

export type CreateInvitationInput = {
  guestId?: string | null;
  toEmail?: string | null;
  toPhone?: string | null;
  channel?: PartyInvitationChannel;
  send?: boolean;
};

export function parseInvitationInput(raw: unknown): CreateInvitationInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const legacyTo = typeof b.to === "string" ? b.to.trim() : "";
  const channelRaw = String(b.channel ?? (legacyTo ? "email" : "link"));
  if (!["email", "sms", "link"].includes(channelRaw)) throw new Error("Invitation channel must be email, sms, or link");
  const channel = channelRaw as PartyInvitationChannel;
  const toEmail =
    typeof b.toEmail === "string" && b.toEmail.trim()
      ? b.toEmail.trim().toLowerCase()
      : channel === "email" && legacyTo
        ? legacyTo.toLowerCase()
        : null;
  const toPhone =
    typeof b.toPhone === "string" && b.toPhone.trim()
      ? b.toPhone.trim()
      : channel === "sms" && legacyTo
        ? legacyTo
        : null;
  if (toEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) throw new Error("Invitation email is invalid");
  if (channel === "email" && !toEmail) throw new Error("Email invitations need an email address");
  if (channel === "sms" && !toPhone) throw new Error("SMS invitations need a phone number");
  return {
    guestId: typeof b.guestId === "string" && isValidId(b.guestId) ? b.guestId : null,
    toEmail,
    toPhone,
    channel,
    // Legacy `{ to }` callers always delivered immediately.
    send: b.send === undefined ? Boolean(legacyTo) : Boolean(b.send),
  };
}

/** Core create shared by staff and host APIs. */
export async function createInvitationForParty(
  party: LoadedParty,
  input: CreateInvitationInput,
  actorUserId: string | null
) {
  if (!isPartyLive(party.status)) throw new TicketingError(PARTY_INVITE_EXPIRED, 410);
  if (input.guestId) {
    const guest = party.partyDetail.guests.find((g) => g.id === input.guestId);
    if (!guest) throw partyNotFound();
  }
  const settings = await resolvePartySettings(party.orgId, party.locationId);
  const expiresAt = new Date(Date.now() + settings.invitationExpiresHours * 3600_000);
  const invite = await prisma.partyInvitation.create({
    data: {
      orgId: party.orgId,
      locationId: party.locationId,
      partyDetailId: party.partyDetail.id,
      guestId: input.guestId ?? null,
      token: generateInvitationToken(),
      channel: input.channel ?? "link",
      toEmail: input.toEmail ?? null,
      toPhone: input.toPhone ?? null,
      sentTo: input.toEmail ?? input.toPhone ?? null,
      status: "pending",
      expiresAt,
    },
  });
  if (input.guestId) {
    await prisma.partyGuest.update({
      where: { id: input.guestId },
      data: { invitationId: invite.id },
    });
  }
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event: "invite_created",
    // Never persist raw RSVP tokens in activity (bookings:read could replay).
    payload: { inviteId: invite.id, channel: invite.channel, guestId: invite.guestId },
    actorUserId,
    entity: "PartyInvitation",
    entityId: invite.id,
  });
  const delivered = input.send ? await deliverInvitation(party, invite, actorUserId) : invite;
  return {
    ...toStaffInvitationDto(delivered),
    token: invite.token,
    rsvpPath: partyInvitePath(invite.token),
    rsvpUrl: `${publicAppBaseUrl()}${partyInvitePath(invite.token)}`,
  };
}

/** Send by email / SMS. A missing provider or a mail failure never fails the invitation. */
async function deliverInvitation(
  party: LoadedParty,
  invite: Prisma.PartyInvitationGetPayload<Record<string, never>>,
  actorUserId: string | null
) {
  const { sent, skipped } = await deliverPartyInvitation({
    bookingId: party.id,
    channel: invite.channel,
    toEmail: invite.toEmail,
    toPhone: invite.toPhone,
    invitePath: partyInvitePath(invite.token),
  });
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: invite.channel === "sms" ? "sms" : "email",
    event: "invite_send",
    payload: { inviteId: invite.id, channel: invite.channel, sent, skipped },
    actorUserId,
    entity: "PartyInvitation",
    entityId: invite.id,
  });
  if (!sent) return invite;
  return prisma.partyInvitation.update({
    where: { id: invite.id },
    data: { status: "sent", sentAt: new Date() },
  });
}

export async function createPartyInvitationForStaff(actor: PartyActor, bookingId: string, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  return createInvitationForParty(party, parseInvitationInput(raw), actor.sub ?? null);
}

export async function listPartyInvitations(actor: PartyActor, bookingId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  return party.partyDetail.invitations.map(toStaffInvitationDto);
}

export async function cancelPartyInvitation(actor: PartyActor, bookingId: string, inviteId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (!isValidId(inviteId)) throw partyNotFound();
  const invite = party.partyDetail.invitations.find((i) => i.id === inviteId);
  if (!invite) throw partyNotFound();
  if (!["pending", "sent", "bounced"].includes(invite.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  const updated = await prisma.partyInvitation.update({
    where: { id: invite.id },
    data: { status: "cancelled" },
  });
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event: "invite_cancelled",
    payload: { inviteId: invite.id },
    actorUserId: actor.sub ?? null,
    entity: "PartyInvitation",
    entityId: invite.id,
  });
  return toStaffInvitationDto(updated);
}

/** No mail-provider bounce webhook is wired — staff mark bounced manually. */
export async function markPartyInvitationBounced(actor: PartyActor, bookingId: string, inviteId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (!isValidId(inviteId)) throw partyNotFound();
  const invite = party.partyDetail.invitations.find((i) => i.id === inviteId);
  if (!invite) throw partyNotFound();
  if (!["pending", "sent"].includes(invite.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  const updated = await prisma.partyInvitation.update({
    where: { id: invite.id },
    data: { status: "bounced" },
  });
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "email",
    event: "invite_bounced",
    payload: { inviteId: invite.id },
    actorUserId: actor.sub ?? null,
    entity: "PartyInvitation",
    entityId: invite.id,
  });
  return toStaffInvitationDto(updated);
}

async function loadInviteByToken(token: string) {
  const secret = typeof token === "string" ? token.trim() : "";
  if (secret.length < 16 || secret.length > 200) throw new TicketingError(PARTY_INVITE_INVALID, 404);
  const invite = await prisma.partyInvitation.findUnique({
    where: { token: secret },
    include: {
      partyDetail: {
        include: {
          booking: {
            select: {
              id: true,
              publicId: true,
              orgId: true,
              status: true,
              visitStartsAt: true,
              visitEndsAt: true,
              location: { select: { name: true, timezone: true } },
            },
          },
        },
      },
    },
  });
  if (!invite) throw new TicketingError(PARTY_INVITE_INVALID, 404);
  try {
    await assertPartiesEnabled(invite.orgId);
  } catch {
    throw new TicketingError(PARTY_INVITE_INVALID, 404);
  }
  return invite;
}

function inviteClosedReason(invite: Awaited<ReturnType<typeof loadInviteByToken>>): string | null {
  if (!isPartyLive(invite.partyDetail.booking.status)) return "party_cancelled";
  if (invite.status === "cancelled") return "invite_cancelled";
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return "invite_expired";
  return null;
}

/** Public invite view: party name, honoree, date/time (venue TZ), venue name, RSVP status. Nothing else. */
export async function getPublicInvitation(token: string) {
  const invite = await loadInviteByToken(token);
  const closed = inviteClosedReason(invite);
  const b = invite.partyDetail.booking;
  return {
    partyName: invite.partyDetail.partyName,
    honoreeName: invite.partyDetail.honoreeName,
    visitStartsAt: b.visitStartsAt?.toISOString() ?? null,
    visitEndsAt: b.visitEndsAt?.toISOString() ?? null,
    timezone: b.location?.timezone ?? null,
    venueName: b.location?.name ?? null,
    rsvpStatus: invite.status,
    respondedAt: invite.respondedAt?.toISOString() ?? null,
    open: !closed,
    closedReason: closed,
  };
}

/**
 * RSVP. Accept creates (or updates the invite's own) PartyGuest within caps;
 * decline marks the invite + linked guest declined. Idempotent: a repeat RSVP
 * returns the saved answer and never adds a second guest.
 */
export async function applyPartyRsvp(
  token: string,
  body: { accept?: boolean; name?: string | null; age?: number | null; bookingPublicId?: string }
) {
  const invite = await loadInviteByToken(token);
  if (body.bookingPublicId && body.bookingPublicId !== invite.partyDetail.booking.publicId) {
    throw new TicketingError(PARTY_INVITE_INVALID, 404);
  }
  if (invite.status === "accepted" || invite.status === "declined") {
    return { ok: true, idempotent: true, rsvpStatus: invite.status, bookingPublicId: invite.partyDetail.booking.publicId };
  }
  if (inviteClosedReason(invite)) throw new TicketingError(PARTY_INVITE_EXPIRED, 410);
  const accepting = body.accept !== false;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
  const age =
    body.age == null || (body.age as unknown) === ""
      ? null
      : Number.isInteger(Number(body.age)) && Number(body.age) >= 0 && Number(body.age) <= 120
        ? Number(body.age)
        : null;
  const party = await loadPartyById(invite.orgId, invite.partyDetail.bookingId);

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${party.id} FOR UPDATE`;
    const live = await tx.booking.findFirst({ where: { id: party.id }, select: { status: true } });
    if (!live || !isPartyLive(live.status)) throw new TicketingError(PARTY_INVITE_EXPIRED, 410);
    const claimed = await tx.partyInvitation.updateMany({
      where: { id: invite.id, status: { in: ["pending", "sent", "bounced"] } },
      data: { status: accepting ? "accepted" : "declined", respondedAt: new Date() },
    });
    if (claimed.count !== 1) return { idempotent: true, guestId: invite.guestId };
    if (!accepting) {
      if (invite.guestId) {
        await tx.partyGuest.update({ where: { id: invite.guestId }, data: { rsvpStatus: "declined" } });
      }
      return { idempotent: false, guestId: invite.guestId };
    }
    if (invite.guestId) {
      await tx.partyGuest.update({
        where: { id: invite.guestId },
        data: {
          rsvpStatus: "accepted",
          ...(name ? { name } : {}),
          ...(age != null ? { age } : {}),
        },
      });
      return { idempotent: false, guestId: invite.guestId };
    }
    // Legacy RSVP links could accept without a name; no guest row in that case.
    if (!name) return { idempotent: false, guestId: null };
    const guest = await insertPartyGuest(tx, party, {
      kind: "kid",
      name,
      age,
      email: null,
      invitationId: invite.id,
      rsvpStatus: "accepted",
    });
    await tx.partyInvitation.update({ where: { id: invite.id }, data: { guestId: guest.id } });
    return { idempotent: false, guestId: guest.id };
  });

  if (!outcome.idempotent) {
    await logPartyActivity({
      orgId: party.orgId,
      locationId: party.locationId,
      bookingId: party.id,
      kind: "edited",
      event: accepting ? "rsvp_accepted" : "rsvp_declined",
      payload: { inviteId: invite.id, guestId: outcome.guestId ?? null },
      entity: "PartyInvitation",
      entityId: invite.id,
    });
    if (accepting && outcome.guestId) {
      await afterGuestChange(party, null, "rsvp_guest", { guestId: outcome.guestId });
    }
    await notifyPartyHost(
      party.id,
      "RSVP received",
      `${name || "A guest"} ${accepting ? "accepted" : "declined"} the invitation to ${party.partyDetail.partyName}.`,
      accepting ? "rsvp_accepted" : "rsvp_declined"
    );
  }
  const fresh = await prisma.partyInvitation.findUniqueOrThrow({ where: { id: invite.id } });
  return {
    ok: true,
    idempotent: outcome.idempotent,
    rsvpStatus: fresh.status,
    bookingPublicId: party.publicId,
  };
}

/** Legacy /api/public/booking/party/[bookingPublicId]/rsvp (still needs the token). */
export async function legacyPublicPartyRsvp(opts: {
  bookingPublicId: string;
  token?: string;
  name?: string;
  accept?: boolean;
}) {
  if (!opts.token?.trim()) throw new TicketingError(PARTY_INVITE_INVALID, 404);
  return applyPartyRsvp(opts.token, {
    accept: opts.accept,
    name: opts.name ?? null,
    bookingPublicId: opts.bookingPublicId,
  });
}
