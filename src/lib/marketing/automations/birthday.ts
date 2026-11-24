import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { renderMarketingTemplate } from "@/lib/marketing/templates";
import { sendPromotionalMarketingEmail } from "@/lib/marketing/send";
import {
  birthdayWindowKey,
  listBirthdayCandidates,
} from "@/lib/marketing/segments";
import {
  MARKETING_BATCH_CAP,
  type AutomationRunResult,
} from "@/lib/marketing/types";

export async function runBirthdayAutomation(
  orgId: string,
  opts?: { limit?: number }
): Promise<AutomationRunResult> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);

  const settings = await getOrCreateMarketingSettings(id);
  if (!settings.birthdayEnabled) return { sent: 0, skipped: 0, failed: 0 };

  const limit = Math.min(opts?.limit ?? MARKETING_BATCH_CAP, MARKETING_BATCH_CAP);
  const windowKey = birthdayWindowKey();

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { name: true, slug: true },
  });

  const candidates = await listBirthdayCandidates(
    id,
    settings.birthdayDaysAhead,
    { limit }
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const guest of candidates) {
    const existingRun = await prisma.marketingAutomationRun.findUnique({
      where: {
        orgId_guestProfileId_kind_windowKey: {
          orgId: id,
          guestProfileId: guest.id,
          kind: "birthday",
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
      kind: "birthday",
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
      kind: "birthday",
      automationKey: `birthday:${windowKey}`,
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
          kind: "birthday",
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
