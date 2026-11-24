/**
 * Step 3 — daily subscription / ops-grant remind windows (14 / 7 / 3 / 1 days).
 * Catch-up: any org with endsAt within the next N days and a null watermark is
 * reminded once (missed cron days are recovered). Never suspends.
 */

import prisma from "@/lib/prisma";
import {
  notifyCompanyExpiringSoon,
  notifyOpsGrantExpiringSoon,
  type CompanyExpiringSoonDays,
} from "@/lib/companySubscriptionNotices";

export const COMPANY_SUBSCRIPTION_REMIND_DAYS: CompanyExpiringSoonDays[] = [
  14, 7, 3, 1,
];

export type RemindSummary = {
  scanned: number;
  reminded14d: number;
  reminded7d: number;
  reminded3d: number;
  reminded1d: number;
  opsGrant14d: number;
  opsGrant7d: number;
  opsGrant3d: number;
  opsGrant1d: number;
  skipped: number;
  errors: number;
};

const PAGE = 200;

function bumpSummary(
  summary: RemindSummary,
  days: CompanyExpiringSoonDays,
  opsGrant: boolean
) {
  if (opsGrant) {
    if (days === 14) summary.opsGrant14d += 1;
    else if (days === 7) summary.opsGrant7d += 1;
    else if (days === 3) summary.opsGrant3d += 1;
    else summary.opsGrant1d += 1;
    return;
  }
  if (days === 14) summary.reminded14d += 1;
  else if (days === 7) summary.reminded7d += 1;
  else if (days === 3) summary.reminded3d += 1;
  else summary.reminded1d += 1;
}

export async function runCompanySubscriptionReminders(
  now: Date = new Date()
): Promise<RemindSummary> {
  const summary: RemindSummary = {
    scanned: 0,
    reminded14d: 0,
    reminded7d: 0,
    reminded3d: 0,
    reminded1d: 0,
    opsGrant14d: 0,
    opsGrant7d: 0,
    opsGrant3d: 0,
    opsGrant1d: 0,
    skipped: 0,
    errors: 0,
  };

  // Longest window first so early renewals still get the 14d notice.
  for (const days of COMPANY_SUBSCRIPTION_REMIND_DAYS) {
    const horizonEnd = new Date(
      now.getTime() + (days + 0.5) * 24 * 60 * 60 * 1000
    );

    let cursorEndsAt: Date | null = null;
    let cursorId: string | null = null;

    for (;;) {
      const candidates = await prisma.organization.findMany({
        where: {
          isDefault: false,
          status: "active",
          subscriptionStatus: { in: ["active", "trialing", "past_due"] },
          subscriptionEndsAt: {
            gt: now,
            lte: horizonEnd,
          },
          ...(cursorEndsAt && cursorId
            ? {
                OR: [
                  { subscriptionEndsAt: { gt: cursorEndsAt } },
                  {
                    subscriptionEndsAt: cursorEndsAt,
                    id: { gt: cursorId },
                  },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          subscriptionEndsAt: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          stripeSubscriptionId: true,
        },
        take: PAGE,
        orderBy: [{ subscriptionEndsAt: "asc" }, { id: "asc" }],
      });
      if (candidates.length === 0) break;
      summary.scanned += candidates.length;

      for (const org of candidates) {
        if (!org.subscriptionEndsAt) {
          summary.skipped += 1;
          continue;
        }
        const isOpsGrant =
          !org.stripeSubscriptionId?.trim() &&
          org.subscriptionStatus === "active" &&
          Boolean(org.subscriptionPlan?.trim());

        try {
          const sent = isOpsGrant
            ? await notifyOpsGrantExpiringSoon(
                org.id,
                days,
                org.subscriptionEndsAt
              )
            : await notifyCompanyExpiringSoon(
                org.id,
                days,
                org.subscriptionEndsAt
              );
          if (!sent) {
            summary.skipped += 1;
            continue;
          }
          bumpSummary(summary, days, isOpsGrant);
        } catch (err) {
          summary.errors += 1;
          console.warn(
            "[remind] error",
            org.id,
            err instanceof Error ? err.message : err
          );
        }
      }

      const last = candidates[candidates.length - 1]!;
      cursorEndsAt = last.subscriptionEndsAt;
      cursorId = last.id;
      if (candidates.length < PAGE) break;
    }
  }

  return summary;
}
