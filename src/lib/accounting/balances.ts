/**
 * AccountBalance rollup cache. Only journalEngine calls applyBalanceDelta;
 * rebuildBalances recomputes the cache from JournalLine.
 */
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { D, add, type Dec } from "@/lib/accounting/money";
import type { Db } from "@/lib/accounting/types";

export async function applyBalanceDelta(
  db: Db,
  orgId: string,
  periodId: string,
  lines: Array<{ ledgerAccountId: string; locationId: string | null; debit: Dec; credit: Dec }>,
  sign: 1 | -1 = 1
): Promise<void> {
  const grouped = new Map<string, { ledgerAccountId: string; locationKey: string; debit: Dec; credit: Dec }>();
  for (const l of lines) {
    const locationKey = l.locationId ?? "";
    const key = `${l.ledgerAccountId}|${locationKey}`;
    const g = grouped.get(key) ?? { ledgerAccountId: l.ledgerAccountId, locationKey, debit: D(0), credit: D(0) };
    g.debit = g.debit.add(l.debit);
    g.credit = g.credit.add(l.credit);
    grouped.set(key, g);
  }
  for (const g of grouped.values()) {
    const debit = sign === 1 ? g.debit : g.debit.neg();
    const credit = sign === 1 ? g.credit : g.credit.neg();
    await db.$executeRaw`
      INSERT INTO "account_balances" ("id", "orgId", "ledgerAccountId", "periodId", "locationKey", "debitTotal", "creditTotal", "updatedAt")
      VALUES (${randomUUID()}, ${orgId}, ${g.ledgerAccountId}, ${periodId}, ${g.locationKey}, ${debit.toFixed(2)}::numeric, ${credit.toFixed(2)}::numeric, NOW())
      ON CONFLICT ("orgId", "ledgerAccountId", "periodId", "locationKey")
      DO UPDATE SET
        "debitTotal" = "account_balances"."debitTotal" + EXCLUDED."debitTotal",
        "creditTotal" = "account_balances"."creditTotal" + EXCLUDED."creditTotal",
        "updatedAt" = NOW()
    `;
  }
}

/** Recompute AccountBalance for an org (optionally from one period onward). */
export async function rebuildBalances(
  orgId: string,
  opts: { fromPeriodId?: string } = {}
): Promise<{ periods: number; rows: number }> {
  let periodIds: string[] | null = null;
  if (opts.fromPeriodId) {
    const from = await prisma.accountingPeriod.findFirst({ where: { id: opts.fromPeriodId, orgId } });
    if (from) {
      const ps = await prisma.accountingPeriod.findMany({
        where: { orgId, startsOn: { gte: from.startsOn } },
        select: { id: true },
      });
      periodIds = ps.map((p) => p.id);
    }
  }
  const entries = await prisma.journalEntry.findMany({
    where: {
      orgId,
      status: { in: ["posted", "reversed"] },
      ...(periodIds ? { periodId: { in: periodIds } } : {}),
    },
    select: { periodId: true, lines: { select: { ledgerAccountId: true, locationId: true, debit: true, credit: true } } },
  });
  const totals = new Map<string, { periodId: string; ledgerAccountId: string; locationKey: string; debit: Dec; credit: Dec }>();
  for (const e of entries) {
    for (const l of e.lines) {
      const locationKey = l.locationId ?? "";
      const key = `${e.periodId}|${l.ledgerAccountId}|${locationKey}`;
      const t = totals.get(key) ?? { periodId: e.periodId, ledgerAccountId: l.ledgerAccountId, locationKey, debit: D(0), credit: D(0) };
      t.debit = add(t.debit, l.debit);
      t.credit = add(t.credit, l.credit);
      totals.set(key, t);
    }
  }
  await prisma.$transaction(
    async (tx) => {
      await tx.accountBalance.deleteMany({
        where: { orgId, ...(periodIds ? { periodId: { in: periodIds } } : {}) },
      });
      const rows = [...totals.values()];
      for (let i = 0; i < rows.length; i += 500) {
        await tx.accountBalance.createMany({
          data: rows.slice(i, i + 500).map((t) => ({
            orgId,
            periodId: t.periodId,
            ledgerAccountId: t.ledgerAccountId,
            locationKey: t.locationKey,
            debitTotal: t.debit,
            creditTotal: t.credit,
          })),
        });
      }
    },
    { timeout: 120_000 }
  );
  return { periods: new Set([...totals.values()].map((t) => t.periodId)).size, rows: totals.size };
}
