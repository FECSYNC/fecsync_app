"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingInitialized,
  useAccountingInvoiceQuery,
  useCreditNoteInvoiceMutation,
  useIssueInvoiceMutation,
  useVoidInvoiceMutation,
  useWriteOffInvoiceMutation,
} from "@/hooks/useAccounting";
import {
  AccountingEntriesPanel,
  AccountingErrorMessage,
  AccountingGate,
  ConfirmReasonModal,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
} from "../shared";

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = String(params?.invoiceId ?? "");
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingReceivablesWrite);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const q = useAccountingInvoiceQuery(invoiceId, Boolean(invoiceId));
  const issueM = useIssueInvoiceMutation();
  const voidM = useVoidInvoiceMutation();
  const writeOffM = useWriteOffInvoiceMutation();
  const creditM = useCreditNoteInvoiceMutation();
  const [modal, setModal] = useState<null | "void" | "writeoff">(null);

  const inv = (q.data as { invoice?: Record<string, unknown> })?.invoice ??
    (q.data as Record<string, unknown> | undefined);

  useEffect(() => {
    if (inv?.kind === "booking" && inv?.id) {
      router.replace(`/admin/booking-invoices/${String(inv.id)}`);
    }
  }, [inv?.kind, inv?.id, router]);

  if (!inv && q.isLoading) {
    return (
      <AccountingGate>
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
        </div>
      </AccountingGate>
    );
  }

  if (q.isError) {
    return (
      <AccountingGate>
        <AccountingErrorMessage error={q.error} />
      </AccountingGate>
    );
  }

  if (!inv) return null;

  const id = String(inv.id);
  const status = String(inv.status);
  const cur = String(inv.currency ?? currency);
  const lines = (inv.lines as Array<Record<string, unknown>>) ?? [];
  const allocations = (inv.allocations as Array<Record<string, unknown>>) ?? [];
  const creditNotes = (inv.creditNotes as Array<Record<string, unknown>>) ?? [];
  const viewToken = inv.viewToken ? String(inv.viewToken) : null;
  const busy =
    issueM.isPending || voidM.isPending || writeOffM.isPending || creditM.isPending;

  const copyPayLink = async () => {
    if (!viewToken) {
      addToast("Issue the invoice first to get a pay link", "error");
      return;
    }
    const url = `${window.location.origin}/invoice/${viewToken}`;
    await navigator.clipboard.writeText(url);
    addToast("Pay link copied", "success");
  };

  const createCreditNote = async () => {
    try {
      const res = (await creditM.mutateAsync({
        id,
        body: {
          issueDate: new Date().toISOString().slice(0, 10),
          lines: lines.map((l) => ({
            description: String(l.description ?? "Credit"),
            ledgerAccountId: String(l.ledgerAccountId),
            qty: String(l.qty ?? "1"),
            unitPrice: String(l.unitPrice ?? "0"),
            taxCodeId: l.taxCodeId ? String(l.taxCodeId) : null,
          })),
        },
      })) as { invoice?: { id: string } };
      const newId = res.invoice?.id;
      addToast("Credit note draft created", "success");
      if (newId) router.push(`/admin/accounting/invoices/${newId}`);
    } catch (e) {
      addToast(accountingErrorMessage(e), "error");
    }
  };

  return (
    <AccountingGate>
      <div className="mx-auto max-w-4xl space-y-5 print:max-w-none">
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <Link
              href="/admin/accounting/invoices"
              className="text-sm text-[#D4AF37] hover:underline"
            >
              ← Invoices
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">
              {String(inv.number)}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip status={status} />
              <span className="text-sm capitalize text-gray-500">
                {String(inv.kind).replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && status === "draft" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void issueM
                    .mutateAsync(id)
                    .then(() => {
                      addToast("Invoice issued", "success");
                      void q.refetch();
                    })
                    .catch((e) => addToast(accountingErrorMessage(e), "error"))
                }
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-white"
              >
                {busy ? <ButtonSpinner /> : null}
                Issue & send
              </button>
            ) : null}
            {canWrite && viewToken ? (
              <button
                type="button"
                onClick={() => void copyPayLink()}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium"
              >
                Copy pay link
              </button>
            ) : null}
            {canWrite &&
            ["sent", "overdue"].includes(status) &&
            inv.kind === "manual" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void createCreditNote()}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium"
              >
                Credit note
              </button>
            ) : null}
            {canWrite &&
            Number(inv.amountDue ?? 0) > 0 &&
            ["sent", "overdue"].includes(status) ? (
              <button
                type="button"
                onClick={() => setModal("writeoff")}
                className="rounded-xl border border-amber-200 px-3 py-2 text-sm font-medium text-amber-800"
              >
                Write off
              </button>
            ) : null}
            {canWrite && status !== "void" && status !== "cancelled" ? (
              <button
                type="button"
                onClick={() => setModal("void")}
                className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-700"
              >
                Void
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium"
            >
              Print / PDF
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-gray-500">Customer</p>
            <p className="font-medium">{String(inv.customerName ?? "—")}</p>
            <p className="text-sm text-gray-600">{String(inv.customerEmail ?? "")}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Dates</p>
            <p className="text-sm">
              Issued {inv.issueDate ? String(inv.issueDate).slice(0, 10) : "—"} · Due{" "}
              {inv.dueAt ? String(inv.dueAt).slice(0, 10) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Total</p>
            <MoneyCell value={String(inv.amount)} currency={cur} align="left" />
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Amount due</p>
            <MoneyCell value={String(inv.amountDue)} currency={cur} align="left" />
          </div>
          {inv.memo ? (
            <div className="sm:col-span-2">
              <p className="text-xs uppercase text-gray-500">Memo</p>
              <p>{String(inv.memo)}</p>
            </div>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2 text-right">Tax</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={String(l.id ?? l.lineNo)} className="border-t border-gray-50">
                  <td className="px-4 py-2">{String(l.description)}</td>
                  <td className="px-4 py-2 text-right">{String(l.qty)}</td>
                  <td className="px-4 py-2 text-right">
                    <MoneyCell value={String(l.unitPrice)} currency={cur} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <MoneyCell value={String(l.taxAmount)} currency={cur} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <MoneyCell value={String(l.lineTotal)} currency={cur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <h2 className="text-sm font-semibold">Payments / allocations</h2>
          {allocations.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No receipts allocated yet.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {allocations.map((a) => (
                <li key={String(a.receiptId)} className="flex justify-between">
                  <span>
                    {String(a.receiptNumber)} · {String(a.date).slice(0, 10)}
                  </span>
                  <MoneyCell value={String(a.amount)} currency={cur} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {creditNotes.length > 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <h2 className="text-sm font-semibold">Credit notes</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {creditNotes.map((c) => (
                <li key={String(c.id)}>
                  <Link
                    href={`/admin/accounting/invoices/${c.id}`}
                    className="text-[#D4AF37] hover:underline"
                  >
                    {String(c.number)}
                  </Link>{" "}
                  · <StatusChip status={String(c.status)} /> ·{" "}
                  <MoneyCell value={String(c.amount)} currency={cur} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {inv.journalEntryId ? (
          <AccountingEntriesPanel
            sourceType="manual_invoice"
            sourceId={id}
            currency={cur}
          />
        ) : null}

        <ConfirmReasonModal
          open={modal === "void"}
          title="Void invoice"
          requireReason
          confirmLabel="Void"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await voidM.mutateAsync({ id, reason });
              addToast("Invoice voided", "success");
              setModal(null);
              void q.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
        <ConfirmReasonModal
          open={modal === "writeoff"}
          title="Write off balance"
          requireReason
          confirmLabel="Write off"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await writeOffM.mutateAsync({
                id,
                amount: String(inv.amountDue ?? "0"),
                reason,
              });
              addToast("Write-off submitted", "success");
              setModal(null);
              void q.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
      </div>
    </AccountingGate>
  );
}
