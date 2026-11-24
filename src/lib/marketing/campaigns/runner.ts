import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { planAllowsModule } from "@/lib/subscriptionPlans";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { sendPromotionalMarketingEmail } from "@/lib/marketing/send";
import { buildUnsubscribeUrl } from "@/lib/marketing/unsubscribe";
import { normalizeCampaignBlocks } from "@/lib/marketing/campaigns/blocks";
import {
  campaignAudienceWhere,
  normalizeCampaignAudience,
} from "@/lib/marketing/campaigns/audience";
import {
  loadCampaignRenderBase,
  ONCE_WINDOW_KEY,
  planNextMonthlyAfter,
  renderCampaignForGuest,
} from "@/lib/marketing/campaigns/campaigns";

/** A crashed run releases its claim after this long. */
const CLAIM_LEASE_MS = 15 * 60_000;
const BATCH_SIZE = 50;

export type CampaignRunSummary = {
  campaignsProcessed: number;
  issuesCompleted: number;
  sent: number;
  skipped: number;
  failed: number;
};

export async function runDueMarketingCampaigns(opts?: {
  orgId?: string;
  now?: Date;
  /** Max guests attempted per campaign per run. */
  perCampaignLimit?: number;
  /** Wall-clock budget for the whole run. */
  timeBudgetMs?: number;
}): Promise<CampaignRunSummary> {
  const started = Date.now();
  const now = opts?.now ?? new Date();
  const perCampaignLimit = Math.max(1, opts?.perCampaignLimit ?? 300);
  const budget = opts?.timeBudgetMs ?? 100_000;
  const summary: CampaignRunSummary = {
    campaignsProcessed: 0,
    issuesCompleted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const due = await prisma.marketingCampaign.findMany({
    where: {
      status: { in: ["scheduled", "sending"] },
      nextRunAt: { lte: now },
      ...(opts?.orgId ? { orgId: opts.orgId } : {}),
      org: { status: "active" },
    },
    include: { org: { select: { subscriptionPlan: true } } },
    orderBy: { nextRunAt: "asc" },
    take: 25,
  });

  for (const campaign of due) {
    if (Date.now() - started > budget) break;
    if (!planAllowsModule(campaign.org.subscriptionPlan, "marketing")) continue;
    try {
      await assertMarketingEnabled(campaign.orgId);
    } catch {
      continue;
    }

    const claimed = await prisma.marketingCampaign.updateMany({
      where: {
        id: campaign.id,
        status: { in: ["scheduled", "sending"] },
        nextRunAt: { lte: now },
      },
      data: {
        status: "sending",
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + CLAIM_LEASE_MS),
      },
    });
    if (claimed.count === 0) continue;
    summary.campaignsProcessed += 1;

    const windowKey = campaign.currentWindowKey ?? ONCE_WINDOW_KEY;
    const blocks = normalizeCampaignBlocks(campaign.blocks);
    const audience = normalizeCampaignAudience(campaign.audience);
    let exhausted = false;
    let attempted = 0;

    try {
      const base = await loadCampaignRenderBase({
        orgId: campaign.orgId,
        locationId: campaign.locationId,
        timezone: campaign.timezone,
        blocks,
      });
      const where = {
        ...campaignAudienceWhere({
          orgId: campaign.orgId,
          locationId: campaign.locationId,
          audience,
          now,
        }),
        marketingCampaignRecipients: {
          none: { campaignId: campaign.id, windowKey },
        },
      } satisfies Prisma.GuestProfileWhereInput;

      while (attempted < perCampaignLimit && Date.now() - started <= budget) {
        if (attempted > 0) {
          const current = await prisma.marketingCampaign.findUnique({
            where: { id: campaign.id },
            select: { status: true },
          });
          if (current?.status !== "sending") break;
        }
        const take = Math.min(BATCH_SIZE, perCampaignLimit - attempted);
        const guests = await prisma.guestProfile.findMany({
          where,
          select: { id: true, firstName: true, locationId: true },
          orderBy: { id: "asc" },
          take,
        });
        if (guests.length === 0) {
          exhausted = true;
          break;
        }

        let outOfTime = false;
        for (const guest of guests) {
          if (Date.now() - started > budget) {
            outOfTime = true;
            break;
          }
          attempted += 1;
          let recipientId: string;
          try {
            const claim = await prisma.marketingCampaignRecipient.create({
              data: {
                orgId: campaign.orgId,
                campaignId: campaign.id,
                guestProfileId: guest.id,
                windowKey,
                status: "skipped",
                skipReason: "in_progress",
              },
              select: { id: true },
            });
            recipientId = claim.id;
          } catch (err) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002"
            ) {
              continue;
            }
            throw err;
          }

          try {
            const unsubscribeUrl = buildUnsubscribeUrl(campaign.orgId, guest.id);
            const rendered = renderCampaignForGuest({
              base,
              subject: campaign.subject,
              preheader: campaign.preheader,
              blocks,
              windowKey: campaign.scheduleKind === "monthly" ? windowKey : null,
              timezone: campaign.timezone,
              guestFirstName: guest.firstName,
              unsubscribeUrl,
            });
            const result = await sendPromotionalMarketingEmail({
              orgId: campaign.orgId,
              locationId: guest.locationId,
              guestProfileId: guest.id,
              kind: "newsletter",
              automationKey: `campaign:${campaign.id}:${windowKey}`,
              subject: rendered.subject,
              htmlBody: rendered.html,
              templateKey: `campaign:${campaign.id}`,
              replyTo: base.replyTo,
              fromName: base.fromName,
              listUnsubscribeUrl: unsubscribeUrl,
              metadata: { campaignId: campaign.id, windowKey },
            });
            await prisma.marketingCampaignRecipient.update({
              where: { id: recipientId },
              data: {
                status: result.status,
                skipReason: result.status === "sent" ? null : result.skipReason ?? null,
                sendLogId: result.logId,
              },
            });
            summary[result.status] += 1;
          } catch (err) {
            summary.failed += 1;
            await prisma.marketingCampaignRecipient
              .update({
                where: { id: recipientId },
                data: {
                  status: "failed",
                  skipReason: (err instanceof Error ? err.message : "send_error").slice(0, 200),
                },
              })
              .catch(() => undefined);
          }
        }
        if (outOfTime) break;
        if (guests.length < take) {
          exhausted = true;
          break;
        }
      }
    } catch (err) {
      console.error(
        `[marketing] campaign ${campaign.id} run failed:`,
        err instanceof Error ? err.message : err
      );
    }

    // Conditional on "sending" so a pause/archive made mid-run always wins.
    const stillSending = { id: campaign.id, status: "sending" as const };
    if (!exhausted) {
      await prisma.marketingCampaign.updateMany({
        where: stillSending,
        data: { nextRunAt: new Date() },
      });
      continue;
    }

    const finishedAt = new Date();
    const done =
      campaign.scheduleKind === "monthly"
        ? await (() => {
            const next = planNextMonthlyAfter(campaign, windowKey, finishedAt);
            return prisma.marketingCampaign.updateMany({
              where: stillSending,
              data: {
                status: "scheduled",
                nextRunAt: next.runAt,
                currentWindowKey: next.windowKey,
                lastCompletedAt: finishedAt,
              },
            });
          })()
        : await prisma.marketingCampaign.updateMany({
            where: stillSending,
            data: { status: "sent", nextRunAt: null, lastCompletedAt: finishedAt },
          });
    if (done.count > 0) summary.issuesCompleted += 1;
  }

  return summary;
}
