import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { renderMarketingTemplate } from "@/lib/marketing/templates";
import { sendPromotionalMarketingEmail } from "@/lib/marketing/send";
import { listLapsedCandidates } from "@/lib/marketing/segments";
import {
  MARKETING_BATCH_CAP,
  type AutomationRunResult,
} from "@/lib/marketing/types";

function cooldownWindowKey(now: Date, cooldownDays: number): string {
  const bucket = Math.floor(now.getTime() / (cooldownDays * 24 * 60 * 60 * 1000));
  return `cooldown:${bucket}`;
}

export async function runReengagementAutomation(
  orgId: string,
  opts?: { limit?: number }
): Promise<AutomationRunResult> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);

  const settings = await getOrCreateMarketingSettings(id);
  if (!settings.reengagementEnabled) return { sent: 0, skipped: 0, failed: 0 };

  const limit = Math.min(opts?.limit ?? MARKETING_BATCH_CAP, MARKETING_BATCH_CAP);
  const now = new Date();
  const windowKey = cooldownWindowKey(now, settings.reengagementCooldownDays);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { name: true, slug: true },
  });

  const candidates = await listLapsedCandidates(
    id,
    settings.reengagementInactiveDays,
    { limit, now }
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const guest of candidates) {
    const recent = await prisma.marketingAutomationRun.findFirst({
      where: {
        orgId: id,
        guestProfileId: guest.id,
        kind: "reengagement",
        sentAt: {
          gte: new Date(
            now.getTime() -
              settings.reengagementCooldownDays * 24 * 60 * 60 * 1000
          ),
        },
      },
    });
    if (recent) {
      skipped += 1;
      continue;
    }

    const existingRun = await prisma.marketingAutomationRun.findUnique({
      where: {
        orgId_guestProfileId_kind_windowKey: {
          orgId: id,
          guestProfileId: guest.id,
          kind: "reengagement",
          windowKey,
        },
      },
    });
    if (existingRun) {
      skipped += 1;
      continue;
    }

    const rendered = await renderMarketingTemplate({
      orgId: id,
      kind: "reengagement",
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
      kind: "reengagement",
      automationKey: `reengagement:${windowKey}`,
      subject: rendered.subject,
      htmlBody: rendered.html,
      templateKey: rendered.templateKey,
      replyTo: settings.replyToEmail,
    });

    if (result.status === "sent") {
      sent += 1;
      await prisma.marketingAutomationRun.create({
        data: {
          orgId: id,
          guestProfileId: guest.id,
          kind: "reengagement",
          windowKey,
        },
      });
    } else if (result.status === "skipped") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, skipped, failed };
}
