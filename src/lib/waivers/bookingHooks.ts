/**
 * Booking ↔ waiver bridge. Uses the shared evaluateGuestWaivers engine.
 * BookingGuest rows have no GuestProfile, so the contact email or phone is the guest.
 * A missing waiver mints one WaiverRequest for the confirmation email. It does not
 * confirm or block the booking. POS and the check-in scanner are not called here.
 */
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { evaluateGuestWaivers } from "@/lib/waivers/evaluateWaiver";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import {
  absoluteSignUrl,
  hashWaiverToken,
  WAIVER_REQUEST_TTL_MS,
} from "@/lib/waivers/signToken";

export type BookingWaiverStatus = {
  available: boolean;
  status: string;
  guestProfileId: string | null;
  reason: string | null;
  waiverUrl: string | null;
};

const LINK_STATUSES = new Set([
  "missing",
  "expired",
  "declined",
  "pending",
  "minor_unsigned",
  "voided",
]);

async function loadBooking(bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId },
    include: {
      location: { select: { status: true } },
      lines: {
        select: {
          productId: true,
          product: { select: { id: true, waiverRequired: true } },
        },
      },
    },
  });
}

export async function evaluateBookingWaivers(bookingId: string): Promise<BookingWaiverStatus> {
  const booking = await loadBooking(bookingId);
  if (!booking) {
    return {
      available: false,
      status: "missing",
      guestProfileId: null,
      reason: "Booking not found",
      waiverUrl: null,
    };
  }
  try {
    await assertWaiversEnabled(booking.orgId);
  } catch {
    return {
      available: false,
      status: "missing",
      guestProfileId: null,
      reason: "Waivers are not enabled for this company",
      waiverUrl: null,
    };
  }
  const targets = booking.lines
    .filter((line) => line.product?.waiverRequired && line.productId)
    .map((line) => ({ targetType: "admission_product", targetId: line.productId as string }));
  const email = booking.primaryContactEmail?.trim().toLowerCase() || "";
  const phone = (booking.primaryContactPhone ?? "").replace(/[^\d+]/g, "");
  const guest = email.includes("@")
    ? await prisma.guestProfile.findFirst({
        where: { orgId: booking.orgId, email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      })
    : phone.length >= 7
      ? await prisma.guestProfile.findFirst({
          where: { orgId: booking.orgId, phone },
          select: { id: true },
        })
      : null;
  if (!guest) {
    return {
      available: true,
      status: targets.length ? "missing" : "valid",
      guestProfileId: null,
      reason: targets.length ? "No guest profile matches this booking contact" : null,
      waiverUrl: null,
    };
  }
  try {
    const evaluation = await evaluateGuestWaivers({
      orgId: booking.orgId,
      locationId: booking.locationId,
      guestProfileId: guest.id,
      ...(targets.length ? { productTargets: targets } : {}),
    });
    // Desk evaluate also reports missing for an empty file or a stale personal waiver.
    // A booking needs a link only when a line is flagged or a configured requirement is open.
    const waiverDue =
      targets.length > 0 ||
      evaluation.missingRequirements.some((row) => row.requirementId != null);
    return {
      available: true,
      status: waiverDue ? evaluation.status : "valid",
      guestProfileId: guest.id,
      reason: waiverDue ? evaluation.missingRequirements[0]?.reason ?? null : null,
      waiverUrl: null,
    };
  } catch (err) {
    return {
      available: true,
      status: "unavailable",
      guestProfileId: guest.id,
      reason: err instanceof Error ? err.message : "Could not evaluate waivers",
      waiverUrl: null,
    };
  }
}

async function templateForBookingLink(booking: {
  orgId: string;
  locationId: string;
  lines: { productId: string | null; product: { waiverRequired: boolean } | null }[];
}): Promise<string | null> {
  const venueOrCompany = [{ locationId: booking.locationId }, { locationId: null }];
  const publishedHere = {
    status: "published" as const,
    archivedAt: null,
    currentPublishedVersionId: { not: null },
    OR: venueOrCompany,
  };
  const productIds = booking.lines
    .filter((line) => line.product?.waiverRequired && line.productId)
    .map((line) => line.productId as string);
  const productRequirement = productIds.length
    ? await prisma.waiverRequirement.findFirst({
        where: {
          orgId: booking.orgId,
          required: true,
          targetType: "admission_product",
          targetId: { in: productIds },
          OR: venueOrCompany,
          template: publishedHere,
        },
        orderBy: { sortOrder: "asc" },
        select: { templateId: true },
      })
    : null;
  if (productRequirement) return productRequirement.templateId;
  const admissions = await prisma.waiverRequirement.findFirst({
    where: {
      orgId: booking.orgId,
      required: true,
      targetType: "all_admissions",
      OR: venueOrCompany,
      template: publishedHere,
    },
    orderBy: { sortOrder: "asc" },
    select: { templateId: true },
  });
  if (admissions) return admissions.templateId;
  const fallback = await prisma.waiverTemplate.findFirst({
    where: {
      orgId: booking.orgId,
      kind: "liability_waiver",
      ...publishedHere,
    },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

/** Mint a signing link when the booking contact still needs a waiver. Does not retire older links. */
export async function waiverLinkForBooking(bookingId: string): Promise<string | null> {
  const issued = await issueBookingWaiverLink(bookingId);
  return issued?.url ?? null;
}

export async function issueBookingWaiverLink(
  bookingId: string
): Promise<{ url: string; requestId: string } | null> {
  const booking = await loadBooking(bookingId);
  if (!booking) return null;
  const status = await evaluateBookingWaivers(bookingId);
  if (!status.available || !LINK_STATUSES.has(status.status)) return null;
  if (booking.location.status !== "active") return null;
  const templateId = await templateForBookingLink(booking);
  if (!templateId) return null;
  const email = booking.primaryContactEmail?.trim().toLowerCase() || "";
  const phone = (booking.primaryContactPhone ?? "").replace(/[^\d+]/g, "");
  const toEmail = email.includes("@") ? email : null;
  const toPhone = phone.length >= 7 ? phone : null;
  if (!toEmail && !toPhone) return null;
  const token = randomBytes(32).toString("hex");
  const created = await prisma.waiverRequest.create({
    data: {
      orgId: booking.orgId,
      locationId: booking.locationId,
      templateId,
      guestProfileId: status.guestProfileId,
      toEmail,
      toPhone,
      channel: toEmail ? "email_link" : "sms_link",
      status: "queued",
      publicTokenHash: hashWaiverToken(token),
      expiresAt: new Date(Date.now() + WAIVER_REQUEST_TTL_MS),
      bookingId: booking.id,
    },
  });
  return { url: absoluteSignUrl(token), requestId: created.id };
}

const OPEN_LINK = ["queued", "sent", "failed", "opened"] as const;

async function retireOlderConfirmationLinks(row: {
  id: string;
  orgId: string;
  bookingId: string | null;
  templateId: string;
  guestProfileId: string | null;
  createdAt: Date;
}) {
  if (!row.bookingId) return;
  await prisma.waiverRequest.updateMany({
    where: {
      orgId: row.orgId,
      bookingId: row.bookingId,
      templateId: row.templateId,
      partyGuestId: null,
      guestProfileId: row.guestProfileId,
      // Confirmation rows are created without a staff user. Party and resend links store one.
      ...(row.guestProfileId ? {} : { createdById: null }),
      createdAt: { lt: row.createdAt },
      status: { in: [...OPEN_LINK] },
      id: { not: row.id },
    },
    data: { status: "cancelled" },
  });
}

/** After the confirmation email is attempted. A failed send cancels only the new link. */
export async function settleBookingWaiverLink(requestId: string, delivered: boolean): Promise<void> {
  const row = await prisma.waiverRequest.findFirst({
    where: { id: requestId },
    select: {
      id: true,
      orgId: true,
      bookingId: true,
      templateId: true,
      guestProfileId: true,
      status: true,
      createdAt: true,
    },
  });
  if (!row || row.status === "cancelled") return;
  if (!delivered) {
    if (row.status === "completed") {
      await retireOlderConfirmationLinks(row);
      return;
    }
    await prisma.waiverRequest.updateMany({
      where: { id: row.id, status: { in: [...OPEN_LINK] } },
      data: { status: "cancelled" },
    });
    return;
  }
  if (row.status !== "completed") {
    await prisma.waiverRequest.updateMany({
      where: { id: row.id, status: { in: [...OPEN_LINK] } },
      data: { status: "sent" },
    });
  }
  await retireOlderConfirmationLinks(row);
}
