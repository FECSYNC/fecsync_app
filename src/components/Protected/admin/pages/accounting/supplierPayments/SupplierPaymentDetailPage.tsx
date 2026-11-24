"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { useSupplierPaymentActionMutation, useSupplierPaymentQuery } from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
  unwrapEntity,
} from "../shared";

export default function SupplierPaymentDetailPage() {
  const params = useParams();
  const id = String(params.paymentId ?? "");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingPayablesWrite);
  const canApprove = can(P.AccountingPayablesApprove);
  const query = useSupplierPaymentQuery(id, Boolean(id));
  const action = useSupplierPaymentActionMutation();
  const payment = unwrapEntity(query.data, ["payment"]);
  const allocations = asItems(asRecord(payment).allocations);
  const status = String(payment.status ?? "");

  const run = async (act: "approve" | "post" | "void" | "remittance", body?: Record<string, unknown>) => {
    try {
      await action.mutateAsync({ id, action: act, body });
      addToast(act === "remittance" ? "Remittance marked sent" : `Payment ${act}`, "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  return (
    <AccountingGate>
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/admin/accounting/supplier-payments" className="text-sm text-[#B8860B]">← Payments</Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{String(payment.number ?? "Payment")}</h1>
              <p className="mt-1 text-sm text-gray-600">{String(payment.supplierName ?? "")}</p>
            </div>
            <StatusChip status={status} />
          </div>
        </div>
        <AccountingErrorMessage error={query.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Amount</p>
            <MoneyCell value={payment.amount as string} currency={String(payment.currency ?? "USD")} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Unapplied</p>
            <MoneyCell value={payment.unappliedAmount as string} currency={String(payment.currency ?? "USD")} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Date</p>
            <p>{String(payment.paymentDate ?? "").slice(0, 10)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove && status === "pending_approval" ? (
            <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("approve")}>Approve</button>
          ) : null}
          {canWrite && ["approved", "draft"].includes(status) ? (
            <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("post")}>Post</button>
          ) : null}
          {canWrite && status === "posted" ? (
            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void run("remittance")}>
              {payment.remittanceSentAt ? "Resend remittance" : "Send remittance"}
            </button>
          ) : null}
          {canWrite && status !== "void" ? (
            <button type="button" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700" onClick={() => { const reason = window.prompt("Void reason") || ""; if (reason.trim().length >= 3) void run("void", { reason }); }}>Void</button>
          ) : null}
          {payment.journalEntryId ? (
            <Link href={`/admin/accounting/journals/${String(payment.journalEntryId)}`} className="rounded-md border px-3 py-2 text-sm">Journal</Link>
          ) : null}
          {action.isPending ? <ButtonSpinner /> : null}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Bill</th>
                <th className="px-3 py-2 text-right">Allocated</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/admin/accounting/bills/${String(a.billId)}`} className="text-[#B8860B] hover:underline">
                      {String(a.billNumber ?? a.billId)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right"><MoneyCell value={a.amount as string} currency={String(payment.currency ?? "USD")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AccountingGate>
  );
}
