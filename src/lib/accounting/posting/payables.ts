/**
 * Purchasing: PO receipts (Dr inventory / Cr GRNI), supplier bills
 * (Dr GRNI | inventory | expense, Dr input tax / Cr AP), supplier payments
 * (Dr AP / Cr bank). Credit-note bills reverse sides.
 */
import type { JournalEntry } from "@prisma/client";
import { D, ZERO, round2, type Dec } from "@/lib/accounting/money";
import { mappedAccount, sysAccount, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PartyRef } from "@/lib/accounting/types";

export async function inventoryAccountFor(
  pc: PostingContext,
  ref: { posProductId?: string | null; shopProductId?: string | null },
  locationId: string | null
): Promise<string> {
  if (ref.posProductId) {
    const p = await pc.db.posProduct.findFirst({
      where: { id: ref.posProductId, orgId: pc.orgId },
      select: { inventoryAccountId: true },
    });
    if (p?.inventoryAccountId) return p.inventoryAccountId;
  }
  return mappedAccount(pc, [], locationId, "inventory_default");
}

export async function cogsAccountFor(
  pc: PostingContext,
  ref: { posProductId?: string | null; shopProductId?: string | null },
  locationId: string | null
): Promise<string> {
  if (ref.posProductId) {
    const p = await pc.db.posProduct.findFirst({
      where: { id: ref.posProductId, orgId: pc.orgId },
      select: { cogsAccountId: true, kind: true },
    });
    if (p?.cogsAccountId) return p.cogsAccountId;
  }
  return mappedAccount(pc, [], locationId, "cogs_default");
}

export async function postPurchaseReceipt(
  pc: PostingContext,
  opts: {
    purchaseOrderId: string;
    receiptKey: string;
    supplierId: string;
    locationId: string;
    date: Date;
    number: string;
    lines: Array<{ posProductId?: string | null; shopProductId?: string | null; ledgerAccountId?: string | null; value: Dec; description: string }>;
  }
): Promise<JournalEntry | null> {
  const party: PartyRef = { type: "supplier", id: opts.supplierId };
  const grni = await sysAccount(pc, "goods_received_not_invoiced");
  const target: TargetLine[] = [];
  let total = ZERO;
  for (const l of opts.lines) {
    const value = round2(l.value);
    if (value.isZero()) continue;
    const debit =
      l.posProductId || l.shopProductId
        ? await inventoryAccountFor(pc, l, opts.locationId)
        : l.ledgerAccountId ?? (await sysAccount(pc, "suspense"));
    target.push({ accountId: debit, locationId: opts.locationId, amount: value, description: l.description, posProductId: l.posProductId, shopProductId: l.shopProductId });
    total = total.add(value);
  }
  if (total.isZero()) return null;
  target.push({ accountId: grni, locationId: opts.locationId, party, amount: total.neg(), description: `Goods received ${opts.number}` });
  return postFixed(pc, {
    sourceType: "purchase_receipt",
    sourceId: opts.purchaseOrderId,
    sourceEvent: `receive:${opts.receiptKey}`,
    entryDate: opts.date,
    memo: `Goods received on ${opts.number}`,
    locationId: opts.locationId,
    lines: target,
  });
}

