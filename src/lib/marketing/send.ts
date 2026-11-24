import type { MarketingSendStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { sendMarketingGuestEmail } from "@/lib/mailer";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { isPromotionalEmailAllowed } from "@/lib/marketing/consent";
import type { MarketingAutomationKind } from "@/lib/marketing/types";

export type PromotionalSendInput = {
  orgId: string;
  locationId?: string | null;
  guestProfileId: string;
  kind: MarketingAutomationKind | string;
  automationKey: string;
  subject: string;
  htmlBody: string;
  templateKey?: string;
  replyTo?: string | null;
  fromName?: string | null;
  listUnsubscribeUrl?: string | null;
  metadata?: Record<string, unknown>;
};

export type PromotionalSendResult = {
  status: MarketingSendStatus;
  skipReason?: string;
  logId: string;
};

async function writeSendLog(input: {
  orgId: string;
  locationId?: string | null;
  guestProfileId?: string | null;
  toEmail: string;
  kind: string;
  automationKey: string;
  status: MarketingSendStatus;
  skipReason?: string;
  templateKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const row = await prisma.marketingSendLog.create({
    data: {
      orgId: input.orgId,
      locationId: input.locationId ?? null,
      guestProfileId: input.guestProfileId ?? null,
      toEmail: input.toEmail,
      kind: input.kind,
      automationKey: input.automationKey,
      status: input.status,
      skipReason: input.skipReason?.slice(0, 500) ?? null,
      templateKey: input.templateKey ?? null,
      metadata: input.metadata
        ? (input.metadata as Prisma.InputJsonValue)
        : undefined,
    },
  });
  return row.id;
}

export async function sendPromotionalMarketingEmail(
  input: PromotionalSendInput
): Promise<PromotionalSendResult> {
  const orgId = requireId(input.orgId, "orgId");
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");

  await assertMarketingEnabled(orgId);

  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
    select: {
      id: true,
      email: true,
      marketingEmailOptIn: true,
      bannedAt: true,
    },
  });

  const toEmail = guest?.email?.trim() ?? "";
  if (!guest || !isPromotionalEmailAllowed(guest)) {
    const logId = await writeSendLog({
      orgId,
      locationId: input.locationId,
      guestProfileId,
      toEmail: toEmail || "(missing)",
      kind: input.kind,
      automationKey: input.automationKey,
      status: "skipped",
      skipReason: guest?.bannedAt
        ? "guest_banned"
        : !guest?.marketingEmailOptIn
          ? "not_opted_in"
          : "missing_email",
      templateKey: input.templateKey,
      metadata: input.metadata,
    });
    return {
      status: "skipped",
      skipReason: guest?.bannedAt ? "guest_banned" : "consent",
      logId,
    };
  }

  const delivered = await sendMarketingGuestEmail({
    orgId,
    to: toEmail,
    subject: input.subject,
    htmlBody: input.htmlBody,
    replyTo: input.replyTo,
    fromName: input.fromName,
    listUnsubscribeUrl: input.listUnsubscribeUrl,
  });

  const now = new Date();
  if (delivered) {
    await prisma.guestProfile.update({
      where: { id: guestProfileId },
      data: { lastMarketingEmailAt: now },
    });
  }

  const logId = await writeSendLog({
    orgId,
    locationId: input.locationId,
    guestProfileId,
    toEmail,
    kind: input.kind,
    automationKey: input.automationKey,
    status: delivered ? "sent" : "failed",
    skipReason: delivered ? undefined : "mail_transport",
    templateKey: input.templateKey,
    metadata: input.metadata,
  });

  return {
    status: delivered ? "sent" : "failed",
    logId,
  };
}

export async function listMarketingSendLogs(
  orgId: string,
  opts?: { take?: number; kind?: string }
): Promise<
  Array<{
    id: string;
    orgId: string;
    locationId: string | null;
    guestProfileId: string | null;
    toEmail: string;
    kind: string;
    automationKey: string;
    status: string;
    skipReason: string | null;
    templateKey: string | null;
    createdAt: string;
  }>
> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);
  const take = Math.min(Math.max(opts?.take ?? 100, 1), 500);
  const rows = await prisma.marketingSendLog.findMany({
    where: {
      orgId: id,
      ...(opts?.kind?.trim() ? { kind: opts.kind.trim() } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    locationId: r.locationId,
    guestProfileId: r.guestProfileId,
    toEmail: r.toEmail,
    kind: r.kind,
    automationKey: r.automationKey,
    status: r.status,
    skipReason: r.skipReason,
    templateKey: r.templateKey,
    createdAt: r.createdAt.toISOString(),
  }));
}
