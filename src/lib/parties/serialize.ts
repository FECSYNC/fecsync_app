/**
 * Party DTOs. Money is integer cents. Never expose card data, Stripe ids,
 * invitation tokens, or viewTokens. The owner (host) DTO never includes POS
 * notes, staff notes, overbook flags, or invoice management data.
 */
import type { LoadedParty } from "@/lib/parties/load";
import { toCents } from "@/lib/parties/deposits";
import { toFoodOrderDto } from "@/lib/parties/food";
import { toStaffInvitationDto } from "@/lib/parties/invitations";

function personName(u: { firstName: string | null; lastName: string | null; email: string } | null) {
  if (!u) return null;
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email;
}

function packageLine(party: LoadedParty) {
  return party.lines.find(
    (l) => l.productType === "party_package" && l.sessionId != null
  ) ?? party.lines.find((l) => l.productType === "party_package") ?? null;
}

function moneyBlock(party: LoadedParty) {
  const d = party.partyDetail;
  return {
    subtotalCents: toCents(party.subtotal),
    taxCents: toCents(party.taxAmount),
    totalCents: toCents(party.total),
    amountPaidCents: toCents(party.amountPaid),
    amountDueCents: toCents(party.amountDue),
    depositRequiredCents: d.depositRequiredCents,
    depositPaidCents: d.depositPaidCents,
    depositOutstandingCents: Math.max(0, d.depositRequiredCents - d.depositPaidCents),
    depositDueAt: d.depositDueAt?.toISOString() ?? null,
    balanceDueAt: d.balanceDueAt?.toISOString() ?? null,
  };
}

function core(party: LoadedParty) {
  const d = party.partyDetail;
  const pkgLine = packageLine(party);
  return {
    bookingId: party.id,
    publicId: party.publicId,
    status: party.status,
    opsStatus: d.opsStatus,
    channel: party.channel,
    locationId: party.locationId,
    location: party.location ? { id: party.location.id, name: party.location.name } : null,
    timezone: party.location?.timezone ?? null,
    visitStartsAt: party.visitStartsAt?.toISOString() ?? null,
    visitEndsAt: party.visitEndsAt?.toISOString() ?? null,
    sessionId: pkgLine?.sessionId ?? null,
    partyName: d.partyName,
    honoreeName: d.honoreeName,
    honoreeAge: d.honoreeAge,
    honoreeBirthDate: d.honoreeBirthDate?.toISOString() ?? null,
    kidCount: d.kidCount,
    adultCount: d.adultCount,
    package: d.packageProduct ? { id: d.packageProduct.id, name: d.packageProduct.name } : null,
    room: d.roomResourceId
      ? { id: d.roomResourceId, name: d.roomResource?.name ?? d.roomNameSnapshot ?? null }
      : null,
    roomNameSnapshot: d.roomNameSnapshot,
    addOns: party.lines
      .filter((l) => l.productType === "add_on" && l.productId)
      .map((l) => ({
        productId: l.productId!,
        name: l.productName,
        qty: l.qty,
        lineTotalCents: toCents(l.lineTotal),
      })),
    waiverMissingCount: d.waiverMissingCount,
    ...moneyBlock(party),
  };
}

