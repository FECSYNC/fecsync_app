/**
 * Tailoring job payments (Dr gateway clearing or undeposited funds /
 * Cr tailoring revenue + tax). Only when settings.postTailoringJobs.
 */
import { fromFloatBoundary, round2 } from "@/lib/accounting/money";
import { mappedAccount, sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { reconcileToTarget, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";

export async function syncTailoringJob(pc: PostingContext, jobId: string, eventAt: Date): Promise<PostingOutcome> {
  if (!pc.settings.postTailoringJobs) return { skippedReason: "tailoring_posting_disabled" };
  const job = await pc.db.tailoringJob.findFirst({
    where: { id: jobId, orgId: pc.orgId },
    include: { org: { select: { isDefault: true } } },
  });
  if (!job) return { skippedReason: "job_not_found" };
  if (job.org.isDefault) return { skippedReason: "storefront_org" };
  if (!job.paidAt) return { skippedReason: "not_paid" };
  if (job.paidAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  const total = round2(fromFloatBoundary(job.amount ?? job.quotedPrice ?? 0));
  if (total.isZero()) return { skippedReason: "zero_amount" };
  const tax = round2(fromFloatBoundary(job.taxAmount ?? 0));
  const provider = (job.paymentProvider ?? "").toLowerCase();
  const clearing =
    provider === "stripe"
      ? await sysAccount(pc, "stripe_clearing")
      : provider === "paystack"
        ? await sysAccount(pc, "paystack_clearing")
        : provider === "wallet"
          ? await sysAccount(pc, "platform_wallet_clearing")
          : await mappedAccount(pc, [], null, "undeposited_funds");
  const party = { type: "user" as const, id: job.customerId };
  const target: TargetLine[] = [
    { accountId: clearing, locationId: null, amount: total, description: `Tailoring job ${job.title}` },
    { accountId: await sysAccount(pc, "revenue_tailoring"), locationId: null, party, amount: total.sub(tax).neg(), description: "Tailoring services" },
  ];
  if (!tax.isZero()) target.push({ accountId: await sysAccount(pc, "sales_tax_payable"), locationId: null, amount: tax.neg(), description: "Sales tax" });
  const entry = await reconcileToTarget(pc, {
    sourceType: "tailoring_payment",
    sourceId: job.id,
    eventPrefix: "paid",
    entryDate: job.paidAt ?? eventAt,
    memo: `Tailoring job ${job.title}`,
    locationId: null,
    target,
  });
  return entry ? { journalEntryId: entry.id, warningCode: postingWarning(pc) } : { skippedReason: "no_change" };
}
