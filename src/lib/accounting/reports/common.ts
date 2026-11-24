/**
 * Shared report plumbing: filters, ranges, comparison windows, meta, account maps.
 */
import type { LedgerAccount } from "@prisma/client";
import moment from "moment-timezone";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { localDayEnd, localDayStart, parseYmdOrNull } from "@/lib/accounting/dates";
import { fiscalYearBounds, fiscalYearForDate } from "@/lib/accounting/periods";
import { narrowScopeMany } from "@/lib/accounting/scope";
import { ZERO, toApiString, type Dec } from "@/lib/accounting/money";
import { normalBalance } from "@/lib/accounting/chartTemplate";
import type { AccountingCtx, ScopeFilter } from "@/lib/accounting/types";

export type CompareMode = "none" | "previous_period" | "previous_year";
export type ColumnMode = "none" | "location" | "month";

export type ReportQuery = {
  from: Date;
  to: Date;
  asOf: Date;
  scope: ScopeFilter;
  locationIds: string[];
  compare: CompareMode;
  columns: ColumnMode;
  accountId: string | null;
  partyKey: string | null;
  limit: number;
};

const FIVE_YEARS_MS = 5 * 366 * 86_400_000;

export async function parseReportQuery(ctx: AccountingCtx, sp: URLSearchParams): Promise<ReportQuery> {
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const tz = settings.timezone;
  const now = new Date();
  const fy = fiscalYearBounds(fiscalYearForDate(now, settings), settings);
  const fromYmd = parseYmdOrNull(sp.get("from"));
  const toYmd = parseYmdOrNull(sp.get("to"));
  const asOfYmd = parseYmdOrNull(sp.get("asOf"));
  const from = fromYmd ? localDayStart(fromYmd, tz) : fy.start;
  const to = toYmd ? localDayEnd(toYmd, tz) : now;
  const asOf = asOfYmd ? localDayEnd(asOfYmd, tz) : toYmd ? to : now;
  if (from > to) throw acctError(ACCT.DATE_RANGE_INVALID, { message: "from is after to" });
  if (to.getTime() - from.getTime() > FIVE_YEARS_MS) throw acctError(ACCT.DATE_RANGE_INVALID, { message: "Range is longer than 5 years" });
  const locationIds = [...sp.getAll("locationId"), ...(sp.get("locationIds")?.split(",") ?? [])].map((s) => s.trim()).filter(Boolean);
  const compare = (["none", "previous_period", "previous_year"].includes(sp.get("compare") ?? "") ? sp.get("compare") : "none") as CompareMode;
  const columns = (["none", "location", "month"].includes(sp.get("columns") ?? "") ? sp.get("columns") : "none") as ColumnMode;
  return {
    from,
    to,
    asOf,
    scope: narrowScopeMany(ctx.scope, locationIds),
    locationIds,
    compare,
    columns,
    accountId: sp.get("accountId"),
    partyKey: sp.get("partyKey"),
    limit: Math.min(Math.max(Number(sp.get("limit") ?? 2000) || 2000, 1), 20000),
  };
}

export function compareWindow(q: ReportQuery): { from: Date; to: Date } | null {
  if (q.compare === "none") return null;
  if (q.compare === "previous_year") {
    return {
      from: moment(q.from).subtract(1, "year").toDate(),
      to: moment(q.to).subtract(1, "year").toDate(),
    };
  }
  const span = q.to.getTime() - q.from.getTime();
  return { from: new Date(q.from.getTime() - span - 1), to: new Date(q.from.getTime() - 1) };
}

export async function reportMeta(ctx: AccountingCtx, q: ReportQuery, title: string) {
  const [org, settings, venues] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } }),
    prisma.accountingSettings.findUnique({ where: { orgId: ctx.orgId }, select: { baseCurrency: true, timezone: true } }),
    q.locationIds.length
      ? prisma.venueLocation.findMany({ where: { orgId: ctx.orgId, id: { in: q.locationIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    title,
    orgName: org?.name ?? "",
    currency: settings?.baseCurrency ?? "USD",
    timezone: settings?.timezone ?? "UTC",
    generatedAt: new Date().toISOString(),
    basis: "accrual" as const,
    filters: {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      asOf: q.asOf.toISOString(),
      locations: venues,
      compare: q.compare,
      columns: q.columns,
      parkScoped: !q.scope.allLocations,
    },
  };
}

export async function loadAccounts(orgId: string): Promise<Map<string, LedgerAccount>> {
  const rows = await prisma.ledgerAccount.findMany({ where: { orgId }, orderBy: { code: "asc" } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Natural-sign amount: revenue/liability/equity credit-positive, assets/expenses debit-positive. */
export function natural(account: Pick<LedgerAccount, "type" | "subtype">, debit: Dec, credit: Dec): Dec {
  return normalBalance(account.type, account.subtype) === "debit" ? debit.sub(credit) : credit.sub(debit);
}

export type ReportRow = {
  accountId: string;
  code: string;
  name: string;
  parentId: string | null;
  amount: string;
  compareAmount?: string | null;
  columns?: Record<string, string>;
};

export function sumRows(rows: Array<{ amount: Dec }>): Dec {
  return rows.reduce((a, r) => a.add(r.amount), ZERO);
}

export function money(v: Dec): string {
  return toApiString(v);
}

export function monthKeys(from: Date, to: Date, tz: string): Array<{ key: string; from: Date; to: Date }> {
  const out: Array<{ key: string; from: Date; to: Date }> = [];
  let cursor = moment(from).tz(tz).startOf("month");
  let guard = 0;
  while (cursor.toDate() <= to && guard++ < 72) {
    const start = cursor.toDate() < from ? from : cursor.toDate();
    const endM = cursor.clone().endOf("month").toDate();
    out.push({ key: cursor.format("YYYY-MM"), from: start, to: endM > to ? to : endM });
    cursor = cursor.add(1, "month").startOf("month");
  }
  return out;
}
