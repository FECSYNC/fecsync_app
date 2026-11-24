/**
 * Venue Manager actions: void, resend, cancel outstanding links, party gap list.
 * Does not scan tickets and does not replace the party run sheet.
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import { P } from "@/lib/auth/permissions";
import { isValidId } from "@/lib/ids";
import prisma from "@/lib/prisma";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { waiverStampedLocationWhere, type WaiversActor } from "@/lib/waivers/common";
import { createWaiverRequest } from "@/lib/waivers/signToken";
import { storedRecordValidity, type WaiverValidityStatus } from "@/lib/waivers/evaluateWaiver";

const BULK_CAP = 50;

function partyLocationInScope(
  scope: string | { in: string[] } | undefined,
  locationId: string
): boolean {
  if (!scope) return true;
  if (typeof scope === "string") return scope === locationId;
  return scope.in.includes(locationId);
}

function partyRecordValidity(
  row: {
    status: string;
    signedAt: Date | null;
    expiresAt: Date | null;
    templateVersionId: string;
    template: {
      defaultExpiryRule: string | null;
      defaultExpiryDays: number | null;
      requireResignOnPublish: boolean;
      currentPublishedVersionId: string | null;
    };
    signers: { isMinor: boolean; role: string }[];
  },
  now: Date,
  timeZone: string,
  settings: { expiryRule: string | null; expiryDays: number | null } | null
): WaiverValidityStatus {
  return storedRecordValidity({
    recordStatus: row.status,
    signedAt: row.signedAt,
    expiresAt: row.expiresAt,
    templateVersionId: row.templateVersionId,
    templateRule: row.template.defaultExpiryRule,
    templateExpiryDays: row.template.defaultExpiryDays,
    settingsRule: settings?.expiryRule,
    settingsExpiryDays: settings?.expiryDays,
    requireResignOnPublish: row.template.requireResignOnPublish,
    currentPublishedVersionId: row.template.currentPublishedVersionId,
    timeZone,
    signers: row.signers,
    now,
  });
}

async function recordInScope(actor: WaiversActor, recordId: string) {
  const orgId = await assertWaiverPermission(actor, P.WaiversRead);
  if (!isValidId(recordId)) throw new ForbiddenError("Record not found");
  const scope = await waiverStampedLocationWhere(actor);
  const row = await prisma.waiverRecord.findFirst({
    where: { id: recordId, orgId, ...(scope.locationId ? { locationId: scope.locationId } : {}) },
    include: {
      guestProfile: { select: { id: true, email: true, phone: true } },
      guardian: { select: { email: true, phone: true } },
      template: { select: { id: true, name: true } },
    },
  });
  if (!row) throw new ForbiddenError("Record not found");
  return row;
}

export async function voidWaiverRecord(
  actor: WaiversActor,
  recordId: string,
  reason: string
) {
  await assertWaiverPermission(actor, P.WaiversVoid);
  const why = reason.trim();
  if (why.length < 3) throw new Error("A void reason is required");
  const row = await recordInScope(actor, recordId);
  if (row.status === "voided" || row.status === "revoked") {
    return { id: row.id, status: row.status, already: true };
  }
  const updated = await prisma.waiverRecord.update({
    where: { id: row.id },
    data: {
      status: "voided",
      voidedAt: new Date(),
      voidReason: why.slice(0, 500),
      voidedById: actor.sub && isValidId(actor.sub) ? actor.sub : null,
    },
  });
  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId: row.orgId,
    action: "waiver.void",
    entityType: "WaiverRecord",
    entityId: row.id,
    description: `Waiver voided (${row.publicRef})`,
    metadata: { reason: why.slice(0, 200) },
  });
  await notifyPartyWaiverChange({ partyGuestId: row.partyGuestId, bookingId: row.bookingId });
  return { id: updated.id, status: updated.status, already: false };
}

/** Party Management mirrors waiver coverage; failures never block the waiver action. */
export async function notifyPartyWaiverChange(ref: {
  partyGuestId?: string | null;
  bookingId?: string | null;
}) {
  try {
    const { recomputePartyWaiverStatus, partyBookingIdForWaiverRef } = await import(
      "@/lib/parties/waivers"
    );
    const bookingId = await partyBookingIdForWaiverRef(ref);
    if (bookingId) await recomputePartyWaiverStatus(bookingId);
  } catch (err) {
    console.error("[waivers] party waiver recompute failed", err);
  }
}

