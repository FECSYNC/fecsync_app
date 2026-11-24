/**
 * Expenses on approval: Dr category account (net) + Dr input tax /
 * Cr bank (paid_now) or employee reimbursements (reimbursable).
 * on_account expenses become a SupplierBill and post through payables.
 */
import type { JournalEntry } from "@prisma/client";
import { D, round2 } from "@/lib/accounting/money";
import { sysAccount, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, type TargetLine } from "@/lib/accounting/posting/reconcile";

export async function postExpenseApproval(pc: PostingContext, expenseId: string): Promise<JournalEntry | null> {
  const e = await pc.db.expense.findFirst({
    where: { id: expenseId, orgId: pc.orgId },
    include: { category: true },
  });
  if (!e || e.paymentMode === "on_account") return null;
  const rate = D(e.exchangeRate);
  const net = round2(D(e.netAmount).mul(rate));
  const tax = round2(D(e.taxAmount).mul(rate));
  const gross = net.add(tax);
  const loc = e.locationId;
  const refs = { expenseId: e.id };
  const lines: TargetLine[] = [
    { ...refs, accountId: e.category.ledgerAccountId, locationId: loc, amount: net, description: e.description },
  ];
  if (!tax.isZero()) {
    let taxAccount = await sysAccount(pc, "input_tax");
    if (e.taxCodeId) {
      const t = await pc.db.taxCode.findFirst({ where: { id: e.taxCodeId, orgId: pc.orgId } });
      if (t?.purchaseTaxAccountId) taxAccount = t.purchaseTaxAccountId;
    }
    lines.push({ ...refs, accountId: taxAccount, locationId: loc, amount: tax, description: "Input tax", taxCodeId: e.taxCodeId, taxBaseAmount: net });
  }
  if (e.paymentMode === "paid_now") {
    const bank = await pc.db.bankAccount.findFirst({ where: { id: e.bankAccountId ?? "", orgId: pc.orgId } });
    if (!bank) return null;
    lines.push({ ...refs, accountId: bank.ledgerAccountId, locationId: loc, amount: gross.neg(), description: `Expense ${e.number}` });
  } else {
    lines.push({
      ...refs,
      accountId: await sysAccount(pc, "employee_reimbursements"),
      locationId: loc,
      party: e.employeeUserId ? { type: "employee", id: e.employeeUserId } : null,
      amount: gross.neg(),
      description: `Reimbursable ${e.number}`,
    });
  }
  return postFixed(pc, {
    sourceType: "expense",
    sourceId: e.id,
    sourceEvent: "approve",
    entryDate: e.expenseDate,
    memo: `Expense ${e.number}: ${e.description}`,
    locationId: loc,
    lines,
    refs,
  });
}

export async function postExpenseReimbursement(pc: PostingContext, expenseId: string): Promise<JournalEntry | null> {
  const e = await pc.db.expense.findFirst({ where: { id: expenseId, orgId: pc.orgId } });
  if (!e || e.paymentMode !== "reimbursable" || !e.paymentBankAccountId) return null;
  const bank = await pc.db.bankAccount.findFirst({ where: { id: e.paymentBankAccountId, orgId: pc.orgId } });
  if (!bank) return null;
  const gross = round2(D(e.amount).mul(D(e.exchangeRate)));
  return postFixed(pc, {
    sourceType: "expense_payment",
    sourceId: e.id,
    sourceEvent: "pay",
    entryDate: e.paidAt ?? new Date(),
    memo: `Reimbursement ${e.number}`,
    locationId: e.locationId,
    refs: { expenseId: e.id },
    lines: [
      {
        accountId: await sysAccount(pc, "employee_reimbursements"),
        locationId: e.locationId,
        party: e.employeeUserId ? { type: "employee", id: e.employeeUserId } : null,
        amount: gross,
        description: `Reimbursement ${e.number}`,
      },
      { accountId: bank.ledgerAccountId, locationId: e.locationId, amount: gross.neg(), description: `Reimbursement ${e.number}` },
    ],
  });
}
