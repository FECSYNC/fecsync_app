"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingAuditQuery,
  useAccountingInitialized,
  useAccountingJournalQuery,
  useApproveJournalMutation,
  useDeleteJournalMutation,
  usePostJournalMutation,
  useRejectJournalMutation,
  useReverseJournalMutation,
  useSubmitJournalMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  ConfirmReasonModal,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
} from "../shared";

function sourceHref(sourceType?: string | null, sourceId?: string | null) {
  if (!sourceType || !sourceId) return null;
  const map: Record<string, string> = {
    booking: `/admin/bookings/${sourceId}`,
    booking_payment: `/admin/booking-payments`,
    manual_invoice: `/admin/accounting/invoices/${sourceId}`,
    customer_receipt: `/admin/accounting/receipts?receiptId=${sourceId}`,
    pos_sale: `/admin/pos/sales/${sourceId}`,
    supplier_bill: `/admin/accounting/bills/${sourceId}`,
    expense: `/admin/accounting/expenses/${sourceId}`,
    membership_payment: `/admin/memberships`,
    shop_order: `/admin/orders/${sourceId}`,
  };
  return map[sourceType] ?? null;
}

export default function JournalDetailPage() {
  const params = useParams();
  const entryId = String(params?.entryId ?? "");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const q = useAccountingJournalQuery(entryId, Boolean(entryId));
  const audit = useAccountingAuditQuery(
    { entityType: "JournalEntry", entityId: entryId },
    Boolean(entryId)
  );

  const submitM = useSubmitJournalMutation();
  const approveM = useApproveJournalMutation();
  const rejectM = useRejectJournalMutation();
  const postM = usePostJournalMutation();
  const reverseM = useReverseJournalMutation();
  const deleteM = useDeleteJournalMutation();

  const [modal, setModal] = useState<null | "reject" | "reverse" | "delete" | "post">(null);

  const entry = q.data as {
    id: string;
    number: string;
    entryDate: string;
    status: string;
    kind: string;
    sourceType: string;
    sourceId: string | null;
    memo: string | null;
    reference: string | null;
    currency: string;
    totalDebit: string;
    totalCredit: string;
    attachments?: Array<{ url: string; name?: string }> | null;
    reversalOfId?: string | null;
    reversedBy?: { id: string; number: string } | null;
    reversalReason?: string | null;
    rejectedReason?: string | null;
    lines?: Array<{
      id: string;
      lineNo: number;
      account?: { code?: string; name?: string } | null;
      ledgerAccountId?: string;
      accountCode?: string;
      accountName?: string;
      description?: string | null;
      debit: string;
      credit: string;
    }>;
    approvals?: Array<{
      id: string;
      status: string;
      requestedAt: string;
      decidedAt?: string | null;
      decisionReason?: string | null;
    }>;
  } | undefined;

  const lines = entry?.lines ?? [];
  const sourceLink = sourceHref(entry?.sourceType, entry?.sourceId);
  const busy =
    submitM.isPending ||
    approveM.isPending ||
    rejectM.isPending ||
    postM.isPending ||
    reverseM.isPending ||
    deleteM.isPending;

  const actions = useMemo(() => {
    if (!entry) return [];
    const list: Array<{ key: string; label: string; show: boolean; onClick: () => void }> = [
      {
        key: "submit",
        label: "Submit",
        show: entry.status === "draft" && can(P.AccountingJournalsWrite),
        onClick: () =>
          void submitM
            .mutateAsync(entry.id)
            .then(() => {
              addToast("Submitted for approval", "success");
              void q.refetch();
            })
            .catch((e) => addToast(accountingErrorMessage(e), "error")),
      },
      {
        key: "approve",
        label: "Approve",
        show: entry.status === "pending_approval" && can(P.AccountingJournalsApprove),
        onClick: () =>
          void approveM
            .mutateAsync(entry.id)
            .then(() => {
              addToast("Journal approved", "success");
              void q.refetch();
            })
            .catch((e) => addToast(accountingErrorMessage(e), "error")),
      },
      {
        key: "reject",
        label: "Reject",
        show: entry.status === "pending_approval" && can(P.AccountingJournalsApprove),
        onClick: () => setModal("reject"),
      },
      {
        key: "post",
        label: "Post",
        show:
          (entry.status === "approved" || entry.status === "draft") &&
          can(P.AccountingJournalsPost),
        onClick: () => setModal("post"),
      },
      {
        key: "reverse",
        label: "Reverse",
        show: entry.status === "posted" && can(P.AccountingJournalsReverse),
        onClick: () => setModal("reverse"),
      },
      {
        key: "delete",
        label: "Delete draft",
        show: entry.status === "draft" && can(P.AccountingJournalsWrite),
        onClick: () => setModal("delete"),
      },
      {
        key: "print",
        label: "Print",
        show: true,
        onClick: () => window.print(),
      },
    ];
    return list.filter((a) => a.show);
  }, [entry, can, submitM, approveM, addToast, q]);

  return (
    <AccountingGate>
      <div className="mx-auto max-w-5xl space-y-5 print:max-w-none">
        {q.isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
          </div>
        ) : null}
        {q.isError ? <AccountingErrorMessage error={q.error} /> : null}

        {entry ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
              <div>
                <Link
                  href="/admin/accounting/journals"
                  className="text-sm text-[#D4AF37] hover:underline"
                >
                  ← Journals
                </Link>
                <h1 className="mt-2 text-2xl font-bold text-gray-900">
                  {entry.number}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusChip status={entry.status} />
                  <span className="text-sm text-gray-500 capitalize">
                    {entry.kind.replace(/_/g, " ")} · {entry.sourceType}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={busy}
                    onClick={a.onClick}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                      a.key === "delete" || a.key === "reject"
                        ? "border border-red-200 text-red-700"
                        : a.key === "post" || a.key === "approve"
                          ? "bg-[#D4AF37] text-white"
                          : "border border-gray-200 text-gray-800"
                    }`}
                  >
                    {busy ? <ButtonSpinner /> : null}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden print:block">
              <h1 className="text-2xl font-bold">{entry.number}</h1>
              <p className="text-sm">
                {String(entry.entryDate).slice(0, 10)} · {entry.status}
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-gray-500">Entry date</p>
                <p className="font-medium">{String(entry.entryDate).slice(0, 10)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-gray-500">Reference</p>
                <p className="font-medium">{entry.reference || "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase text-gray-500">Memo</p>
                <p className="font-medium">{entry.memo || "—"}</p>
              </div>
              {sourceLink ? (
                <div className="sm:col-span-2 print:hidden">
                  <p className="text-xs uppercase text-gray-500">Source document</p>
                  <Link href={sourceLink} className="text-[#D4AF37] hover:underline">
                    Open {entry.sourceType}
                  </Link>
                </div>
              ) : null}
              {entry.reversalOfId ? (
                <div>
                  <p className="text-xs uppercase text-gray-500">Reversal of</p>
                  <Link
                    href={`/admin/accounting/journals/${entry.reversalOfId}`}
                    className="text-[#D4AF37] hover:underline"
                  >
                    Original entry
                  </Link>
                </div>
              ) : null}
              {entry.reversedBy ? (
                <div>
                  <p className="text-xs uppercase text-gray-500">Reversed by</p>
                  <Link
                    href={`/admin/accounting/journals/${entry.reversedBy.id}`}
                    className="text-[#D4AF37] hover:underline"
                  >
                    {entry.reversedBy.number}
                  </Link>
                  {entry.reversalReason ? (
                    <p className="text-xs text-gray-500">{entry.reversalReason}</p>
                  ) : null}
                </div>
              ) : null}
              {entry.rejectedReason ? (
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase text-gray-500">Rejection reason</p>
                  <p className="text-red-700">{entry.rejectedReason}</p>
                </div>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2">#</th>
                    <th className="px-4 py-2">Account</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 text-right">Debit</th>
                    <th className="px-4 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-gray-50">
                      <td className="px-4 py-2">{l.lineNo}</td>
                      <td className="px-4 py-2">
                        {l.account?.code ?? l.accountCode ?? ""}{" "}
                        {l.account?.name ?? l.accountName ?? ""}
                      </td>
                      <td className="px-4 py-2 text-gray-600">{l.description || "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell value={l.debit} currency={entry.currency || currency} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell value={l.credit} currency={entry.currency || currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-100 font-semibold">
                    <td colSpan={3} className="px-4 py-2 text-right">
                      Totals
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MoneyCell value={entry.totalDebit} currency={entry.currency || currency} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MoneyCell value={entry.totalCredit} currency={entry.currency || currency} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {Array.isArray(entry.attachments) && entry.attachments.length > 0 ? (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 print:hidden">
                <h2 className="text-sm font-semibold">Attachments</h2>
                <ul className="mt-2 space-y-1">
                  {entry.attachments.map((a) => (
                    <li key={a.url}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[#D4AF37] hover:underline"
                      >
                        {a.name || a.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-2xl border border-gray-100 bg-white p-4 print:hidden">
              <h2 className="text-sm font-semibold">Approval history</h2>
              {(entry.approvals ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No approval requests.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(entry.approvals ?? []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <StatusChip status={a.status} />
                      <span className="text-gray-500">
                        {String(a.requestedAt).slice(0, 16).replace("T", " ")}
                        {a.decisionReason ? ` · ${a.decisionReason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4 print:hidden">
              <h2 className="text-sm font-semibold">Audit trail</h2>
              {audit.isError ? <AccountingErrorMessage error={audit.error} /> : null}
              <ul className="mt-2 space-y-2 text-sm">
                {(
                  ((audit.data as { items?: Array<{ id: string; action?: string; description?: string; createdAt?: string }> })
                    ?.items ??
                    (audit.data as { rows?: Array<{ id: string; action?: string; description?: string; createdAt?: string }> })
                      ?.rows ??
                    []) as Array<{
                    id: string;
                    action?: string;
                    description?: string;
                    createdAt?: string;
                  }>
                ).map((row) => (
                  <li key={row.id} className="border-t border-gray-50 pt-2">
                    <p className="font-medium text-gray-900">
                      {row.action ?? "event"}
                    </p>
                    <p className="text-gray-600">{row.description}</p>
                    <p className="text-xs text-gray-400">
                      {row.createdAt ? String(row.createdAt).slice(0, 19).replace("T", " ") : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        <ConfirmReasonModal
          open={modal === "reject"}
          title="Reject journal"
          message="Provide a reason for the requester."
          confirmLabel="Reject"
          requireReason
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await rejectM.mutateAsync({ id: entryId, reason });
              addToast("Journal rejected", "success");
              setModal(null);
              void q.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
        <ConfirmReasonModal
          open={modal === "reverse"}
          title="Reverse journal"
          message="Creates a reversing entry. Posted entries stay immutable."
          confirmLabel="Reverse"
          requireReason
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await reverseM.mutateAsync({ id: entryId, reason });
              addToast("Journal reversed", "success");
              setModal(null);
              void q.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
        <ConfirmReasonModal
          open={modal === "post"}
          title="Post journal"
          message="Posting is permanent. Corrections require a reversal."
          confirmLabel="Post"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            try {
              await postM.mutateAsync(entryId);
              addToast("Journal posted", "success");
              setModal(null);
              void q.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
        <ConfirmReasonModal
          open={modal === "delete"}
          title="Delete draft"
          message="This voids the draft journal. This cannot be undone."
          confirmLabel="Delete"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            try {
              await deleteM.mutateAsync(entryId);
              addToast("Draft deleted", "success");
              setModal(null);
              window.location.href = "/admin/accounting/journals";
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
      </div>
    </AccountingGate>
  );
}
