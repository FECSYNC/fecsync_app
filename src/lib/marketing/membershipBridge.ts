import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";

export async function readMembershipMarketingBridge(
  orgId: string,
  locationId?: string | null
): Promise<{ dunningEnabled: boolean; pastDueCount: number }> {
  const id = requireId(orgId, "orgId");
  let loc: string | null = locationId ?? null;

  const settings = await prisma.membershipSettings.findFirst({
    where: loc ? { orgId: id, locationId: loc } : { orgId: id, locationId: null },
    select: { dunningEnabled: true },
  });
  const fallback = settings
    ? settings
    : await prisma.membershipSettings.findFirst({
        where: { orgId: id, locationId: null },
        select: { dunningEnabled: true },
      });

  const pastDueCount = await prisma.guestMembership.count({
    where: {
      orgId: id,
      status: "past_due",
      ...(loc ? { locationId: loc } : {}),
    },
  });

  return {
    dunningEnabled: fallback?.dunningEnabled ?? true,
    pastDueCount,
  };
}