export async function cancelOutstandingRequests(
  actor: WaiversActor,
  recordId: string,
  exceptRequestId?: string
) {
  await assertWaiverPermission(actor, P.WaiversWrite);
  const row = await recordInScope(actor, recordId);
  const kept = exceptRequestId
    ? await prisma.waiverRequest.findFirst({
        where: { id: exceptRequestId, orgId: row.orgId },
        select: { createdAt: true },
      })
    : null;
  const result = await prisma.waiverRequest.updateMany({
    where: {
      orgId: row.orgId,
      locationId: row.locationId,
      templateId: row.templateId,
      guestProfileId: row.guestProfileId,
      partyGuestId: row.partyGuestId,
      status: { in: ["queued", "sent", "failed", "opened"] },
      ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}),
      ...(kept ? { createdAt: { lt: kept.createdAt } } : {}),
    },
    data: { status: "cancelled" },
  });
  return { cancelled: result.count };
}

export async function resendWaiverRequest(
  actor: WaiversActor,
  recordId: string,
  channel?: "email_link" | "sms_link",
  alreadySent?: Set<string>
) {
  await assertWaiverPermission(actor, P.WaiversWrite);
  const row = await recordInScope(actor, recordId);
  const key = `${row.locationId}|${row.templateId}|${row.guestProfileId}`;
  if (alreadySent?.has(key)) {
    throw new Error("A link for this guest and template is already in this resend");
  }
  const email = row.guestProfile.email || row.guardian?.email || null;
  const phone = row.guestProfile.phone || row.guardian?.phone || null;
  const useSms = channel === "sms_link" || (!email && Boolean(phone));
  if (useSms && !phone) throw new Error("This guest has no phone number");
  if (!useSms && !email) throw new Error("This guest has no email address");
  const created = await createWaiverRequest(actor, {
    templateId: row.templateId,
    locationId: row.locationId,
    guestProfileId: row.guestProfileId,
    toEmail: useSms ? null : email,
    toPhone: useSms ? phone : null,
    channel: useSms ? "sms_link" : "email_link",
    bookingId: row.bookingId,
    partyGuestId: row.partyGuestId,
    locale: row.locale,
  });
  if (created.status === "sent") {
    await cancelOutstandingRequests(actor, recordId, created.requestId);
  }
  alreadySent?.add(key);
  return created;
}

export async function bulkResendWaivers(actor: WaiversActor, recordIds: string[]) {
  await assertWaiverPermission(actor, P.WaiversWrite);
  const ids = [...new Set(recordIds.filter((id) => typeof id === "string"))].slice(0, BULK_CAP);
  if (!ids.length) throw new Error("Choose at least one waiver");
  if (recordIds.length > BULK_CAP) throw new Error(`Resend at most ${BULK_CAP} waivers at a time`);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const alreadySent = new Set<string>();
  for (const id of ids) {
    try {
      await resendWaiverRequest(actor, id, undefined, alreadySent);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({
        id,
        ok: false,
        error: err instanceof Error ? err.message : "Could not resend",
      });
    }
  }
  return { results };
}

export async function listPartyWaiverGaps(actor: WaiversActor, bookingId: string) {
  const orgId = await assertWaiverPermission(actor, P.WaiversRead);
  if (!isValidId(bookingId)) throw new ForbiddenError("Party not found");
  const party = await prisma.partyBookingDetail.findFirst({
    where: { bookingId, orgId },
    select: { booking: { select: { locationId: true } } },
  });
  if (!party) return { available: false as const, guests: [] };
  const scope = await waiverStampedLocationWhere(actor);
  if (!partyLocationInScope(scope.locationId, party.booking.locationId)) {
    throw new ForbiddenError("Party not found");
  }
  return computePartyWaiverGaps(orgId, bookingId);
}

/**
 * Party waiver coverage without an actor (Party Management mirrors it onto
 * PartyGuest.waiverStatus / PartyBookingDetail.waiverMissingCount).
 */
