"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingExpenseQuery,
  useBankAccountsQuery,
  useExpenseActionMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  unwrapEntity,
  AccountingEntriesPanel,
} from "../shared";
import { useState } from "react";

export default function ExpenseDetailPage() {
  const params = useParams();
  const id = String(params.expenseId ?? "");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canApprove = can(P.AccountingExpensesApprove);
  const canWrite = can(P.AccountingExpensesWrite);
  const canSubmit = can(P.AccountingExpensesSubmit);
  const query = useAccountingExpenseQuery(id, Boolean(id));
  const action = useExpenseActionMutation();
  const banks = useBankAccountsQuery({});
  const expense = unwrapEntity(query.data, ["expense"]);
  const status = String(expense.status ?? "");
  const [payBankId, setPayBankId] = useState("");

  const run = async (
    act: "submit" | "approve" | "reject" | "pay" | "void",
    body?: Record<string, unknown>
  ) => {
    try {
      await action.mutateAsync({ id, action: act, body });
      addToast(`Expense ${act}`, "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const timeline = [
    { label: "Created", at: expense.createdAt },
    { label: "Submitted", at: expense.submittedAt },
    { label: "Approved", at: expense.approvedAt },
    { label: "Rejected", at: expense.rejectedReason ? expense.approvedAt || expense.submittedAt : null, note: expense.rejectedReason },
    { label: "Paid", at: expense.paidAt },
    { label: "Voided", at: expense.voidedAt, note: expense.voidReason },
  ].filter((t) => t.at || t.note);

  return (
    <AccountingGate>
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/admin/accounting/expenses" className="text-sm text-[#B8860B]">← Expenses</Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{String(expense.number ?? "Expense")}</h1>
              <p className="mt-1 text-sm text-gray-600">{String(expense.description ?? "")}</p>
            </div>
            <StatusChip status={status} />
          </div>
        </div>
        <AccountingErrorMessage error={query.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Amount</p>
            <MoneyCell value={expense.amount as string} currency={String(expense.currency ?? "USD")} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Category</p>
            <p>{String(expense.categoryName ?? "—")}</p>
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Mode</p>
            <p className="capitalize">{String(expense.paymentMode ?? "").replace(/_/g, " ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSubmit && ["draft", "rejected"].includes(status) ? (
            <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("submit")}>Submit</button>
          ) : null}
          {canApprove && status === "pending_approval" ? (
            <>
              <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("approve")}>Approve</button>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => { const reason = window.prompt("Reject reason") || ""; if (reason.trim().length >= 3) void run("reject", { reason }); }}>Reject</button>
            </>
          ) : null}
          {canWrite && status === "approved" && String(expense.paymentMode) === "reimbursable" && !expense.paidAt ? (
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded border px-2 py-1 text-sm" value={payBankId} onChange={(e) => setPayBankId(e.target.value)}>
                <option value="">Pay from…</option>
                {(banks.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" disabled={!payBankId} onClick={() => void run("pay", { bankAccountId: payBankId })}>Pay reimbursement</button>
            </div>
          ) : null}
          {canWrite && status !== "void" ? (
            <button type="button" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700" onClick={() => { const reason = window.prompt("Void reason") || ""; if (reason.trim().length >= 3) void run("void", { reason }); }}>Void</button>
          ) : null}
          {expense.journalEntryId ? (
            <Link href={`/admin/accounting/journals/${String(expense.journalEntryId)}`} className="rounded-md border px-3 py-2 text-sm">Journal</Link>
          ) : null}
          {expense.paymentJournalEntryId ? (
            <Link href={`/admin/accounting/journals/${String(expense.paymentJournalEntryId)}`} className="rounded-md border px-3 py-2 text-sm">Payment journal</Link>
          ) : null}
          {action.isPending ? <ButtonSpinner /> : null}
        </div>
        {Array.isArray(expense.receiptUrls) && (expense.receiptUrls as string[]).length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Receipts</p>
            <ul className="space-y-1 text-sm">
              {(expense.receiptUrls as string[]).map((url) => (
                <li key={url}><a href={url} target="_blank" rel="noreferrer" className="text-[#B8860B] hover:underline">{url}</a></li>
              ))}
            </ul>
          </div>
        ) : null}
        <AccountingEntriesPanel
          sourceType="expense"
          sourceId={id}
          currency={String(expense.currency ?? "USD")}
        />
        <div className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Timeline</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {timeline.map((t, i) => (
              <li key={i} className="flex justify-between gap-3 border-t border-gray-50 pt-2">
                <span>
                  {t.label}
                  {t.note ? <span className="block text-xs text-gray-500">{String(t.note)}</span> : null}
                </span>
                <span className="text-gray-500">{String(t.at ?? "").slice(0, 19).replace("T", " ")}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </AccountingGate>
  );
}
