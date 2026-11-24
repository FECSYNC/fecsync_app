/**
 * AccountingSettings read/update with ledger locks.
 */
import type { AccountingSettings, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, toApiStringOrNull } from "@/lib/accounting/money";
import { isValidTimezone } from "@/lib/accounting/dates";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { until: number; value: AccountingSettings | null }>();

export function clearAccountingSettingsCache(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

export async function getAccountingSettings(
  orgId: string,
  db: Db = prisma
): Promise<AccountingSettings | null> {
  return db.accountingSettings.findUnique({ where: { orgId } });
}

/** Short cache for hot enqueue paths (sales, payments). */
export async function getAccountingSettingsCached(
  orgId: string
): Promise<AccountingSettings | null> {
  const now = Date.now();
  const hit = cache.get(orgId);
  if (hit && hit.until > now) return hit.value;
  const value = await prisma.accountingSettings.findUnique({ where: { orgId } });
  cache.set(orgId, { until: now + CACHE_TTL_MS, value });
  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
  }
  return value;
}

export async function requireAccountingSettings(
  orgId: string,
  db: Db = prisma
): Promise<AccountingSettings> {
  const s = await getAccountingSettings(orgId, db);
  if (!s || !s.enabled) throw acctError(ACCT.NOT_INITIALIZED);
  return s;
}

export function isPostingEnabled(
  settings: Pick<AccountingSettings, "enabled" | "goLiveDate"> | null,
  eventAt: Date
): boolean {
  if (!settings || !settings.enabled) return false;
  return eventAt.getTime() >= settings.goLiveDate.getTime();
}

function jsonIntArray(value: Prisma.JsonValue, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is number => typeof v === "number" && Number.isInteger(v));
}

export function reminderOffsets(s: AccountingSettings): number[] {
  return jsonIntArray(s.invoiceReminderOffsets, [-3, 0, 7, 14, 30]);
}

export function billReminderDays(s: AccountingSettings): number[] {
  return jsonIntArray(s.billReminderDaysBefore, [3, 1]);
}

export function toSettingsDto(s: AccountingSettings) {
  return {
    id: s.id,
    enabled: s.enabled,
    enabledAt: s.enabledAt?.toISOString() ?? null,
    baseCurrency: s.baseCurrency,
    timezone: s.timezone,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    goLiveDate: s.goLiveDate.toISOString(),
    bookingRevenueRecognition: s.bookingRevenueRecognition,
    membershipRecognition: s.membershipRecognition,
    requireApprovalForManualJournals: s.requireApprovalForManualJournals,
    manualJournalApprovalThreshold: toApiStringOrNull(s.manualJournalApprovalThreshold),
    expenseApprovalThreshold: toApiStringOrNull(s.expenseApprovalThreshold),
    billApprovalThreshold: toApiStringOrNull(s.billApprovalThreshold),
    supplierPaymentApprovalThreshold: toApiStringOrNull(s.supplierPaymentApprovalThreshold),
    allowSelfApproval: s.allowSelfApproval,
    receiptRequiredAbove: toApiStringOrNull(s.receiptRequiredAbove),
    defaultPaymentTermsDays: s.defaultPaymentTermsDays,
    invoiceReminderOffsets: reminderOffsets(s),
    billReminderDaysBefore: billReminderDays(s),
    postShopOrders: s.postShopOrders,
    postTailoringJobs: s.postTailoringJobs,
    giftCardBreakageOnExpiry: s.giftCardBreakageOnExpiry,
    allowNegativeStock: s.allowNegativeStock,
    statementFooter: s.statementFooter,
    openingBalanceVersion: s.openingBalanceVersion,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type AccountingSettingsDto = ReturnType<typeof toSettingsDto>;

const moneyField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v == null || v === "" ? null : D(String(v))))
  .refine((v) => v == null || v.greaterThanOrEqualTo(0), "Must be ≥ 0");