export async function computePartyWaiverGaps(orgId: string, bookingId: string) {
  const party = await prisma.partyBookingDetail.findFirst({
    where: { bookingId, orgId },
    include: {
      guests: true,
      booking: { select: { id: true, locationId: true } },
    },
  });
  if (!party) return { available: false as const, guests: [] };
  const [venue, locationSettings, orgSettings] = await Promise.all([
    prisma.venueLocation.findFirst({
      where: { id: party.booking.locationId, orgId },
      select: { timezone: true },
    }),
    prisma.waiverSettings.findFirst({
      where: { orgId, locationId: party.booking.locationId },
      select: { expiryRule: true, expiryDays: true },
    }),
    prisma.waiverSettings.findFirst({
      where: { orgId, locationId: null },
      select: { expiryRule: true, expiryDays: true },
    }),
  ]);
  const settings = locationSettings ?? orgSettings;
  const guestIds = party.guests.map((guest) => guest.id);
  const records = guestIds.length
    ? await prisma.waiverRecord.findMany({
        where: { orgId, partyGuestId: { in: guestIds } },
        orderBy: { createdAt: "desc" },
        select: {
          partyGuestId: true,
          status: true,
          expiresAt: true,
          signedAt: true,
          templateVersionId: true,
          template: {
            select: {
              defaultExpiryRule: true,
              defaultExpiryDays: true,
              requireResignOnPublish: true,
              currentPublishedVersionId: true,
            },
          },
          signers: { select: { isMinor: true, role: true } },
        },
      })
    : [];
  const now = new Date();
  const timeZone = venue?.timezone?.trim() || "UTC";
  const guests = party.guests.map((guest) => {
    const linked = records.filter((row) => row.partyGuestId === guest.id);
    const latest = linked[0];
    const covered = linked.some(
      (row) => partyRecordValidity(row, now, timeZone, settings) === "valid"
    );
    const waiverStatus: WaiverValidityStatus = covered
      ? "valid"
      : latest
        ? partyRecordValidity(latest, now, timeZone, settings)
        : "missing";
    return {
      partyGuestId: guest.id,
      name: guest.name,
      covered,
      waiverStatus,
    };
  });
  return {
    available: true as const,
    bookingId,
    locationId: party.booking.locationId,
    waiverMissingCount: guests.filter((guest) => !guest.covered).length,
    guests,
  };
}

export async function sendPartyWaiverChase(
  actor: WaiversActor,
  bookingId: string,
  templateId: string
) {
  await assertWaiverPermission(actor, P.WaiversWrite);
  const gaps = await listPartyWaiverGaps(actor, bookingId);
  if (!gaps.available) {
    return { available: false as const, sent: 0, skipped: "No party on this booking" };
  }
  const missing = gaps.guests.filter((guest) => !guest.covered);
  if (!missing.length) {
    return {
      available: true as const,
      sent: 0,
      missing: 0,
      skipped: "Every listed guest has a current waiver",
    };
  }
  const orgId = await assertWaiverPermission(actor, P.WaiversWrite);
  const owned = await prisma.booking.findFirst({
    where: { id: bookingId, orgId },
    select: { primaryContactEmail: true, primaryContactPhone: true },
  });
  if (!owned) throw new ForbiddenError("Party not found");
  const email = owned.primaryContactEmail?.trim() || "";
  const phone = (owned.primaryContactPhone ?? "").replace(/[^\d+]/g, "");
  if (!email.includes("@") && phone.length < 7) {
    return {
      available: true as const,
      sent: 0,
      missing: missing.length,
      skipped: "This booking has no contact email or phone",
    };
  }
  const partyGuestId = missing.length === 1 ? missing[0].partyGuestId : null;
  const created = await createWaiverRequest(actor, {
    templateId,
    locationId: gaps.locationId,
    toEmail: email.includes("@") ? email : null,
    toPhone: email.includes("@") ? null : phone,
    channel: email.includes("@") ? "email_link" : "sms_link",
    bookingId,
    partyGuestId,
  });
  const fresh = await prisma.waiverRequest.findFirst({
    where: { id: created.requestId, orgId },
    select: { status: true, createdAt: true },
  });
  if (fresh && (fresh.status === "sent" || fresh.status === "completed")) {
    await prisma.waiverRequest.updateMany({
      where: {
        orgId,
        locationId: gaps.locationId,
        templateId,
        bookingId,
        id: { not: created.requestId },
        partyGuestId,
        createdAt: { lt: fresh.createdAt },
        // Several missing guests share one contact link. That row has no guest id.
        // Confirmation links have no staff user, so they stay signable.
        ...(partyGuestId ? {} : { guestProfileId: null, createdById: { not: null } }),
        status: { in: ["queued", "sent", "failed", "opened"] },
      },
      data: { status: "cancelled" },
    });
  }
  const delivered = fresh?.status === "sent" || fresh?.status === "completed";
  return {
    available: true as const,
    sent: delivered ? 1 : 0,
    missing: missing.length,
    requestId: created.requestId,
    url: created.url,
    skipped: delivered ? undefined : "The link could not be delivered. Any earlier link for this booking is still valid.",
  };
}
