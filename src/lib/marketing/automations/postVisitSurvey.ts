import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { renderMarketingTemplate } from "@/lib/marketing/templates";
import { sendPromotionalMarketingEmail } from "@/lib/marketing/send";
import { createSurveyInvite, buildVisitRef } from "@/lib/marketing/surveys";
import {
  MARKETING_BATCH_CAP,
  type AutomationRunResult,
} from "@/lib/marketing/types";

export async function runPostVisitSurveyAutomation(
  orgId: string,
  opts?: { limit?: number }
): Promise<AutomationRunResult> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);

  const settings = await getOrCreateMarketingSettings(id);
  if (!settings.postVisitSurveyEnabled || !settings.defaultSurveyId) {
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const survey = await prisma.guestSurvey.findFirst({
    where: { id: settings.defaultSurveyId, orgId: id, status: "published" },
    select: { id: true },
  });
  if (!survey) return { sent: 0, skipped: 0, failed: 0 };

  const limit = Math.min(opts?.limit ?? MARKETING_BATCH_CAP, MARKETING_BATCH_CAP);
  const delayMs = settings.postVisitDelayHours * 60 * 60 * 1000;
  const now = new Date();
  const visitBefore = new Date(now.getTime() - delayMs);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { name: true, slug: true },
  });

  const candidates = await prisma.guestProfile.findMany({
    where: {
      orgId: id,
      marketingEmailOptIn: true,
      bannedAt: null,
      email: { not: null },
      lastVisitAt: { not: null, lte: visitBefore },
    },
    orderBy: { lastVisitAt: "asc" },
    take: limit,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const guest of candidates) {
    const visitDay = guest.lastVisitAt!.toISOString().slice(0, 10);
    const visitRef = buildVisitRef({ guestProfileId: guest.id, visitDay });

    const existingInvite = await prisma.guestSurveyInvite.findUnique({
      where: { orgId_visitRef: { orgId: id, visitRef } },
    });
    // Already delivered or completed — do not re-invite for this visit window.
    if (existingInvite?.sentAt || existingInvite?.completedAt) {
      skipped += 1;
      continue;
    }

    let inviteId: string;
    let inviteToken: string;
    if (existingInvite) {
      // Prior send failed after invite create — retry the same token.
      inviteId = existingInvite.id;
      inviteToken = existingInvite.token;
    } else {
      const invite = await createSurveyInvite({
        orgId: id,
        surveyId: survey.id,
        guestProfileId: guest.id,
        locationId: guest.locationId,
        visitRef,
      });
      inviteId = invite.id;
      inviteToken = invite.token;
    }

    const surveyUrl = `${publicAppBaseUrl()}/survey/${inviteToken}`;

    const rendered = await renderMarketingTemplate({
      orgId: id,
      kind: "post_visit_survey",
      guestProfileId: guest.id,
      guestFirstName: guest.firstName,
      orgName: org?.name ?? "Our park",
      orgSlug: org?.slug,
      settings,
      surveyUrl,
    });

    const result = await sendPromotionalMarketingEmail({
      orgId: id,
      locationId: guest.locationId,
      guestProfileId: guest.id,
      kind: "post_visit_survey",
      automationKey: visitRef,
      subject: rendered.subject,
      htmlBody: rendered.html,
      templateKey: rendered.templateKey,
      replyTo: settings.replyToEmail,
      metadata: { surveyId: survey.id, inviteId },
    });

    if (result.status === "sent") {
      sent += 1;
      await prisma.guestSurveyInvite.update({
        where: { id: inviteId },
        data: { sentAt: now },
      });
      await prisma.marketingAutomationRun.upsert({
        where: {
          orgId_guestProfileId_kind_windowKey: {
            orgId: id,
            guestProfileId: guest.id,
            kind: "post_visit_survey",
            windowKey: visitRef,
          },
        },
        create: {
          orgId: id,
          guestProfileId: guest.id,
          kind: "post_visit_survey",
          windowKey: visitRef,
        },
        update: { sentAt: now },
      });
    } else if (result.status === "skipped") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, skipped, failed };
}
