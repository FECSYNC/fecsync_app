/**
 * Inventory movements → COGS / wastage / adjustment / revaluation entries.
 * purchase_receipt and opening movements are posted by the purchasing and
 * opening-balance entries (not here) so stock value never posts twice.
 */
import { D, round2 } from "@/lib/accounting/money";
import { sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { cogsAccountFor, inventoryAccountFor } from "@/lib/accounting/posting/payables";
import { postFixed, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";

export async function postInventoryMovement(pc: PostingContext, movementId: string): Promise<PostingOutcome> {
  const m = await pc.db.inventoryMovement.findFirst({ where: { id: movementId, orgId: pc.orgId } });
  if (!m) return { skippedReason: "movement_not_found" };
  if (m.kind === "purchase_receipt" || m.kind === "opening" || m.kind === "supplier_return") {
    return { skippedReason: "posted_by_document" };
  }
  if (m.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  const value = round2(D(m.totalCost).abs());
  if (value.isZero()) {
    if (m.costMissing) pc.warnings.add("ACCT_COST_MISSING");
    return { skippedReason: "zero_cost", warningCode: postingWarning(pc) };
  }
  const ref = { posProductId: m.posProductId, shopProductId: m.shopProductId };
  const loc = m.locationId;
  const inv = await inventoryAccountFor(pc, ref, loc);
  let other: string;
  let invUp: boolean;
  switch (m.kind) {
    case "sale":
      other = await cogsAccountFor(pc, ref, loc);
      invUp = false;
      break;
    case "sale_return":
      other = await cogsAccountFor(pc, ref, loc);
      invUp = true;
      break;
    case "wastage":
      other = await sysAccount(pc, "inventory_wastage");
      invUp = false;
      break;
    case "adjustment_in":
      other = await sysAccount(pc, "inventory_wastage");
      invUp = true;
      break;
    case "adjustment_out":
      other = await sysAccount(pc, "inventory_wastage");
      invUp = false;
      break;
    case "revaluation":
      other = await sysAccount(pc, "cogs_default");
      invUp = D(m.totalCost).greaterThan(0);
      break;
    default:
      return { skippedReason: "unsupported_kind" };
  }
  const lines: TargetLine[] = [
    { ...ref, accountId: inv, locationId: loc, amount: invUp ? value : value.neg(), description: `Inventory ${m.kind}` },
    { ...ref, accountId: other, locationId: loc, amount: invUp ? value.neg() : value, description: `Inventory ${m.kind}` },
  ];
  if (m.costMissing) pc.warnings.add("ACCT_COST_MISSING");
  const entry = await postFixed(pc, {
    sourceType: "inventory_movement",
    sourceId: m.id,
    sourceEvent: m.kind,
    entryDate: m.createdAt,
    memo: `Inventory ${m.kind}${m.reason ? `: ${m.reason}` : ""}`,
    locationId: loc,
    lines,
  });
  if (entry) {
    await pc.db.inventoryMovement.update({ where: { id: m.id }, data: { journalEntryId: entry.id } });
  }
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}
