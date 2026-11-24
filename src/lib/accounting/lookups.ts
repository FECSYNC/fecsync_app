/**
 * Picker lookups for accounting setup / document screens.
 */
import prisma from "@/lib/prisma";
import { getAccountingSettingsCached, toSettingsDto } from "@/lib/accounting/settings";
import { defaultBaseCurrency, defaultTimezone } from "@/lib/accounting/setup";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function accountingLookups(ctx: AccountingCtx) {
  const settings = await getAccountingSettingsCached(ctx.orgId);
  const locationWhere = ctx.scope.allLocations
    ? { orgId: ctx.orgId, status: "active" as const }
    : { orgId: ctx.orgId, status: "active" as const, id: { in: ctx.scope.locationIds } };

  const [venues, members, baseCurrency, timezone] = await Promise.all([
    prisma.venueLocation.findMany({
      where: locationWhere,
      select: { id: true, name: true, slug: true, timezone: true, isFranchise: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.membership.findMany({
      where: { orgId: ctx.orgId, status: "active" },
      select: {
        userId: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      take: 500,
      orderBy: { createdAt: "asc" },
    }),
    settings ? Promise.resolve(settings.baseCurrency) : defaultBaseCurrency(ctx.orgId),
    settings ? Promise.resolve(settings.timezone) : defaultTimezone(ctx.orgId),
  ]);

  return {
    initialized: Boolean(settings?.enabled),
    baseCurrency,
    timezone,
    settings: settings ? toSettingsDto(settings) : null,
    venues,
    teamMembers: members.map((m) => ({
      userId: m.userId,
      name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ").trim() || m.user.email,
      email: m.user.email,
    })),
  };
}
