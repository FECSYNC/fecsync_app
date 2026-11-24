"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { useAccountingBillQuery, useBillActionMutation } from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
  unwrapEntity,
  AccountingEntriesPanel,
} from "../shared";

export default function BillDetailPage() {
  const params = useParams();
  const id = String(params.billId ?? "");
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingPayablesWrite);
  const canApprove = can(P.AccountingPayablesApprove);
  const query = useAccountingBillQuery(id, Boolean(id));
  const action = useBillActionMutation();
  const bill = unwrapEntity(query.data, ["bill"]);
  const lines = asItems(asRecord(bill).lines);
  const status = String(bill.status ?? "");

  const run = async (
    act: "submit" | "approve" | "reject" | "post" | "void" | "credit-note",
    body?: Record<string, unknown>
  ) => {
    try {
      const res = await action.mutateAsync({ id, action: act, body });
      if (act === "credit-note") {
        const cn = asRecord(asRecord(res).bill ?? res);
        addToast("Credit note created", "success");
        if (cn.id && String(cn.id) !== id) router.push(`/admin/accounting/bills/${String(cn.id)}`);
        return;
      }
      addToast(`Bill ${act.replace(/-/g, " ")}`, "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  return (
    <AccountingGate>
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/admin/accounting/bills" className="text-sm text-[#B8860B]">← Bills</Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{String(bill.number ?? "Bill")}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {String(bill.supplierName ?? "")}
                {bill.supplierInvoiceNumber ? ` · Inv ${String(bill.supplierInvoiceNumber)}` : ""}
              </p>
            </div>
            <StatusChip status={status} />
          </div>
        </div>
        <AccountingErrorMessage error={query.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Total</p>
            <MoneyCell value={bill.total as string} currency={String(bill.currency ?? "USD")} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Amount due</p>
            <MoneyCell value={bill.amountDue as string} currency={String(bill.currency ?? "USD")} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Due date</p>
            <p>{String(bill.dueDate ?? "").slice(0, 10) || "—"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && status === "draft" ? (
            <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("submit")}>Submit</button>
          ) : null}
          {canApprove && status === "pending_approval" ? (
            <>
              <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("approve")}>Approve</button>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => { const reason = window.prompt("Reject reason") || ""; if (reason.trim().length >= 3) void run("reject", { reason }); }}>Reject</button>
            </>
          ) : null}
          {canWrite && ["approved", "pending_approval"].includes(status) ? (
            <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("post")}>Post</button>
          ) : null}
          {canWrite && ["posted", "partially_paid"].includes(status) ? (
            <Link href={`/admin/accounting/supplier-payments/new?supplierId=${String(bill.supplierId)}&billId=${id}`} className="rounded-md border px-3 py-2 text-sm">Pay…</Link>
          ) : null}
          {canWrite && ["posted", "partially_paid", "paid"].includes(status) ? (
            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void run("credit-note", { reason: "Credit note" })}>Credit note</button>
          ) : null}
          {canWrite && !["void", "paid"].includes(status) ? (
            <button type="button" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700" onClick={() => { const reason = window.prompt("Void reason") || ""; if (reason.trim().length >= 3) void run("void", { reason }); }}>Void</button>
          ) : null}
          {bill.journalEntryId ? (
            <Link href={`/admin/accounting/journals/${String(bill.journalEntryId)}`} className="rounded-md border px-3 py-2 text-sm">Journal</Link>
          ) : null}
          {action.isPending ? <ButtonSpinner /> : null}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Tax</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={String(l.id)} className="border-t">
                  <td className="px-3 py-2">{String(l.description)}</td>
                  <td className="px-3 py-2 text-right">{String(l.qty)}</td>
                  <td className="px-3 py-2 text-right"><MoneyCell value={l.unitCost as string} currency={String(bill.currency ?? "USD")} /></td>
                  <td className="px-3 py-2 text-right"><MoneyCell value={l.taxAmount as string} currency={String(bill.currency ?? "USD")} /></td>
                  <td className="px-3 py-2 text-right"><MoneyCell value={l.lineTotal as string} currency={String(bill.currency ?? "USD")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AccountingEntriesPanel
          sourceType="supplier_bill"
          sourceId={id}
          currency={String(bill.currency ?? "USD")}
        />
      </div>
    </AccountingGate>
  );
}
