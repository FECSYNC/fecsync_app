/**
 * Public waiver links. The raw token is returned once; only a sha256 hash is stored.
 * Public submit never trusts a client orgId — the token row is the authority.
 */
import { createHash, createHmac, randomBytes } from "crypto";
import type { WaiverSignChannel } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId, requireId } from "@/lib/ids";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { smsIsConfigured, sendSms, SmsNotConfiguredError } from "@/lib/sms";
import { sendWaiverGuestEmail } from "@/lib/mailer";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import { consumeRateLimit } from "@/lib/rateLimit";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import {
  assertLocationInWaiverScope,
  assertWaiversStaff,
  rejectClientOrgFields,
  requireActorVenueInScope,
  type WaiversActor,
} from "@/lib/waivers/common";

export const WAIVER_REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class WaiverLinkError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WaiverLinkError";
    this.status = status;
  }
}

export function hashWaiverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signPath(token: string): string {
  return `/sign/${token}`;
}

export function absoluteSignUrl(token: string): string {
  return `${publicAppBaseUrl()}${signPath(token)}`;
}

function signageSecret(): string {
  return (
    process.env.WAIVER_SIGNAGE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "fecsync-waiver-signage"
  );
}

export function signageTokenValue(
  orgId: string,
  locationId: string,
  templateId: string,
  nonce: string
): string {
  return createHmac("sha256", signageSecret())
    .update(`${orgId}|${locationId}|${templateId}|${nonce}`)
    .digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type CreateWaiverRequestInput = {
  templateId: string;
  locationId: string;
  toEmail?: string | null;
  toPhone?: string | null;
  guestProfileId?: string | null;
  locale?: string | null;
  channel?: WaiverSignChannel;
  bookingId?: string | null;
  partyGuestId?: string | null;
};

export async function assertWaiverRequestRate(orgId: string): Promise<void> {
  const result = consumeRateLimit(`waiver-req:${orgId}`, 80, 60 * 60 * 1000);
  if (!result.allowed) {
    throw new WaiverLinkError(
      "Too many waiver requests. Try again shortly.",
      429
    );
  }
}

async function publishedTemplateForVenue(
  orgId: string,
  templateId: string,
  locationId: string
) {
  const id = requireId(templateId, "templateId");
  const template = await prisma.waiverTemplate.findFirst({
    where: { id, orgId },
    include: {
      currentPublishedVersion: { include: { locales: true } },
    },
  });
  if (!template || template.status !== "published" || template.archivedAt) {
    throw new Error("Publish the template before sending a signing link");
  }
  if (!template.currentPublishedVersionId || !template.currentPublishedVersion) {
    throw new Error("Publish the template before sending a signing link");
  }
  if (template.locationId && template.locationId !== locationId) {
    throw new ForbiddenError("That template belongs to another venue");
  }
  return template;
}

export async function createWaiverRequest(
  actor: WaiversActor,
  input: CreateWaiverRequestInput
) {
  rejectClientOrgFields(input);
  const orgId = await assertWaiversStaff(actor);
  const locationId = requireId(input.locationId, "locationId");
  const venue = await requireActorVenueInScope(actor, locationId);
  if (venue.status !== "active") {
    throw new Error("Choose an active venue");
  }
  const template = await publishedTemplateForVenue(
    orgId,
    input.templateId,
    locationId
  );

  const email = input.toEmail?.trim().toLowerCase() || "";
  const toEmail = email.includes("@") ? email : null;
  const phone = (input.toPhone ?? "").replace(/[^\d+]/g, "");
  const toPhone = phone.length >= 7 ? phone : null;

  let channel: WaiverSignChannel = input.channel ?? "online";
  if (
    input.channel &&
    input.channel !== "online" &&
    input.channel !== "email_link" &&
    input.channel !== "sms_link" &&
    input.channel !== "onsite"
  ) {
    throw new Error("That signing channel is not available");
  }
  if (!input.channel && toEmail) channel = "email_link";
  if (!input.channel && !toEmail && toPhone) channel = "sms_link";
  if (channel === "sms_link") {
    if (!toPhone) throw new Error("A phone number is required for SMS");
    if (!smsIsConfigured()) throw new SmsNotConfiguredError();
  }

  let guestProfileId: string | null = null;
  if (input.guestProfileId) {
    const guestId = requireId(input.guestProfileId, "guestProfileId");
    const guest = await prisma.guestProfile.findFirst({
      where: { id: guestId, orgId },
      select: { id: true },
    });
    if (!guest) throw new ForbiddenError("Guest not found");
    guestProfileId = guest.id;
  }

  const locale = (input.locale ?? "en").trim().slice(0, 12) || "en";
  let bookingId: string | null = null;
  if (input.bookingId && isValidId(input.bookingId)) {
    const booking = await prisma.booking.findFirst({
      where: { id: input.bookingId, orgId },
      select: { id: true, locationId: true },
    });
    if (booking) {
      await assertLocationInWaiverScope(actor, booking.locationId);
      bookingId = booking.id;
    }
  }
  let partyGuestId: string | null = null;
  if (input.partyGuestId && isValidId(input.partyGuestId)) {
    const partyGuest = await prisma.partyGuest.findFirst({
      where: { id: input.partyGuestId, partyDetail: { orgId } },
      select: {
        id: true,
        partyDetail: { select: { bookingId: true, booking: { select: { locationId: true } } } },
      },
    });
    if (partyGuest) {
      await assertLocationInWaiverScope(actor, partyGuest.partyDetail.booking.locationId);
      if (bookingId && bookingId !== partyGuest.partyDetail.bookingId) {
        throw new Error("That guest is not on this booking");
      }
      partyGuestId = partyGuest.id;
      bookingId = partyGuest.partyDetail.bookingId;
    }
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + WAIVER_REQUEST_TTL_MS);

  const request = await prisma.waiverRequest.create({
    data: {
      orgId,
      locationId,
      templateId: template.id,
      guestProfileId,
      toEmail,
      toPhone,
      channel,
      status: "queued",
      publicTokenHash: hashWaiverToken(token),
      locale,
      expiresAt,
      createdById: actor.sub && isValidId(actor.sub) ? actor.sub : null,
      bookingId,
      partyGuestId,
    },
  });

  let status: "sent" | "failed" | "queued" = "queued";
  let providerMessageId: string | null = null;
  const url = absoluteSignUrl(token);
  const brandName = venue.name;

  if (channel === "sms_link" && toPhone) {
    try {
      const sent = await sendSms(
        toPhone,
        `${brandName}: sign your waiver ${url}`
      );
      providerMessageId = sent.providerId;
      status = "sent";
    } catch (err) {
      status = "failed";
      if (err instanceof SmsNotConfiguredError) {
        await prisma.waiverRequest.updateMany({
          where: {
            id: request.id,
            status: { in: ["queued", "opened", "sent", "failed"] },
          },
          data: { status: "failed" },
        });
        throw err;
      }
    }
  } else if (toEmail && (channel === "email_link" || channel === "online")) {
    const html = `
      <p>${escapeHtml(brandName)} asked you to review and sign <strong>${escapeHtml(template.name)}</strong>.</p>
      <p><a href="${escapeHtml(url)}">Open the waiver</a></p>
      <p style="font-size:13px;color:#666;">This link expires in 14 days. If you did not expect it, you can ignore this email.</p>
    `;
    const ok = await sendWaiverGuestEmail({
      orgId,
      to: toEmail,
      subject: `${brandName} — please sign ${template.name}`,
      htmlBody: html,
    });
    status = ok ? "sent" : "failed";
  }

  if (status !== "queued") {
    // A guest can sign, or a newer link can cancel this row, while email is in flight.
    await prisma.waiverRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ["queued", "opened", "sent", "failed"] },
      },
      data: {
        status,
        sentAt: status === "sent" ? new Date() : null,
        providerMessageId,
      },
    });
  }

  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId,
    action: "waiver.request.send",
    entityType: "WaiverRequest",
    entityId: request.id,
    description: `Waiver link ${status} via ${channel}`,
    metadata: {
      channel,
      status,
      templateId: template.id,
      locationId,
      providerMessageId,
    },
  });

  return {
    requestId: request.id,
    token,
    url,
    expiresAt: expiresAt.toISOString(),
    status,
    channel,
    providerMessageId,
  };
}