export async function postSupplierBill(pc: PostingContext, billId: string): Promise<JournalEntry | null> {
  const bill = await pc.db.supplierBill.findFirst({
    where: { id: billId, orgId: pc.orgId },
    include: { lines: { include: { purchaseOrderLine: true } } },
  });
  if (!bill) return null;
  const sign = bill.kind === "credit_note" ? -1 : 1;
  const party: PartyRef = { type: "supplier", id: bill.supplierId };
  const loc = bill.locationId;
  const refs = { supplierBillId: bill.id };
  const target: TargetLine[] = [];
  const grni = await sysAccount(pc, "goods_received_not_invoiced");
  const inputTaxDefault = await sysAccount(pc, "input_tax");
  const taxCodeIds = [...new Set(bill.lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x)))];
  const taxCodes = taxCodeIds.length ? await pc.db.taxCode.findMany({ where: { id: { in: taxCodeIds }, orgId: pc.orgId } }) : [];
  const taxById = new Map(taxCodes.map((t) => [t.id, t]));
  const rate = D(bill.exchangeRate);
  const fx = (v: Dec) => round2(v.mul(rate));
  for (const l of bill.lines) {
    const lineLoc = l.locationId ?? loc;
    const net = fx(D(l.lineTotal));
    const tax = fx(D(l.taxAmount));
    if (!net.isZero()) {
      if (l.purchaseOrderLine && (l.posProductId || l.shopProductId || l.purchaseOrderLine.ledgerAccountId)) {
        const pol = l.purchaseOrderLine;
        const qty = D(l.qty);
        const receivedQty = D(pol.qtyReceived);
        const receiptUnit = receivedQty.isZero() ? ZERO : D(pol.receivedValue).div(receivedQty);
        const grniValue = round2(minQty(qty, receivedQty).mul(receiptUnit));
        if (!grniValue.isZero()) {
          target.push({ ...refs, accountId: grni, locationId: lineLoc, party, amount: (sign === 1 ? grniValue : grniValue.neg()), description: l.description });
        }
        const variance = net.sub(grniValue);
        if (!variance.isZero()) {
          const varianceAccount =
            l.posProductId || l.shopProductId
              ? await inventoryAccountFor(pc, l, lineLoc)
              : pol.ledgerAccountId ?? (await sysAccount(pc, "cogs_default"));
          target.push({ ...refs, accountId: varianceAccount, locationId: lineLoc, amount: sign === 1 ? variance : variance.neg(), description: `Price variance ${l.description}` });
        }
      } else {
        const debit =
          l.posProductId || l.shopProductId
            ? await inventoryAccountFor(pc, l, lineLoc)
            : l.ledgerAccountId ?? (await sysAccount(pc, "suspense"));
        target.push({ ...refs, accountId: debit, locationId: lineLoc, amount: sign === 1 ? net : net.neg(), description: l.description, posProductId: l.posProductId, shopProductId: l.shopProductId });
      }
    }
    if (!tax.isZero()) {
      const taxAccount = (l.taxCodeId && taxById.get(l.taxCodeId)?.purchaseTaxAccountId) || inputTaxDefault;
      target.push({ ...refs, accountId: taxAccount, locationId: lineLoc, amount: sign === 1 ? tax : tax.neg(), description: "Input tax", taxCodeId: l.taxCodeId, taxBaseAmount: net });
    }
  }
  const total = fx(D(bill.total));
  target.push({ ...refs, accountId: await sysAccount(pc, "accounts_payable"), locationId: loc, party, amount: sign === 1 ? total.neg() : total, description: `${bill.kind === "credit_note" ? "Credit note" : "Bill"} ${bill.number}` });
  return postFixed(pc, {
    sourceType: "supplier_bill",
    sourceId: bill.id,
    sourceEvent: bill.kind === "credit_note" ? "credit_note" : "post",
    entryDate: bill.billDate,
    memo: `${bill.kind === "credit_note" ? "Supplier credit note" : "Supplier bill"} ${bill.number}${bill.supplierInvoiceNumber ? ` (${bill.supplierInvoiceNumber})` : ""}`,
    locationId: loc,
    lines: target,
    refs,
  });
}

function minQty(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}

export async function postSupplierPayment(pc: PostingContext, paymentId: string): Promise<JournalEntry | null> {
  const p = await pc.db.supplierPayment.findFirst({
    where: { id: paymentId, orgId: pc.orgId },
    include: { bankAccount: true },
  });
  if (!p) return null;
  const party: PartyRef = { type: "supplier", id: p.supplierId };
  const amount = round2(D(p.amount).mul(D(p.exchangeRate)));
  return postFixed(pc, {
    sourceType: "supplier_payment",
    sourceId: p.id,
    sourceEvent: "post",
    entryDate: p.paymentDate,
    memo: `Supplier payment ${p.number}${p.reference ? ` (${p.reference})` : ""}`,
    locationId: p.locationId,
    lines: [
      { accountId: await sysAccount(pc, "accounts_payable"), locationId: p.locationId, party, amount, description: `Payment ${p.number}` },
      { accountId: p.bankAccount.ledgerAccountId, locationId: p.locationId, amount: amount.neg(), description: `Payment ${p.number}` },
    ],
  });
}