export function toStaffPartyDto(
  party: LoadedParty,
  extras?: { activities?: Array<{ id: string; kind: string; payload: unknown; actorUserId: string | null; createdAt: Date }> }
) {
  const d = party.partyDetail;
  return {
    ...core(party),
    primaryContactName: party.primaryContactName,
    primaryContactEmail: party.primaryContactEmail,
    primaryContactPhone: party.primaryContactPhone,
    userId: party.userId,
    accountId: party.accountId,
    notes: party.notes,
    posNotes: party.posNotes,
    hostStaffUserId: d.hostStaffUserId,
    host: d.hostStaff ? { id: d.hostStaff.id, name: personName(d.hostStaff), email: d.hostStaff.email } : null,
    hostNotes: d.hostNotes,
    foodNotes: d.foodNotes,
    holdExpiresAt: party.holdExpiresAt?.toISOString() ?? null,
    reservedUntil: party.reservedUntil?.toISOString() ?? null,
    lines: party.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      productType: l.productType,
      priceBandCode: l.priceBandCode,
      qty: l.qty,
      unitPriceCents: toCents(l.unitPrice),
      lineTotalCents: toCents(l.lineTotal),
      sessionId: l.sessionId,
      resourceId: l.resourceId,
    })),
    guests: d.guests.map((g) => ({
      id: g.id,
      kind: g.kind,
      name: g.name,
      age: g.age,
      email: g.email,
      phone: g.phone,
      rsvpStatus: g.rsvpStatus,
      waiverStatus: g.waiverStatus,
      invitationId: g.invitationId,
      bookingGuestId: g.bookingGuestId,
    })),
    invitations: d.invitations.map(toStaffInvitationDto),
    foodOrders: d.foodOrders.map(toFoodOrderDto),
    runSheet: d.runSheetItems.map((i) => ({
      id: i.id,
      title: i.title,
      notes: i.notes,
      startsAt: i.startsAt?.toISOString() ?? null,
      sortOrder: i.sortOrder,
    })),
    payments: party.payments.map((p) => ({
      id: p.id,
      tender: p.tender,
      amountCents: toCents(p.amount),
      amountRefundedCents: toCents(p.amountRefunded),
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
    activities: (extras?.activities ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      payload: a.payload,
      actorUserId: a.actorUserId,
      createdAt: a.createdAt.toISOString(),
    })),
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
  };
}

/** Signed-in host / magic-link holder. Hosts see their own guest list incl. contacts. */
export function toOwnerPartyDto(party: LoadedParty, opts: { isHost: boolean }) {
  const d = party.partyDetail;
  return {
    ...core(party),
    primaryContactName: party.primaryContactName,
    guests: d.guests.map((g) => ({
      id: g.id,
      kind: g.kind,
      name: g.name,
      age: g.age,
      ...(opts.isHost ? { email: g.email, phone: g.phone } : {}),
      rsvpStatus: g.rsvpStatus,
      waiverStatus: g.waiverStatus,
    })),
    invitations: opts.isHost
      ? d.invitations.map((i) => ({
          id: i.id,
          guestId: i.guestId,
          channel: i.channel,
          status: i.status,
          expiresAt: i.expiresAt?.toISOString() ?? null,
          respondedAt: i.respondedAt?.toISOString() ?? null,
        }))
      : [],
    foodOrders: d.foodOrders
      .filter((o) => o.status !== "cancelled")
      .map((o) => ({
        id: o.id,
        status: o.status,
        lines: o.lines.map((l) => ({
          menuItemId: l.menuItemId,
          nameSnapshot: l.nameSnapshot,
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
        })),
      })),
  };
}

/** Public confirmation (view/magic token holder): no guest contacts, no staff data. */
export function toPublicPartyDto(party: LoadedParty) {
  const c = core(party);
  return {
    publicId: c.publicId,
    status: c.status,
    opsStatus: c.opsStatus,
    location: c.location,
    timezone: c.timezone,
    visitStartsAt: c.visitStartsAt,
    visitEndsAt: c.visitEndsAt,
    partyName: c.partyName,
    honoreeName: c.honoreeName,
    kidCount: c.kidCount,
    adultCount: c.adultCount,
    package: c.package,
    room: c.room ? { name: c.room.name } : null,
    guestCount: party.partyDetail.guests.length,
    totalCents: c.totalCents,
    amountPaidCents: c.amountPaidCents,
    amountDueCents: c.amountDueCents,
    depositRequiredCents: c.depositRequiredCents,
    depositPaidCents: c.depositPaidCents,
    depositDueAt: c.depositDueAt,
    balanceDueAt: c.balanceDueAt,
  };
}
