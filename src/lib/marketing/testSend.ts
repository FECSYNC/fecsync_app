import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { renderMarketingTemplate } from "@/lib/marketing/templates";
import { sendMarketingGuestEmail } from "@/lib/mailer";
import type { MarketingAutomationKind } from "@/lib/marketing/types";

const TEST_KINDS: MarketingAutomationKind[] = [
  "welcome",
  "birthday",
  "reengagement",
  "post_visit_survey",
  "newsletter_confirm",
];

export async function sendMarketingAutomationTest(input: {
  orgId: string;
  actorUserId: string;
  kind: string;
}): Promise<{ sent: boolean; toEmail: string }> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);

  const kind = input.kind.trim() as MarketingAutomationKind;
  if (!TEST_KINDS.includes(kind)) {
    throw new Error("Unsupported automation kind for test send");
  }

  const user = await prisma.user.findUnique({
    where: { id: requireId(input.actorUserId, "userId") },
    select: { email: true },
  });
  const toEmail = user?.email?.trim();
  if (!toEmail) {
    throw new Error("Your staff account has no email — test send goes to you only");
  }

  const settings = await getOrCreateMarketingSettings(orgId);
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true },
  });

  const rendered = await renderMarketingTemplate({
    orgId,
    kind,
    guestProfileId: input.actorUserId,
    guestFirstName: "Test",
    orgName: org?.name ?? "Our park",
    orgSlug: org?.slug,
    settings,
  });

  const delivered = await sendMarketingGuestEmail({
    orgId,
    to: toEmail,
    subject: `[Test] ${rendered.subject}`,
    htmlBody: rendered.html,
    replyTo: settings.replyToEmail,
  });

  return { sent: delivered, toEmail };
}
