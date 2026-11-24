import prisma from "@/lib/prisma";
import { PosError } from "@/lib/pos/errors";
import { requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { resolvePosSettings } from "@/lib/pos/settings";
import { verifyManagerPin } from "@/lib/pos/pins";
import { assignCustomTicketIds, redeemTicketCredential } from "@/lib/ticketing/credentials";
import { posRedeemMembership } from "@/lib/memberships/posAdapter";
import { evaluateGuestWaivers } from "@/lib/waivers/evaluateWaiver";
import { num } from "@/lib/pos/money";

export async function redeemAtPos(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  if (body.guestMembershipId || body.membershipQuery) {
    const result = await posRedeemMembership({
      orgId,
      locationId,
      guestMembershipId: String(body.guestMembershipId || ""),
      actorUserId: actor.sub ?? "",
      qty: Number(body.qty ?? 1),
    });
    return { kind: "membership" as const, result };
  }
  const code = String(body.code || body.customTicketId || "").trim();
  if (!code) throw new PosError("CODE", "A ticket code is required");
  const credential = await prisma.ticketCredential.findFirst({
    where: {
      orgId,
      locationId,
      OR: [{ code }, { customTicketId: code }],
    },
    include: {
      booking: { include: { lines: { include: { session: true } } } },
    },
  });
  if (!credential) {
    const booking = await prisma.booking.findFirst({
      where: { orgId, locationId, OR: [{ publicId: code }, { id: code }] },
    });
    if (
      booking &&
      (booking.status === "pending_payment" ||
        booking.status === "hold" ||
        num(booking.amountDue) > 0)
    ) {
      throw new PosError("UNPAID", "Unpaid tickets cannot be redeemed", 403);
    }
    throw new PosError("NOT_FOUND", "Ticket was not found", 404);
  }
  if (credential.status === "redeemed") {
    throw new PosError("ALREADY_REDEEMED", "This ticket was already redeemed", 400);
  }
  const settings = await resolvePosSettings(orgId, locationId);
  const booking = credential.booking;
  const unpaid =
    settings.paidRequiredForRedeem &&
    (booking.status === "pending_payment" ||
      booking.status === "hold" ||
      booking.status === "draft" ||
      num(booking.amountDue) > 0);
  if (unpaid) throw new PosError("UNPAID", "Unpaid tickets cannot be redeemed", 403);
  const sessionEnd = booking.lines
    .map((l) => l.session?.endsAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (sessionEnd && !settings.allowPastDateRedemption) {
    const grace = settings.lateRedemptionGraceMinutes * 60_000;
    if (Date.now() > sessionEnd.getTime() + grace) {
      if (body.managerOverride !== true) {
        throw new PosError("PAST_DATE", "This ticket is past the redemption window", 403);
      }
      await verifyManagerPin(actor, String(body.managerPin || ""), locationId);
    }
  }
  const updated = await redeemTicketCredential({ orgId, credentialId: credential.id });
  if (!updated) throw new PosError("ALREADY_REDEEMED", "This ticket was already redeemed", 400);
  return { kind: "ticket" as const, credential: updated };
}

export async function searchPosWaivers(actor: PosActor, q: string, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const query = q.trim();
  if (!query) return [];

  const guestMap = new Map<
    string,
    { id: string; firstName: string; lastName: string; email: string | null }
  >();

  const byProfile = await prisma.guestProfile.findMany({
    where: {
      orgId,
      OR: [
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 10,
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  for (const g of byProfile) guestMap.set(g.id, g);

  // Also resolve by booking public id / id so the check-in desk matches the UI hint.
  const booking = await prisma.booking.findFirst({
    where: {
      orgId,
      locationId,
      OR: [{ publicId: query }, { id: query }],
    },
    select: {
      primaryContactEmail: true,
      waiverRecords: {
        where: { voidedAt: null },
        take: 24,
        select: { guestProfileId: true },
      },
    },
  });
  if (booking) {
    const ids = Array.from(
      new Set(booking.waiverRecords.map((w) => w.guestProfileId).filter(Boolean))
    );
    if (booking.primaryContactEmail) {
      const byEmail = await prisma.guestProfile.findMany({
        where: {
          orgId,
          email: { equals: booking.primaryContactEmail, mode: "insensitive" },
        },
        take: 5,
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      for (const g of byEmail) guestMap.set(g.id, g);
    }
    if (ids.length) {
      const fromBooking = await prisma.guestProfile.findMany({
        where: { orgId, id: { in: ids } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      for (const g of fromBooking) guestMap.set(g.id, g);
    }
  }

  const guests = Array.from(guestMap.values()).slice(0, 12);
  const out: Array<{
    id: string;
    guestId: string;
    guestName: string;
    status: string;
    templateName?: string;
    expiresAt?: string | null;
  }> = [];
  for (const guest of guests) {
    const guestName = `${guest.firstName} ${guest.lastName}`.trim();
    try {
      const evalResult = await evaluateGuestWaivers({
        orgId,
        locationId,
        guestProfileId: guest.id,
      });
      const records = evalResult.records ?? [];
      if (records.length) {
        for (const rec of records) {
          out.push({
            id: rec.id ?? guest.id,
            guestId: guest.id,
            guestName,
            status: rec.validity ?? rec.status ?? evalResult.status,
            templateName: rec.publicRef ? `Waiver ${rec.publicRef}` : "Waiver",
            expiresAt: rec.expiresAt ?? evalResult.expiresAt,
          });
        }
      } else {
        out.push({
          id: guest.id,
          guestId: guest.id,
          guestName,
          status: evalResult.status,
          templateName: evalResult.missingRequirements?.[0]?.reason ?? "Waiver",
          expiresAt: evalResult.expiresAt,
        });
      }
    } catch {
      out.push({
        id: guest.id,
        guestId: guest.id,
        guestName,
        status: "unknown",
        templateName: "Waiver",
        expiresAt: null,
      });
    }
  }
  return out;
}

export async function assignPosCustomIds(
  actor: PosActor,
  body: Record<string, unknown>
) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  let assignments = Array.isArray(body.assignments)
    ? (body.assignments as Array<{ credentialId: string; customTicketId: string }>)
    : [];
  if (
    !assignments.length &&
    body.credentialId &&
    (body.customTicketId || body.customId)
  ) {
    assignments = [
      {
        credentialId: String(body.credentialId),
        customTicketId: String(body.customTicketId || body.customId),
      },
    ];
  }
  return assignCustomTicketIds(orgId, assignments, {
    bookingId: body.bookingId ? String(body.bookingId) : undefined,
  });
}
