/**
 * Reconcile-to-target: posts only the difference between a source document's
 * target ledger state and what is already posted for (sourceType, sourceId).
 * Re-running with the same state posts nothing.
 */
import { createHash } from "crypto";
import type { AccountingSourceType, JournalEntry } from "@prisma/client";
import { postJournal, type JournalLineInput } from "@/lib/accounting/journalEngine";
import { D, ZERO, round2, type Dec } from "@/lib/accounting/money";
import { formatPartyKey, partyKeyFromLine } from "@/lib/accounting/partyKeys";
import { sysAccount, type PostingContext } from "@/lib/accounting/posting/context";
import type { PartyRef } from "@/lib/accounting/types";

export type TargetLine = Omit<JournalLineInput, "amount" | "debit" | "credit"> & { amount: Dec };

function keyOf(accountId: string, locationId: string | null | undefined, party: PartyRef | null | undefined) {
  return `${accountId}|${locationId ?? ""}|${formatPartyKey(party ?? null) ?? ""}`;
}

/** Merge same-key lines; drop zeros. */
export function compactTarget(lines: TargetLine[]): Map<string, TargetLine> {
  const out = new Map<string, TargetLine>();
  for (const l of lines) {
    const amt = round2(D(l.amount));
    if (amt.isZero()) continue;
    const k = keyOf(l.accountId, l.locationId, l.party);
    const cur = out.get(k);
    if (cur) out.set(k, { ...cur, amount: cur.amount.add(amt) });
    else out.set(k, { ...l, amount: amt });
  }
  return out;
}

/**
 * Balance a target that should sum to zero. Small residues (≤ 0.05) go to
 * rounding; larger ones go to suspense with a warning.
 */
export async function balanceTarget(
  pc: PostingContext,
  lines: TargetLine[],
  locationId: string | null,
  refs: Partial<TargetLine> = {}
): Promise<TargetLine[]> {
  const sum = lines.reduce((a, l) => a.add(round2(D(l.amount))), ZERO);
  if (sum.isZero()) return lines;
  const small = sum.abs().lessThanOrEqualTo(D("0.05"));
  if (!small) pc.warnings.add("ACCT_TARGET_UNBALANCED");
  const accountId = await sysAccount(pc, small ? "rounding" : "suspense");
  return [...lines, { ...refs, accountId, locationId, amount: sum.neg(), description: small ? "Rounding" : "Unbalanced source — review" }];
}

export async function reconcileToTarget(
  pc: PostingContext,
  opts: {
    sourceType: AccountingSourceType;
    sourceId: string;
    eventPrefix: string;
    entryDate: Date;
    memo: string;
    locationId: string | null;
    target: TargetLine[];
    refs?: Partial<TargetLine>;
  }
): Promise<JournalEntry | null> {
  const target = compactTarget(await balanceTarget(pc, opts.target, opts.locationId, opts.refs));
  const posted = await pc.db.journalLine.findMany({
    where: {
      orgId: pc.orgId,
      entry: {
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
        status: { in: ["posted", "reversed"] },
        sourceEvent: { startsWith: opts.eventPrefix },
      },
    },
    select: {
      ledgerAccountId: true,
      locationId: true,
      debit: true,
      credit: true,
      guestProfileId: true,
      bookingAccountId: true,
      customerUserId: true,
      supplierId: true,
      employeeUserId: true,
    },
  });
  const postedByKey = new Map<string, { amount: Dec; line: (typeof posted)[number] }>();
  for (const l of posted) {
    const party = partyKeyFromLine(l);
    const k = keyOf(l.ledgerAccountId, l.locationId, party);
    const cur = postedByKey.get(k);
    const amt = D(l.debit).sub(D(l.credit));
    postedByKey.set(k, { amount: (cur?.amount ?? ZERO).add(amt), line: l });
  }
  const deltas: JournalLineInput[] = [];
  const keys = new Set([...target.keys(), ...postedByKey.keys()]);
  for (const k of keys) {
    const t = target.get(k);
    const p = postedByKey.get(k);
    const delta = (t?.amount ?? ZERO).sub(p?.amount ?? ZERO);
    if (round2(delta).isZero()) continue;
    if (t) {
      deltas.push({ ...opts.refs, ...t, amount: delta });
    } else if (p) {
      deltas.push({
        ...opts.refs,
        accountId: p.line.ledgerAccountId,
        locationId: p.line.locationId,
        party: partyKeyFromLine(p.line),
        amount: delta,
        description: "Adjustment to source state",
      });
    }
  }
  if (deltas.length < 2) return null;
  const sequence = await pc.db.journalEntry.count({
    where: {
      orgId: pc.orgId,
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      sourceEvent: { startsWith: opts.eventPrefix },
    },
  });
  const hash = createHash("sha1")
    .update(deltas.map((d) => `${d.accountId}:${d.locationId ?? ""}:${D(d.amount ?? 0).toFixed(2)}`).join("|"))
    .digest("hex")
    .slice(0, 12);
  return postJournal(pc.db, {
    orgId: pc.orgId,
    kind: "system",
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    sourceEvent: `${opts.eventPrefix}:${sequence + 1}`,
    idempotencyKey: `${opts.sourceType}:${opts.sourceId}:${opts.eventPrefix}:${sequence + 1}:${hash}`,
    entryDate: opts.entryDate,
    memo: opts.memo,
    locationId: opts.locationId,
    lines: deltas,
  });
}

/** One-shot fixed entry (receipts, fees, refunds) keyed by idempotency. */
export async function postFixed(
  pc: PostingContext,
  opts: {
    sourceType: AccountingSourceType;
    sourceId: string;
    sourceEvent: string;
    entryDate: Date;
    memo: string;
    locationId: string | null;
    lines: TargetLine[];
    refs?: Partial<TargetLine>;
  }
): Promise<JournalEntry | null> {
  const balanced = await balanceTarget(pc, opts.lines, opts.locationId, opts.refs);
  const compact = [...compactTarget(balanced).values()];
  if (compact.length < 2) return null;
  return postJournal(pc.db, {
    orgId: pc.orgId,
    kind: "system",
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    sourceEvent: opts.sourceEvent,
    idempotencyKey: `${opts.sourceType}:${opts.sourceId}:${opts.sourceEvent}`,
    entryDate: opts.entryDate,
    memo: opts.memo,
    locationId: opts.locationId,
    lines: compact.map((l) => ({ ...opts.refs, ...l })),
  });
}
