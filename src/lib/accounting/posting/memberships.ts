/**
 * Guest membership payments. POS-sold memberships (attempt idempotency key
 * pos:* / pos-upgrade:*) are posted by the POS sale only.
 * Positive succeeded attempts: Dr clearing / Cr membership revenue (or
 * unearned with over_term). Negative attempts (applyCredit): Dr sales refunds,
 * Cr customer deposits for the guest (credit balance liability).
 */
import moment from "moment-timezone";
import { D, ZERO, fromMinor, round2 } from "@/lib/accounting/money";
import {
  mappedAccount,
  stripeClearingAccount,
  sysAccount,
  postingWarning,
  type PostingContext,
} from "@/lib/accounting/posting/context";
import { postFixed, reconcileToTarget, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";
import type { PartyRef } from "@/lib/accounting/types";

export function isPosMembershipAttempt(key: string | null): boolean {
  return Boolean(key && (key.startsWith("pos:") || key.startsWith("pos-")));
}

export async function postMembershipPayment(pc: PostingContext, attemptId: string): Promise<PostingOutcome> {
  const a = await pc.db.membershipPaymentAttempt.findFirst({
    where: { id: attemptId, orgId: pc.orgId },
    include: { guestMembership: { select: { id: true, locationId: true, guestProfileId: true, planId: true } } },
  });
  if (!a) return { skippedReason: "attempt_not_found" };
  if (a.status !== "succeeded") return { skippedReason: `status_${a.status}` };
  if (a.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  if (isPosMembershipAttempt(a.idempotencyKey)) return { skippedReason: "covered_by_pos_sale" };
  const loc = a.locationId ?? a.guestMembership.locationId;
  const party: PartyRef = { type: "guest", id: a.guestMembership.guestProfileId };
  const amount = round2(D(a.amount));
  if (amount.isZero()) return { skippedReason: "zero_amount" };
  const lines: TargetLine[] = [];
  if (amount.lessThan(0)) {
    const credit = amount.neg();
    lines.push({ accountId: await sysAccount(pc, "sales_refunds"), locationId: loc, amount: credit, description: "Membership credit" });
    lines.push({ accountId: await sysAccount(pc, "customer_deposits"), locationId: loc, party, amount: credit.neg(), description: "Membership credit balance" });
  } else {
    const clearing = a.connectedAccountId || a.stripeInvoiceId || a.stripePaymentIntentId
      ? await stripeClearingAccount(pc, a.connectedAccountId, loc)
      : await mappedAccount(pc, [], loc, "undeposited_funds");
    const revenue =
      pc.settings.membershipRecognition === "over_term"
        ? await sysAccount(pc, "membership_unearned")
        : await mappedAccount(pc, [{ kind: "membership_plan", matchKey: a.guestMembership.planId }], loc, "revenue_membership");
    lines.push({ accountId: clearing, locationId: loc, amount, description: "Membership payment" });
    lines.push({ accountId: revenue, locationId: loc, party, amount: amount.neg(), description: "Membership payment" });
    if (a.connectedAccountId && a.platformFeeMinor && a.platformFeeMinor > 0) {
      const fee = fromMinor(a.platformFeeMinor);
      lines.push({ accountId: await sysAccount(pc, "platform_fees"), locationId: loc, amount: fee, description: "Platform fee" });
      lines.push({ accountId: clearing, locationId: loc, amount: fee.neg(), description: "Platform fee" });
    }
  }
  const entry = await postFixed(pc, {
    sourceType: "membership_payment",
    sourceId: a.id,
    sourceEvent: "succeeded",
    entryDate: a.createdAt,
    memo: `Membership payment ${a.guestMembership.id}`,
    locationId: loc,
    lines,
  });
  if (pc.settings.membershipRecognition === "over_term" && amount.greaterThan(0)) {
    await recognizeMembershipRevenue(pc, a.guestMembership.id, new Date());
  }
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}

/**
 * over_term: move unearned → revenue in proportion to elapsed time of each
 * paid term (current period dates when present, else 1 month per payment).
 */
export async function recognizeMembershipRevenue(
  pc: PostingContext,
  guestMembershipId: string,
  upTo: Date
): Promise<PostingOutcome> {
  if (pc.settings.membershipRecognition !== "over_term") return { skippedReason: "policy_on_payment" };
  const m = await pc.db.guestMembership.findFirst({
    where: { id: guestMembershipId, orgId: pc.orgId },
    include: { plan: { select: { intervalCount: true, intervalUnit: true } } },
  });
  if (!m) return { skippedReason: "membership_not_found" };
  const attempts = await pc.db.membershipPaymentAttempt.findMany({
    where: { guestMembershipId: m.id, orgId: pc.orgId, status: "succeeded", createdAt: { gte: pc.settings.goLiveDate } },
    orderBy: { createdAt: "asc" },
  });
  const unearned = await sysAccount(pc, "membership_unearned");
  const revenue = await mappedAccount(pc, [{ kind: "membership_plan", matchKey: m.planId }], m.locationId, "revenue_membership");
  let earned = ZERO;
  for (const a of attempts) {
    if (isPosMembershipAttempt(a.idempotencyKey)) continue;
    const amount = round2(D(a.amount));
    if (!amount.greaterThan(0)) continue;
    const start = a.createdAt;
    const unit = (m.plan.intervalUnit ?? "month") as moment.unitOfTime.DurationConstructor;
    const end = moment(start).add(m.plan.intervalCount ?? 1, unit).toDate();
    const span = end.getTime() - start.getTime();
    const elapsed = Math.min(Math.max(upTo.getTime() - start.getTime(), 0), span);
    const fraction = span > 0 ? D(elapsed).div(span) : D(1);
    earned = earned.add(round2(amount.mul(fraction)));
  }
  const target: TargetLine[] = earned.isZero()
    ? []
    : [
        { accountId: unearned, locationId: m.locationId, amount: earned, description: "Membership revenue recognized" },
        { accountId: revenue, locationId: m.locationId, amount: earned.neg(), description: "Membership revenue recognized" },
      ];
  const entry = await reconcileToTarget(pc, {
    sourceType: "revenue_recognition",
    sourceId: m.id,
    eventPrefix: "membership",
    entryDate: upTo,
    memo: `Membership revenue recognition ${m.customMembershipId}`,
    locationId: m.locationId,
    target,
  });
  return entry ? { journalEntryId: entry.id } : { skippedReason: "no_change" };
}