export const settingsPatchSchema = z
  .object({
    baseCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    timezone: z.string().min(1).max(64).optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    goLiveDate: z.string().min(10).optional(),
    bookingRevenueRecognition: z.enum(["on_confirm", "on_visit"]).optional(),
    membershipRecognition: z.enum(["on_payment", "over_term"]).optional(),
    requireApprovalForManualJournals: z.boolean().optional(),
    manualJournalApprovalThreshold: moneyField,
    expenseApprovalThreshold: moneyField,
    billApprovalThreshold: moneyField,
    supplierPaymentApprovalThreshold: moneyField,
    allowSelfApproval: z.boolean().optional(),
    receiptRequiredAbove: moneyField,
    defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
    invoiceReminderOffsets: z.array(z.number().int().min(-60).max(365)).max(12).optional(),
    billReminderDaysBefore: z.array(z.number().int().min(0).max(60)).max(8).optional(),
    postShopOrders: z.boolean().optional(),
    postTailoringJobs: z.boolean().optional(),
    giftCardBreakageOnExpiry: z.boolean().optional(),
    allowNegativeStock: z.boolean().optional(),
    statementFooter: z.string().max(1000).nullable().optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function updateAccountingSettings(ctx: AccountingCtx, patch: SettingsPatch) {
  const current = await requireAccountingSettings(ctx.orgId);
  const data: Prisma.AccountingSettingsUpdateInput = {};

  if (patch.baseCurrency && patch.baseCurrency !== current.baseCurrency) {
    const posted = await prisma.journalEntry.count({
      where: { orgId: ctx.orgId, status: { in: ["posted", "reversed"] } },
    });
    if (posted > 0) throw acctError(ACCT.BASE_CURRENCY_LOCKED);
    data.baseCurrency = patch.baseCurrency;
  }
  if (
    patch.fiscalYearStartMonth != null &&
    patch.fiscalYearStartMonth !== current.fiscalYearStartMonth
  ) {
    const closed = await prisma.accountingPeriod.count({
      where: { orgId: ctx.orgId, status: { in: ["closed", "locked"] } },
    });
    const anyEntries = await prisma.journalEntry.count({ where: { orgId: ctx.orgId } });
    if (closed > 0 || anyEntries > 0) throw acctError(ACCT.FISCAL_YEAR_LOCKED);
    data.fiscalYearStartMonth = patch.fiscalYearStartMonth;
  }
  if (patch.timezone && patch.timezone !== current.timezone) {
    if (!isValidTimezone(patch.timezone)) {
      throw acctError(ACCT.VALIDATION, { fields: { timezone: "Unknown timezone" } });
    }
    const anyEntries = await prisma.journalEntry.count({ where: { orgId: ctx.orgId } });
    if (anyEntries > 0) {
      throw acctError(ACCT.FISCAL_YEAR_LOCKED, {
        fields: { timezone: "Timezone is locked once journal entries exist" },
      });
    }
    data.timezone = patch.timezone;
  }
  if (patch.goLiveDate) {
    const next = new Date(patch.goLiveDate);
    if (Number.isNaN(next.getTime())) {
      throw acctError(ACCT.VALIDATION, { fields: { goLiveDate: "Invalid date" } });
    }
    if (next.getTime() !== current.goLiveDate.getTime()) {
      if (next.getTime() < current.goLiveDate.getTime()) throw acctError(ACCT.GO_LIVE_LOCKED);
      const before = await prisma.journalEntry.count({
        where: { orgId: ctx.orgId, kind: "system", entryDate: { lt: next } },
      });
      if (before > 0) throw acctError(ACCT.GO_LIVE_LOCKED);
      data.goLiveDate = next;
    }
  }

  const passthrough = [
    "bookingRevenueRecognition",
    "membershipRecognition",
    "requireApprovalForManualJournals",
    "allowSelfApproval",
    "defaultPaymentTermsDays",
    "postShopOrders",
    "postTailoringJobs",
    "giftCardBreakageOnExpiry",
    "allowNegativeStock",
    "statementFooter",
  ] as const;
  for (const key of passthrough) {
    if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key];
  }
  for (const key of [
    "manualJournalApprovalThreshold",
    "expenseApprovalThreshold",
    "billApprovalThreshold",
    "supplierPaymentApprovalThreshold",
    "receiptRequiredAbove",
  ] as const) {
    if (key in patch) (data as Record<string, unknown>)[key] = patch[key] ?? null;
  }
  if (patch.invoiceReminderOffsets) data.invoiceReminderOffsets = patch.invoiceReminderOffsets;
  if (patch.billReminderDaysBefore) data.billReminderDaysBefore = patch.billReminderDaysBefore;
  data.updatedById = ctx.actorId;

  const updated = await prisma.accountingSettings.update({
    where: { orgId: ctx.orgId },
    data,
  });
  clearAccountingSettingsCache(ctx.orgId);
  recordAccountingAudit(ctx, {
    action: "settings.update",
    entityType: "AccountingSettings",
    entityId: updated.id,
    description: "Accounting settings updated",
    before: toSettingsDto(current),
    after: toSettingsDto(updated),
  });
  return toSettingsDto(updated);
}