export async function issueSignageLink(
  actor: WaiversActor,
  templateId: string,
  locationId: string
) {
  rejectClientOrgFields({ templateId, locationId });
  const orgId = await assertWaiversStaff(actor);
  const venue = await requireActorVenueInScope(actor, locationId);
  if (venue.status !== "active") throw new Error("Choose an active venue");
  await publishedTemplateForVenue(orgId, templateId, venue.id);

  const existing = await prisma.waiverSignageToken.findFirst({
    where: { orgId, locationId: venue.id, templateId: requireId(templateId, "templateId") },
  });
  const nonce = existing && !existing.revokedAt ? existing.nonce : randomBytes(16).toString("hex");
  const token = signageTokenValue(orgId, venue.id, requireId(templateId, "templateId"), nonce);
  const tokenHash = hashWaiverToken(token);
  if (existing) {
    await prisma.waiverSignageToken.update({
      where: { id: existing.id },
      data: { nonce, tokenHash, revokedAt: null, kind: "signage" },
    });
  } else {
    try {
      await prisma.waiverSignageToken.create({
        data: {
          orgId,
          locationId: venue.id,
          templateId: requireId(templateId, "templateId"),
          nonce,
          tokenHash,
          kind: "signage",
        },
      });
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      if (code !== "P2002") throw err;
      await prisma.waiverSignageToken.update({
        where: {
          orgId_locationId_templateId: {
            orgId,
            locationId: venue.id,
            templateId: requireId(templateId, "templateId"),
          },
        },
        data: { nonce, tokenHash, revokedAt: null, kind: "signage" },
      });
    }
  }
  return { url: absoluteSignUrl(token), token };
}
