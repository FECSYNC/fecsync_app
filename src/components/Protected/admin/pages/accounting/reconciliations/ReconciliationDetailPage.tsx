"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useCompleteReconciliationMutation,
  usePatchReconciliationMutation,
  useReconciliationQuery,
  useReopenReconciliationMutation,
} from "@/hooks/useAccounting";
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

export default function ReconciliationDetailPage() {
  const params = useParams();
  const id = String(params.reconciliationId ?? "");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingBankingWrite);
  const canManage = can(P.AccountingManage);
  const query = useReconciliationQuery(id, Boolean(id));
  const patch = usePatchReconciliationMutation();
  const complete = useCompleteReconciliationMutation();
  const reopen = useReopenReconciliationMutation();
  const data = asRecord(query.data);
  const rec = unwrapEntity(query.data, ["reconciliation"]);
  const lines = asItems(data.lines);
  const cleared = lines.filter((l) => l.cleared);
  const uncleared = lines.filter((l) => !l.cleared);
  const status = String(rec.status ?? "");

  const toggle = async (journalLineIds: string[], clearedFlag: boolean) => {
    try {
      await patch.mutateAsync({ id, body: { journalLineIds, cleared: clearedFlag } });
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  return (
    <AccountingGate>
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 print:p-0">
        <div className="print:hidden">
          <Link href="/admin/accounting/reconciliations" className="text-sm text-[#B8860B]">← Reconciliations</Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{String(rec.number ?? "Reconciliation")}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {String(asRecord(data.bankAccount).name ?? "")} · statement {String(rec.statementDate ?? "").slice(0, 10)}
              </p>
            </div>
            <StatusChip status={status} />
          </div>
        </div>
        <AccountingErrorMessage error={query.error} />
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Opening</p>
            <MoneyCell value={rec.openingBalance as string} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Cleared</p>
            <MoneyCell value={rec.clearedBalance as string} />
          </div>
          <div className="rounded-lg border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-gray-500">Statement</p>
            <MoneyCell value={rec.statementEndingBalance as string} />
          </div>
          <div className={`rounded-lg border bg-white p-3 text-sm ${Number(rec.difference) === 0 ? "border-emerald-300" : "border-amber-300"}`}>
            <p className="text-xs uppercase text-gray-500">Difference</p>
            <MoneyCell value={rec.difference as string} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {canWrite && status === "in_progress" ? (
            <button
              type="button"
              className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={complete.isPending || Number(rec.difference) !== 0}
              onClick={() =>
                void complete.mutateAsync(id).then(
                  () => addToast("Reconciliation complete", "success"),
                  (err) => addToast(accountingErrorMessage(err), "error")
                )
              }
            >
              {complete.isPending ? <ButtonSpinner /> : null}
              Complete
            </button>
          ) : null}
          {canManage && status === "completed" ? (
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm"
              onClick={() => {
                const reason = window.prompt("Reopen reason") || "";
                if (reason.trim().length < 5) return;
                void reopen.mutateAsync({ id, reason }).then(
                  () => addToast("Reopened", "success"),
                  (err) => addToast(accountingErrorMessage(err), "error")
                );
              }}
            >
              Reopen…
            </button>
          ) : null}
          <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => window.print()}>
            Print report
          </button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold">Cleared ({cleared.length})</h2>
            <ul className="max-h-96 space-y-1 overflow-y-auto rounded border bg-white p-2 text-sm">
              {cleared.map((l) => (
                <li key={String(l.id)} className="flex items-center justify-between gap-2 border-b border-gray-50 py-1">
                  <label className="flex items-center gap-2">
                    {status === "in_progress" && canWrite ? (
                      <input type="checkbox" checked onChange={() => void toggle([String(l.id)], false)} />
                    ) : null}
                    <span>{String(l.entryNumber)} · {String(l.description ?? l.memo ?? "")}</span>
                  </label>
                  <MoneyCell value={l.amount as string} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Uncleared ({uncleared.length})</h2>
            <ul className="max-h-96 space-y-1 overflow-y-auto rounded border bg-white p-2 text-sm">
              {uncleared.map((l) => (
                <li key={String(l.id)} className="flex items-center justify-between gap-2 border-b border-gray-50 py-1">
                  <label className="flex items-center gap-2">
                    {status === "in_progress" && canWrite ? (
                      <input type="checkbox" checked={false} onChange={() => void toggle([String(l.id)], true)} />
                    ) : null}
                    <span>{String(l.entryNumber)} · {String(l.description ?? l.memo ?? "")}</span>
                  </label>
                  <MoneyCell value={l.amount as string} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AccountingGate>
  );
}
