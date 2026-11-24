/**
 * One-transaction accounting setup: settings, chart, mappings, tax codes,
 * expense categories, bank accounts, periods. Idempotent.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { seedChart } from "@/lib/accounting/accounts";
import { seedDefaultMappings } from "@/lib/accounting/mappings";
import { syncFromTaxSettings } from "@/lib/accounting/taxCodes";
import { seedExpenseCategories } from "@/lib/accounting/expenses/expenseCategories";
import { setupDefaultBankAccounts } from "@/lib/accounting/banking/bankAccounts";
import { ensurePeriodsCover } from "@/lib/accounting/periods";
import { clearAccountingSettingsCache, toSettingsDto } from "@/lib/accounting/settings";
import { isValidTimezone, localDayStart } from "@/lib/accounting/dates";
import type { AccountingCtx } from "@/lib/accounting/types";

export const setupSchema = z
  .object({
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    goLiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(64).optional(),
    template: z.literal("fec_default").default("fec_default"),
    importHistory: z.boolean().optional(),
  })
  .strict();

export async function defaultTimezone(orgId: string): Promise<string> {
  const venue = await prisma.venueLocation.findFirst({
    where: { orgId, status: "active", timezone: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { timezone: true },
  });
  return venue?.timezone && isValidTimezone(venue.timezone) ? venue.timezone : "UTC";
}

export async function defaultBaseCurrency(orgId: string): Promise<string> {
  const profile = await prisma.companyProfile.findUnique({ where: { orgId }, select: { bankCurrency: true } });
  const fromProfile = profile?.bankCurrency?.trim().toUpperCase();
  if (fromProfile && /^[A-Z]{3}$/.test(fromProfile)) return fromProfile;
  const env = process.env.ACCOUNTING_DEFAULT_BASE_CURRENCY?.trim().toUpperCase();
  return env && /^[A-Z]{3}$/.test(env) ? env : "USD";
}

export async function setupAccounting(ctx: AccountingCtx, raw: unknown) {
  const input = setupSchema.parse(raw);
  const org = await prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { isDefault: true } });
  if (!org || org.isDefault) throw acctError(ACCT.NOT_FOUND);
  const existing = await prisma.accountingSettings.findUnique({ where: { orgId: ctx.orgId } });
  if (existing?.enabled) {
    return { alreadyInitialized: true, settings: toSettingsDto(existing) };
  }
  const timezone = input.timezone ?? (await defaultTimezone(ctx.orgId));
  if (!isValidTimezone(timezone)) throw acctError(ACCT.VALIDATION, { fields: { timezone: "Unknown timezone" } });
  const goLiveDate = localDayStart(input.goLiveDate, timezone);
  const settings = await prisma.$transaction(
    async (tx) => {
      const s = existing
        ? await tx.accountingSettings.update({
            where: { orgId: ctx.orgId },
            data: {
              enabled: true,
              enabledAt: new Date(),
              baseCurrency: input.baseCurrency,
              fiscalYearStartMonth: input.fiscalYearStartMonth,
              goLiveDate,
              timezone,
              updatedById: ctx.actorId,
            },
          })
        : await tx.accountingSettings.create({
            data: {
              orgId: ctx.orgId,
              enabled: true,
              enabledAt: new Date(),
              baseCurrency: input.baseCurrency,
              fiscalYearStartMonth: input.fiscalYearStartMonth,
              goLiveDate,
              timezone,
              createdById: ctx.actorId,
              updatedById: ctx.actorId,
            },
          });
      await seedChart(tx, ctx.orgId);
      await seedDefaultMappings(tx, ctx.orgId);
      await syncFromTaxSettings(tx, ctx.orgId);
      await seedExpenseCategories(tx, ctx.orgId);
      await setupDefaultBankAccounts(tx, ctx.orgId, input.baseCurrency);
      await ensurePeriodsCover(tx, s, new Date(goLiveDate.getTime() - 1));
      await ensurePeriodsCover(tx, s, goLiveDate);
      await ensurePeriodsCover(tx, s, new Date());
      return s;
    },
    { timeout: 120_000 }
  );
  clearAccountingSettingsCache(ctx.orgId);
  recordAccountingAudit(ctx, {
    action: "setup",
    entityType: "AccountingSettings",
    entityId: settings.id,
    description: "Accounting initialized",
    after: toSettingsDto(settings),
  });
  let history: { enqueued: Record<string, number>; processed: number } | null = null;
  if (input.importHistory) {
    const { backfillOrgHistory } = await import("@/lib/accounting/backfill");
    history = await backfillOrgHistory(ctx.orgId, { inlineLimit: 500 });
  }
  return { alreadyInitialized: false, settings: toSettingsDto(settings), history };
}
