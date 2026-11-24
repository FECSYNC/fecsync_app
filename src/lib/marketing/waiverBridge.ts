import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";

function windowsFrom(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [14, 3];
  const days = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 365);
  return days.length ? [...new Set(days)].sort((a, b) => b - a) : [14, 3];
}

export async function readWaiverMarketingBridge(
  orgId: string,
  locationId?: string | null
): Promise<{ remindBeforeDays: number[]; sentLast30Days: number }> {
  const id = requireId(orgId, "orgId");
  let loc: string | null = locationId ?? null;

  const settings = await prisma.waiverSettings.findFirst({
    where: loc ? { orgId: id, locationId: loc } : { orgId: id, locationId: null },
    select: { remindBeforeDays: true },
  });
  const fallback = settings
    ? settings
    : await prisma.waiverSettings.findFirst({
        where: { orgId: id, locationId: null },
        select: { remindBeforeDays: true },
      });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sentLast30Days = await prisma.waiverReminderWatermark.count({
    where: { orgId: id, remindedAt: { gte: since } },
  });

  return {
    remindBeforeDays: windowsFrom(fallback?.remindBeforeDays),
    sentLast30Days,
  };
}
