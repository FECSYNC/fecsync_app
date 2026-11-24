/**
 * Park marketing welcome (distinct from fashion auth `sendWelcomeEmail`).
 *
 * First-visit SSOT: GuestProfile.firstVisitAt (set by visitTouch from booking
 * confirm / POS sale). When settings.welcomeFromNewsletter is true, newsletter
 * subscribe time may also qualify. Idempotent via welcomeEmailSentAt +
 * MarketingAutomationRun kind=welcome windowKey=once. Promotional — requires
 * marketingEmailOptIn.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { renderMarketingTemplate } from "@/lib/marketing/templates";
import { sendPromotionalMarketingEmail } from "@/lib/marketing/send";
import {
  MARKETING_BATCH_CAP,
  type AutomationRunResult,
} from "@/lib/marketing/types";

const WINDOW_KEY = "once";

export async function runWelcomeAutomation(
  orgId: string,
  opts?: { limit?: number }
): Promise<AutomationRunResult> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);

  const settings = await getOrCreateMarketingSettings(id);
  if (!settings.welcomeEnabled) return { sent: 0, skipped: 0, failed: 0 };

  const limit = Math.min(opts?.limit ?? MARKETING_BATCH_CAP, MARKETING_BATCH_CAP);
  const delayMs = settings.welcomeDelayHours * 60 * 60 * 1000;
  const now = new Date();
  const eligibleBefore = new Date(now.getTime() - delayMs);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { name: true, slug: true },
  });

  const candidates = await prisma.guestProfile.findMany({
    where: {
      orgId: id,
      marketingEmailOptIn: true,
      bannedAt: null,
      welcomeEmailSentAt: null,
      email: { not: null },
      OR: [
        {
          firstVisitAt: { not: null, lte: eligibleBefore },
        },
        ...(settings.welcomeFromNewsletter
          ? [{ newsletterSubscribedAt: { not: null, lte: eligibleBefore } }]
          : []),
      ],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const guest of candidates) {
    const existingRun = await prisma.marketingAutomationRun.findUnique({
      where: {
        orgId_guestProfileId_kind_windowKey: {
          orgId: id,
          guestProfileId: guest.id,
          kind: "welcome",
          windowKey: WINDOW_KEY,
        },
      },
    });
    if (existingRun) {
      skipped += 1;
      continue;
    }

    const rendered = await renderMarketingTemplate({
      orgId: id,
      kind: "welcome",
      guestProfileId: guest.id,
      guestFirstName: guest.firstName,
      orgName: org?.name ?? "Our park",
      orgSlug: org?.slug,
      settings,
    });

    const result = await sendPromotionalMarketingEmail({
      orgId: id,
      locationId: guest.locationId,
      guestProfileId: guest.id,
      kind: "welcome",
      automationKey: "welcome",
      subject: rendered.subject,
      htmlBody: rendered.html,
      templateKey: rendered.templateKey,
      replyTo: settings.replyToEmail,
    });

    if (result.status === "sent") {
      sent += 1;
      await prisma.$transaction([
        prisma.guestProfile.update({
          where: { id: guest.id },
          data: { welcomeEmailSentAt: now },
        }),
        prisma.marketingAutomationRun.create({
          data: {
            orgId: id,
            guestProfileId: guest.id,
            kind: "welcome",
            windowKey: WINDOW_KEY,
          },
        }),
      ]);
    } else if (result.status === "skipped") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, skipped, failed };
}
