"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useBankAccountsQuery,
  useBankTransactionActionMutation,
  useBankTransactionSuggestionsQuery,
  useBankTransactionsQuery,
  useCreateBankTransactionMutation,
  useCreateReconciliationMutation,
  useImportBankTransactionsMutation,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingEntriesPanel,
  AccountingGate,
  MoneyCell,
  MoneyInput,
  StatusChip,
  accountingErrorMessage,
  asItems,
  todayIsoDate,
} from "../shared";

const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "MM-DD-YYYY", "DD.MM.YYYY"] as const;

export default function BankAccountDetailPage() {
  const params = useParams();
  const id = String(params.bankAccountId ?? "");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingBankingWrite);
  const accounts = useBankAccountsQuery({ includeArchived: true });
  const account = (accounts.data ?? []).find((a) => a.id === id);
  const [status, setStatus] = useState("unmatched");
  const txQuery = useBankTransactionsQuery(id, { status: status || undefined }, Boolean(id));
  const rows = asItems(txQuery.data);
  const createTxn = useCreateBankTransactionMutation();
  const importTxn = useImportBankTransactionsMutation();
  const txnAction = useBankTransactionActionMutation();
  const startRec = useCreateReconciliationMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ txnDate: todayIsoDate(), description: "", amount: "0.00", reference: "" });
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    reference: "",
    dateFormat: "YYYY-MM-DD" as (typeof DATE_FORMATS)[number],
    decimalSeparator: "." as "." | ",",
  });
  const [previewRows, setPreviewRows] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({ accountId: "", memo: "", taxCodeId: "" });
  const suggestions = useBankTransactionSuggestionsQuery(matchId ?? "", Boolean(matchId));

  const matchTxn = rows.find((r) => String(r.id) === matchId);
  const suggestionList = asItems(asRecordSafe(suggestions.data).suggestions ?? suggestions.data);

  function asRecordSafe(data: unknown) {
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  }

  const selectedSum = useMemo(() => {
    const sug = suggestionList.flatMap((s) => asItems((s as { lines?: unknown }).lines ?? []));
    // Prefer selected journal line amounts from suggestions payload if present
    void sug;
    return selectedLines.length;
  }, [selectedLines, suggestionList]);

  const onPickCsv = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const first = text.split(/\r?\n/)[0] ?? "";
    const cols = first.split(",").map((c) => c.replace(/^"|"$/g, "").trim()).filter(Boolean);
    setHeaders(cols);
    setPreviewRows(Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1));
    setMapping((m) => ({
      ...m,
      date: cols.find((c) => /date/i.test(c)) ?? cols[0] ?? "",
      description: cols.find((c) => /desc|narr|memo|detail/i.test(c)) ?? cols[1] ?? "",
      amount: cols.find((c) => /amount|amt/i.test(c)) ?? "",
    }));
    setImportOpen(true);
  };

  const runImport = async () => {
    const fd = new FormData();
    fd.append("csvText", csvText);
    fd.append("mapping", JSON.stringify(mapping));
    try {
      const res = (await importTxn.mutateAsync({ bankAccountId: id, formData: fd })) as {
        importedCount?: number;
        duplicateCount?: number;
      };
      addToast(
        `Imported ${res.importedCount ?? 0} · duplicates ${res.duplicateCount ?? 0}`,
        "success"
      );
      setImportOpen(false);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  return (
    <AccountingGate>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/admin/accounting/banking" className="text-sm text-[#B8860B]">← Banking</Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{account?.name ?? "Bank account"}</h1>
              <p className="mt-1 text-sm text-gray-600">
                Ledger <MoneyCell value={account?.balance ?? account?.openingBalance} currency={account?.currency} />
              </p>
            </div>
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => fileRef.current?.click()}>
                  Import CSV
                </button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onPickCsv(e.target.files?.[0] ?? null)} />
                <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setManualOpen(true)}>
                  Manual line
                </button>
                <button
                  type="button"
                  className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white"
                  onClick={() => {
                    const statementEndingBalance = window.prompt("Statement ending balance") || "";
                    const statementDate = window.prompt("Statement date (YYYY-MM-DD)", todayIsoDate()) || todayIsoDate();
                    if (!statementEndingBalance) return;
                    void startRec
                      .mutateAsync({ bankAccountId: id, statementDate, statementEndingBalance })
                      .then((res) => {
                        const rec = asRecordSafe(asRecordSafe(res).reconciliation ?? res);
                        addToast("Reconciliation started", "success");
                        if (rec.id) window.location.href = `/admin/accounting/reconciliations/${String(rec.id)}`;
                      })
                      .catch((err) => addToast(accountingErrorMessage(err), "error"));
                  }}
                >
                  Start reconciliation
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
          <option value="">All</option>
          {["unmatched", "matched", "reconciled", "excluded"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <AccountingErrorMessage error={txQuery.error} />
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={String(t.id)} className="border-t">
                  <td className="px-3 py-2">{String(t.txnDate ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2">{String(t.description)}</td>
                  <td className="px-3 py-2 text-right"><MoneyCell value={t.amount as string} currency={account?.currency} /></td>
                  <td className="px-3 py-2"><StatusChip status={String(t.status)} /></td>
                  <td className="px-3 py-2 text-right space-x-2">
                    {canWrite && String(t.status) === "unmatched" ? (
                      <>
                        <button type="button" className="text-[#B8860B]" onClick={() => { setMatchId(String(t.id)); setSelectedLines([]); }}>Match</button>
                        <button type="button" className="text-[#B8860B]" onClick={() => { setMatchId(String(t.id)); setEntryOpen(true); }}>Create entry</button>
                        <button type="button" className="text-red-700" onClick={() => { const reason = window.prompt("Exclude reason") || ""; if (reason.trim().length >= 3) void txnAction.mutateAsync({ id: String(t.id), bankAccountId: id, action: "exclude", body: { reason } }).then(() => addToast("Excluded", "success"), (err) => addToast(accountingErrorMessage(err), "error")); }}>Exclude</button>
                      </>
                    ) : null}
                    {canWrite && String(t.status) === "matched" ? (
                      <button type="button" className="text-[#B8860B]" onClick={() => void txnAction.mutateAsync({ id: String(t.id), bankAccountId: id, action: "unmatch" }).then(() => addToast("Unmatched", "success"), (err) => addToast(accountingErrorMessage(err), "error"))}>Unmatch</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {manualOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-4">
            <h2 className="text-lg font-semibold">Manual bank line</h2>
            <input type="date" className="w-full rounded border px-3 py-2 text-sm" value={manual.txnDate} onChange={(e) => setManual({ ...manual, txnDate: e.target.value })} />
            <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Description" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
            <MoneyInput value={manual.amount} onChange={(amount) => setManual({ ...manual, amount })} label="Amount (+ in / − out)" />
            <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Reference" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm" onClick={() => setManualOpen(false)}>Cancel</button>
              <button type="button" className="inline-flex items-center gap-2 rounded-md bg-[#D4AF37] px-4 py-2 text-sm text-white" onClick={() => void createTxn.mutateAsync({ bankAccountId: id, body: manual }).then(() => { addToast("Line added", "success"); setManualOpen(false); }, (err) => addToast(accountingErrorMessage(err), "error"))}>
                {createTxn.isPending ? <ButtonSpinner /> : null}Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg bg-white p-4">
            <h2 className="text-lg font-semibold">Import wizard</h2>
            <p className="text-sm text-gray-600">{previewRows} data rows detected · map columns below</p>
            {(["date", "description", "amount", "debit", "credit", "reference"] as const).map((key) => (
              <label key={key} className="block text-sm">
                {key}
                <select className="mt-1 w-full rounded border px-3 py-2" value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}>
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="block text-sm">
              Date format
              <select className="mt-1 w-full rounded border px-3 py-2" value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as (typeof DATE_FORMATS)[number] })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm" onClick={() => setImportOpen(false)}>Cancel</button>
              <button type="button" className="inline-flex items-center gap-2 rounded-md bg-[#D4AF37] px-4 py-2 text-sm text-white" onClick={() => void runImport()}>
                {importTxn.isPending ? <ButtonSpinner /> : null}Import
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {matchId ? (
        <AccountingEntriesPanel
          sourceType="bank_line"
          sourceId={matchId}
          currency={account?.currency}
          className="rounded-lg border bg-white p-4"
        />
      ) : null}

      {matchId && !entryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg bg-white p-4">
            <h2 className="text-lg font-semibold">Match panel</h2>
            <p className="text-sm text-gray-600">
              Bank amount <MoneyCell value={matchTxn?.amount as string} currency={account?.currency} /> · selected lines {selectedSum}
            </p>
            <AccountingErrorMessage error={suggestions.error} />
            <ul className="space-y-2 text-sm">
              {suggestionList.map((s, i) => {
                const ids = (s.journalLineIds as string[]) ?? [];
                const score = Number(s.score ?? 0);
                const checked = ids.every((x) => selectedLines.includes(x)) && ids.length > 0;
                return (
                  <li key={i} className="flex items-start gap-2 rounded border p-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedLines(ids);
                        else setSelectedLines([]);
                      }}
                    />
                    <div>
                      <p className="font-medium">Score {score.toFixed(0)} · {ids.length} line(s)</p>
                      <p className="text-xs text-gray-500">{ids.join(", ")}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm" onClick={() => setMatchId(null)}>Close</button>
              <button
                type="button"
                disabled={!selectedLines.length}
                className="rounded-md bg-[#D4AF37] px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() =>
                  void txnAction
                    .mutateAsync({ id: matchId, bankAccountId: id, action: "match", body: { journalLineIds: selectedLines } })
                    .then(() => { addToast("Matched", "success"); setMatchId(null); }, (err) => addToast(accountingErrorMessage(err), "error"))
                }
              >
                Match selection
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {entryOpen && matchId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-4">
            <h2 className="text-lg font-semibold">Create entry from bank line</h2>
            <AccountPicker value={entryForm.accountId} onChange={(accountId) => setEntryForm({ ...entryForm, accountId })} label="Offset account" />
            <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Memo" value={entryForm.memo} onChange={(e) => setEntryForm({ ...entryForm, memo: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm" onClick={() => { setEntryOpen(false); setMatchId(null); }}>Cancel</button>
              <button
                type="button"
                className="rounded-md bg-[#D4AF37] px-4 py-2 text-sm text-white"
                onClick={() =>
                  void txnAction
                    .mutateAsync({ id: matchId, bankAccountId: id, action: "create-entry", body: entryForm })
                    .then(() => { addToast("Entry created", "success"); setEntryOpen(false); setMatchId(null); }, (err) => addToast(accountingErrorMessage(err), "error"))
                }
              >
                Post & match
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
