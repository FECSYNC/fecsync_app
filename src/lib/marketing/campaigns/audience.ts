import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  DEFAULT_CAMPAIGN_AUDIENCE,
  type CampaignAudience,
} from "@/lib/marketing/campaigns/types";

export function normalizeCampaignAudience(raw: unknown): CampaignAudience {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CAMPAIGN_AUDIENCE };
  const a = raw as Record<string, unknown>;
  const days = Number(a.visitedWithinDays);
  return {
    source: a.source === "newsletter" ? "newsletter" : "all_opted_in",
    visitedWithinDays:
      a.visitedWithinDays == null || a.visitedWithinDays === "" || !Number.isFinite(days)
        ? null
        : Math.max(1, Math.min(Math.trunc(days), 3650)),
    activeMembersOnly: a.activeMembersOnly === true,
  };
}

/**
 * Same consent gate as lifecycle automations (opted in, not banned, has email),
 * narrowed by campaign park + audience filters.
 */
export function campaignAudienceWhere(input: {
  orgId: string;
  locationId: string | null;
  audience: CampaignAudience;
  now?: Date;
}): Prisma.GuestProfileWhereInput {
  const now = input.now ?? new Date();
  const where: Prisma.GuestProfileWhereInput = {
    orgId: input.orgId,
    marketingEmailOptIn: true,
    bannedAt: null,
    email: { not: null },
    ...(input.locationId ? { locationId: input.locationId } : {}),
  };
  const and: Prisma.GuestProfileWhereInput[] = [{ NOT: { email: "" } }];
  if (input.audience.source === "newsletter") {
    and.push({ newsletterSubscribedAt: { not: null } });
  }
  if (input.audience.visitedWithinDays) {
    and.push({
      lastVisitAt: {
        gte: new Date(now.getTime() - input.audience.visitedWithinDays * 86_400_000),
      },
    });
  }
  if (input.audience.activeMembersOnly) {
    and.push({
      guestMemberships: {
        some: { orgId: input.orgId, status: "active" },
      },
    });
  }
  where.AND = and;
  return where;
}

export async function countCampaignAudience(input: {
  orgId: string;
  locationId: string | null;
  audience: CampaignAudience;
}): Promise<number> {
  return prisma.guestProfile.count({ where: campaignAudienceWhere(input) });
}
