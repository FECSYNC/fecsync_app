"use client";

import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import {
  useAccountingInitialized,
  useAccountingSourceEntriesQuery,
} from "@/hooks/useAccounting";
import MoneyCell from "./MoneyCell";
import StatusChip from "./StatusChip";
import AccountingErrorMessage from "./AccountingErrorMessage";

type EntryRow = {
  id: string;
  number?: string;
  entryDate?: string;
  status?: string;
  memo?: string | null;
  totalDebit?: string;
  totalCredit?: string;
  currency?: string;
};

/**
 * Shows ledger journal entries posted from a source document.
 * Visible only when the actor has accounting:read and Accounting is initialized.
 */
export default function AccountingEntriesPanel({
  sourceType,
  sourceId,
  currency = "USD",
  className = "",
}: {
  sourceType: string;
  sourceId: string;
  currency?: string;
  className?: string;
}) {
  const can = useAuthStore((s) => s.can);
  const canRead = can(P.AccountingRead);
  const { initialized } = useAccountingInitialized(canRead);
  const enabled = canRead && initialized && Boolean(sourceType) && Boolean(sourceId);
  const q = useAccountingSourceEntriesQuery(sourceType, sourceId, enabled);

  if (!canRead || !initialized) return null;

  const rows = (
    ((q.data as { entries?: EntryRow[] })?.entries ??
      (q.data as { items?: EntryRow[] })?.items ??
      []) as EntryRow[]
  );

  return (
    <section className={`rounded-2xl border border-gray-100 bg-white ${className}`}>
      <div className="border-b border-gray-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Accounting entries</h3>
        <p className="text-xs text-gray-500">
          Auto-posted journals for this document.
        </p>
      </div>
      {q.isLoading ? (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
        </div>
      ) : null}
      {q.isError ? (
        <div className="p-4">
          <AccountingErrorMessage error={q.error} />
        </div>
      ) : null}
      {!q.isLoading && !q.isError && rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No journal entries yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Entry</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Debit</th>
                <th className="px-4 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-gray-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/accounting/journals/${e.id}`}
                      className="font-medium text-[#D4AF37] hover:underline"
                    >
                      {e.number ?? e.id.slice(0, 8)}
                    </Link>
                    {e.memo ? (
                      <p className="text-xs text-gray-500">{e.memo}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-gray-700">
                    {e.entryDate ? String(e.entryDate).slice(0, 10) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {e.status ? <StatusChip status={e.status} /> : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <MoneyCell value={e.totalDebit} currency={e.currency ?? currency} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <MoneyCell value={e.totalCredit} currency={e.currency ?? currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
