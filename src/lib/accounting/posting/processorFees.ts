/**
 * Stripe processing fees from balance transactions (Dr payment fees /
 * Cr the charge's clearing account). The webhook enqueues the fee snapshot;
 * Stripe is the source of truth for the amount, so the payload carries it.
 */
import { fromMinor } from "@/lib/accounting/money";
import { stripeClearingAccount, sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";

export async function postProcessorFee(
  pc: PostingContext,
  balanceTransactionId: string,
  payload: Record<string, unknown>,
  eventAt: Date
): Promise<PostingOutcome> {
  const feeMinor = typeof payload.feeMinor === "number" ? payload.feeMinor : 0;
  if (!(feeMinor > 0)) return { skippedReason: "no_fee" };
  const locationId = typeof payload.locationId === "string" ? payload.locationId : null;
  const connected = typeof payload.connectedAccountId === "string" ? payload.connectedAccountId : null;
  const fee = fromMinor(feeMinor);
  const clearing = await stripeClearingAccount(pc, connected, locationId);
  const entry = await postFixed(pc, {
    sourceType: "processor_fee",
    sourceId: balanceTransactionId,
    sourceEvent: "fee",
    entryDate: eventAt,
    memo: `Stripe fee ${typeof payload.description === "string" ? payload.description : ""}`.trim(),
    locationId,
    lines: [
      { accountId: await sysAccount(pc, "payment_fees"), locationId, amount: fee, description: "Stripe processing fee" },
      { accountId: clearing, locationId, amount: fee.neg(), description: "Stripe processing fee" },
    ],
  });
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}
