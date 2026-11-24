import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import type { MarketingOverviewDto } from "@/lib/marketing/types";
import { countBirthdayUpcoming, countLapsed, countOptedInLeads } from "@/lib/marketing/segments";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { readMembershipMarketingBridge } from "@/lib/marketing/membershipBridge";
import { readWaiverMarketingBridge } from "@/lib/marketing/waiverBridge";

export async function buildMarketingOverview(
  orgId: string,
  locationId?: string | null
): Promise<MarketingOverviewDto> {
  const id = requireId(orgId, "orgId");
  const settings = await getOrCreateMarketingSettings(id, locationId ?? null);

  const [
    optedInLeadCount,
    welcomeSentCount,
    birthdayUpcomingCount,
    reengagementQueueCount,
    surveyPublishedCount,
    surveyResponseCount,
    membershipsDunning,
    waiverReminders,
    campaignActiveCount,
    newsletterSentLast30Days,
  ] = await Promise.all([
    countOptedInLeads(id),
    prisma.guestProfile.count({
      where: { orgId: id, welcomeEmailSentAt: { not: null } },
    }),
    countBirthdayUpcoming(id, settings.birthdayDaysAhead),
    countLapsed(id, settings.reengagementInactiveDays),
    prisma.guestSurvey.count({
      where: { orgId: id, status: "published" },
    }),
    prisma.guestSurveyResponse.count({ where: { orgId: id } }),
    readMembershipMarketingBridge(id, locationId),
    readWaiverMarketingBridge(id, locationId),
    prisma.marketingCampaign.count({
      where: { orgId: id, status: { in: ["scheduled", "sending"] } },
    }),
    prisma.marketingSendLog.count({
      where: {
        orgId: id,
        kind: "newsletter",
        status: "sent",
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
    }),
  ]);

  return {
    optedInLeadCount,
    welcomeSentCount,
    birthdayUpcomingCount,
    reengagementQueueCount,
    surveyPublishedCount,
    surveyResponseCount,
    membershipsDunning,
    waiverReminders,
    campaignActiveCount,
    newsletterSentLast30Days,
  };
}
