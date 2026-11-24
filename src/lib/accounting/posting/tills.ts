/**
 * Till cash movements and close variance.
 * sale_cash / refund_cash post nothing (the sale or refund entry carries them).
 */
import { D, round2 } from "@/lib/accounting/money";
import { mappedAccount, sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, reconcileToTarget, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";

async function tillCash(pc: PostingContext, locationId: string) {
  return mappedAccount(pc, [], locationId, "till_cash");
}

export async function postTillMovement(pc: PostingContext, movementId: string): Promise<PostingOutcome> {
  const m = await pc.db.tillMovement.findFirst({
    where: { id: movementId, orgId: pc.orgId },
    include: { session: { select: { locationId: true, id: true } } },
  });
  if (!m) return { skippedReason: "movement_not_found" };
  if (m.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  if (m.kind === "sale_cash" || m.kind === "refund_cash") return { skippedReason: "covered_by_sale" };
  const amount = round2(D(m.amount).abs());
  if (amount.isZero()) return { skippedReason: "zero_amount" };
  const loc = m.session.locationId;
  const till = await tillCash(pc, loc);
  const cashOnHand = await mappedAccount(pc, [], loc, "cash_on_hand");
  let lines: TargetLine[];
  switch (m.kind) {
    case "open_float":
    case "cash_in":
      lines = [
        { accountId: till, locationId: loc, amount, description: m.kind },
        { accountId: cashOnHand, locationId: loc, amount: amount.neg(), description: m.kind },
      ];
      break;
    case "cash_out":
    case "drop":
    case "pickup":
      lines = [
        { accountId: cashOnHand, locationId: loc, amount, description: m.kind },
        { accountId: till, locationId: loc, amount: amount.neg(), description: m.kind },
      ];
      break;
    case "tip":
      lines = [
        { accountId: await sysAccount(pc, "tips_payable"), locationId: loc, amount, description: "Tip payout" },
        { accountId: till, locationId: loc, amount: amount.neg(), description: "Tip payout" },
      ];
      break;
    default:
      return { skippedReason: "manual_journal_required" };
  }
  const entry = await postFixed(pc, {
    sourceType: "till_movement",
    sourceId: m.id,
    sourceEvent: m.kind,
    entryDate: m.createdAt,
    memo: `Till ${m.kind}${m.reason ? `: ${m.reason}` : ""}`,
    locationId: loc,
    lines,
  });
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}

/** Variance at close; edits after close post only the delta. */
export async function postTillClose(pc: PostingContext, sessionId: string, eventAt: Date): Promise<PostingOutcome> {
  const s = await pc.db.tillSession.findFirst({ where: { id: sessionId, orgId: pc.orgId } });
  if (!s) return { skippedReason: "till_not_found" };
  if (s.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  const loc = s.locationId;
  const target: TargetLine[] = [];
  if ((s.status === "closed" || s.status === "counting") && s.variance != null) {
    const variance = round2(D(s.variance));
    if (!variance.isZero()) {
      const till = await tillCash(pc, loc);
      const overShort = await sysAccount(pc, "cash_over_short");
      // variance = counted − expected: positive = overage (more cash than expected).
      target.push({ accountId: till, locationId: loc, amount: variance, description: "Till variance" });
      target.push({ accountId: overShort, locationId: loc, amount: variance.neg(), description: "Till variance" });
    }
  }
  const entry = await reconcileToTarget(pc, {
    sourceType: "till_close",
    sourceId: s.id,
    eventPrefix: "variance",
    entryDate: s.closedAt ?? eventAt,
    memo: "Till close variance",
    locationId: loc,
    target,
  });
  return entry ? { journalEntryId: entry.id, warningCode: postingWarning(pc) } : { skippedReason: "no_change" };
}
