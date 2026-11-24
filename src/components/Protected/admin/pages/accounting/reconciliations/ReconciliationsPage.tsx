"use client";

/**
 * Bank reconciliations — statement history per account.
 * Default list key matches desk prefetch ({}) for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  accountingKeys,
  useAccountingInitialized,
  useBankAccountsQuery,
  useCreateReconciliationMutation,
  useReconciliationsQuery,
} from "@/hooks/useAccounting";
import type { BankAccountDto } from "@/services/accounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  MoneyInput,
  StatusChip,
  accountingErrorMessage,
  asItems,
  formatMoney,
  todayIsoDate,
  unwrapEntity,
} from "../shared";
import { useAccountingDesk } from "../accountingDesk";

const fieldClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50";

type ReconRow = {
  id: string;
  number?: string;
  bankAccountId?: string;
  bankAccountName?: string | null;
  statementDate?: string;
  statementEndingBalance?: string;
  difference?: string;
  status?: string;
};

type FormState = {
  bankAccountId: string;
  statementDate: string;
  statementEndingBalance: string;
};

function emptyForm(defaultBank = ""): FormState {
  return {
    bankAccountId: defaultBank,
    statementDate: todayIsoDate(),
    statementEndingBalance: "0.00",
  };
}

function LivePulse({ mode }: { mode: "first" | "manual" | "idle" }) {
  const active = mode !== "idle";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
          : "bg-stone-50 text-stone-500 ring-1 ring-stone-200/80"
      }`}
      title="Quiet live sync in the background — does not block the page"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "animate-pulse bg-emerald-500" : "bg-emerald-400"
        }`}
      />
      {mode === "first"
        ? "Loading…"
        : mode === "manual"
          ? "Updating…"
          : "Live"}
    </span>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

export default function ReconciliationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canRead =
    can(P.AccountingBankingRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canWrite =
    can(P.AccountingBankingWrite) || can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const [bankAccountId, setBankAccountId] = useState("");
  /** Keep default filter `{}` identical to desk prefetch for instant paint. */
  const listFilters = useMemo(
    () => (bankAccountId ? { bankAccountId } : {}),
    [bankAccountId]
  );

  const listQuery = useReconciliationsQuery(listFilters, canRead);
  const createMutation = useCreateReconciliationMutation();

  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bankSelectRef = useRef<HTMLSelectElement>(null);

  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  /** Defer bank picker fetch so hard refresh only hits reconciliations first. */
  const [banksReady, setBanksReady] = useState(false);

  useEffect(() => {
    if (editorOpen) {
      setBanksReady(true);
      return;
    }
    const t = window.setTimeout(() => setBanksReady(true), 2000);
    return () => window.clearTimeout(t);
  }, [editorOpen]);

  const banksQuery = useBankAccountsQuery(
    {},
    canRead && (banksReady || editorOpen)
  );

  const banks = useMemo(
    () =>
      ((banksQuery.data ?? []) as BankAccountDto[]).filter(
        (b) => !b.archivedAt && b.isActive !== false
      ),
    [banksQuery.data]
  );

  const bankNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of banksQuery.data ?? []) m.set(b.id, b.name);
    return m;
  }, [banksQuery.data]);

  const allRows = useMemo(() => {
    const raw = asItems<ReconRow>(listQuery.data, [
      "reconciliations",
      "items",
    ]);
    return [...raw].sort((a, b) =>
      String(b.statementDate ?? "").localeCompare(String(a.statementDate ?? ""))
    );
  }, [listQuery.data]);

  const inProgressCount = useMemo(
    () => allRows.filter((r) => String(r.status) === "in_progress").length,
    [allRows]
  );

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    allRows.length > 0 || listQuery.isFetched
  );

  const formLocked = saving || createMutation.isPending;

  useEffect(() => {
    if (!listQuery.isFetching) setManualRefresh(false);
  }, [listQuery.isFetching]);

  useEffect(() => {
    if (!busyRowId) return;
    const t = window.setTimeout(() => setBusyRowId(null), 1600);
    return () => window.clearTimeout(t);
  }, [busyRowId]);

  useEffect(() => {
    if (!editorOpen) return;
    bodyRef.current?.scrollTo({ top: 0 });
    const t = window.setTimeout(() => {
      bankSelectRef.current?.focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !formLocked) setEditorOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [editorOpen, formLocked]);

  /** Only pulse while the picker has no cached rows — quiet live refetch stays "Live". */
  const editorLiveMode: "first" | "manual" | "idle" =
    editorOpen && !banksQuery.data && banksQuery.isPending
      ? "first"
      : editorOpen && !banksQuery.data && banksQuery.isFetching
        ? "manual"
        : "idle";

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const warmBanks = useCallback(() => {
    void qc.prefetchQuery({
      queryKey: accountingKeys.bankAccounts({}),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.listBankAccounts({})),
    });
  }, [qc]);

  const onRefresh = () => {
    setManualRefresh(true);
    void listQuery.refetch();
    void banksQuery.refetch();
  };

  const goBanking = () => {
    setBusyRowId("banking");
    if (desk) {
      desk.openPanel("banking");
      window.setTimeout(() => setBusyRowId(null), 180);
    }
  };

  const openNew = () => {
    setBusyRowId("new");
    setBanksReady(true);
    warmBanks();
    const defaultBank =
      banks.find((b) => b.id === bankAccountId) ||
      banks.find((b) => b.isDefault) ||
      banks[0] ||
      null;
    const next = emptyForm(defaultBank?.id ?? "");
    if (defaultBank) {
      next.statementEndingBalance = String(
        defaultBank.balance ?? defaultBank.openingBalance ?? "0.00"
      );
    }
    setForm(next);
    setEditorOpen(true);
    window.setTimeout(() => setBusyRowId(null), 0);
  };

  const closeEditor = () => {
    if (formLocked) return;
    setEditorOpen(false);
  };

  const selectedBank = banks.find((b) => b.id === form.bankAccountId);

  const existingInProgress = useMemo(() => {
    if (!form.bankAccountId) return null;
    return (
      allRows.find(
        (r) =>
          r.bankAccountId === form.bankAccountId &&
          String(r.status) === "in_progress"
      ) ?? null
    );
  }, [allRows, form.bankAccountId]);

  const openingHint = useMemo(() => {
    if (!form.bankAccountId) return null;
    const completed = allRows
      .filter(
        (r) =>
          r.bankAccountId === form.bankAccountId &&
          String(r.status) === "completed"
      )
      .sort((a, b) =>
        String(b.statementDate ?? "").localeCompare(
          String(a.statementDate ?? "")
        )
      );
    const last = completed[0];
    if (last?.statementEndingBalance != null) {
      return {
        label: `Opens from last statement (${String(last.statementDate ?? "").slice(0, 10)})`,
        amount: String(last.statementEndingBalance),
      };
    }
    if (selectedBank) {
      return {
        label: "Opens from account opening balance",
        amount: String(
          selectedBank.lastReconciledBalance ??
            selectedBank.openingBalance ??
            "0.00"
        ),
      };
    }
    return null;
  }, [allRows, form.bankAccountId, selectedBank]);

  const canSave =
    Boolean(form.bankAccountId) &&
    Boolean(form.statementDate) &&
    !existingInProgress;

  const resolveBankName = (r: ReconRow) =>
    r.bankAccountName ||
    (r.bankAccountId ? bankNameById.get(r.bankAccountId) : null) ||
    "—";

  const accountOptionLabel = (b: BankAccountDto) => {
    const bal = formatMoney(
      b.balance ?? b.openingBalance,
      b.currency || currency
    );
    return `${b.name} · ${bal}`;
  };

  const onSelectBank = (id: string) => {
    const bank = banks.find((b) => b.id === id);
    setForm((prev) => ({
      ...prev,
      bankAccountId: id,
      // Seed ending balance from ledger balance — operator edits to statement.
      statementEndingBalance:
        prev.bankAccountId === id
          ? prev.statementEndingBalance
          : String(bank?.balance ?? bank?.openingBalance ?? "0.00"),
    }));
  };

  const openDetail = (id: string) => {
    setBusyRowId(id);
    router.prefetch(`/admin/accounting/reconciliations/${id}`);
    router.push(`/admin/accounting/reconciliations/${id}`);
  };

  const resumeInProgress = () => {
    if (!existingInProgress) return;
    setEditorOpen(false);
    openDetail(existingInProgress.id);
  };

  const save = async () => {
    if (!canWrite || !canSave) return;
    if (existingInProgress) {
      resumeInProgress();
      return;
    }
    setSaving(true);
    try {
      const result = await createMutation.mutateAsync({
        bankAccountId: form.bankAccountId,
        statementDate: form.statementDate,
        statementEndingBalance: form.statementEndingBalance,
      });
      const rec = unwrapEntity<{ id?: string }>(result, ["reconciliation"]);
      const id = String(rec.id ?? "");
      addToast("Reconciliation started", "success");
      setEditorOpen(false);
      void listQuery.refetch();
      if (id) {
        setBusyRowId(id);
        router.push(`/admin/accounting/reconciliations/${id}`);
      }
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccountingGate>
      <div className="space-y-5">
        <header className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.16),_transparent_55%),linear-gradient(180deg,#fff_0%,#fafaf9_100%)]"
          />
          <div className="relative flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0">
              <button
                type="button"
                disabled={busyRowId === "banking"}
                onClick={goBanking}
                className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-[#8a7318] hover:underline disabled:opacity-60"
              >
                {busyRowId === "banking" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Banking
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Reconciliations
                </h1>
                <LivePulse mode={liveMode} />
                {allRows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {inProgressCount} in progress · {allRows.length} total
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Match statement ending balances to the ledger — stays live with
                Banking last-reconciled dates.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={manualRefresh || blocking}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
              >
                {manualRefresh ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-stone-500" />
                )}
                {manualRefresh ? "Refreshing…" : "Refresh"}
              </button>
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyRowId === "new" || editorOpen}
                  onClick={openNew}
                  onMouseEnter={warmBanks}
                  onFocus={warmBanks}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyRowId === "new" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Start reconciliation
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-stone-600">Account</label>
          <select
            className="min-w-[12rem] rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            <option value="">All accounts</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {listQuery.isError ? (
          <AccountingErrorMessage error={listQuery.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : allRows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Scale className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {bankAccountId
                  ? "No reconciliations for this account"
                  : "No reconciliations yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Start a reconciliation when you receive a bank statement — tick
                cleared lines until the difference is zero.
              </p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyRowId === "new" || editorOpen}
                  onClick={openNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyRowId === "new" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Start reconciliation
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {allRows.map((r) => {
                  const opening = busyRowId === r.id;
                  const diffZero = Number(r.difference) === 0;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={opening}
                      onClick={() => openDetail(r.id)}
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50/80 disabled:opacity-70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {opening ? (
                              <span className="inline-flex items-center gap-1.5">
                                <ButtonSpinner /> Opening…
                              </span>
                            ) : (
                              String(r.number ?? "—")
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-stone-500">
                            {resolveBankName(r)} ·{" "}
                            {String(r.statementDate ?? "").slice(0, 10)}
                          </p>
                        </div>
                        <StatusChip status={String(r.status ?? "in_progress")} />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-stone-500">Ending</span>
                        <MoneyCell
                          value={r.statementEndingBalance}
                          currency={currency}
                        />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-stone-500">Difference</span>
                        <MoneyCell
                          value={r.difference}
                          currency={currency}
                          className={
                            diffZero ? "text-emerald-700" : "text-amber-700"
                          }
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Number</th>
                      <th className="px-4 py-2.5 font-semibold">Account</th>
                      <th className="px-4 py-2.5 font-semibold">
                        Statement date
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        Ending balance
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        Difference
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.map((r) => {
                      const opening = busyRowId === r.id;
                      const diffZero = Number(r.difference) === 0;
                      return (
                        <tr
                          key={r.id}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={opening}
                              onClick={() => openDetail(r.id)}
                              onMouseEnter={() =>
                                router.prefetch(
                                  `/admin/accounting/reconciliations/${r.id}`
                                )
                              }
                              className="inline-flex items-center gap-1.5 font-medium text-[#8a7318] hover:underline disabled:opacity-60"
                            >
                              {opening ? <ButtonSpinner /> : null}
                              {String(r.number ?? "—")}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-stone-700">
                            {resolveBankName(r)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-stone-700">
                            {String(r.statementDate ?? "").slice(0, 10)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={r.statementEndingBalance}
                              currency={currency}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={r.difference}
                              currency={currency}
                              className={
                                diffZero
                                  ? "text-emerald-700"
                                  : "text-amber-700"
                              }
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip
                              status={String(r.status ?? "in_progress")}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {editorOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Start reconciliation"
            className="fixed inset-y-0 left-0 right-0 z-[70] flex lg:left-64"
          >
            <button
              type="button"
              aria-label="Close overlay"
              tabIndex={-1}
              className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
              onClick={closeEditor}
            />
            <div className="relative m-auto flex max-h-[min(92vh,620px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-6">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-stone-900">
                      Start reconciliation
                    </h2>
                    <LivePulse mode={editorLiveMode} />
                  </div>
                  <p className="text-xs text-stone-500">
                    Opens the worksheet to clear ledger lines against the
                    statement
                  </p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  disabled={formLocked}
                  onClick={closeEditor}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-60"
                >
                  {formLocked ? <ButtonSpinner /> : <X className="h-4 w-4" />}
                  Close
                </button>
              </header>

              <div
                ref={bodyRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5"
              >
                <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      Statement
                    </p>
                    {!banksQuery.data && banksQuery.isFetching ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-stone-400">
                        <Loader2 className="h-3 w-3 animate-spin text-[#D4AF37]" />
                        Loading accounts…
                      </span>
                    ) : null}
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1 flex items-center justify-between gap-2 font-medium text-stone-700">
                      <span>
                        Bank account <span className="text-red-600">*</span>
                      </span>
                      {selectedBank ? (
                        <span className="text-[11px] font-normal tabular-nums text-stone-500">
                          {formatMoney(
                            selectedBank.balance ?? selectedBank.openingBalance,
                            selectedBank.currency || currency
                          )}
                        </span>
                      ) : null}
                    </span>
                    <select
                      ref={bankSelectRef}
                      className={fieldClass}
                      disabled={formLocked || (!banks.length && banksQuery.isLoading)}
                      value={form.bankAccountId}
                      onChange={(e) => onSelectBank(e.target.value)}
                    >
                      <option value="">Select account…</option>
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {accountOptionLabel(b)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedBank?.lastReconciledAt ? (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600 ring-1 ring-stone-200/80">
                      Last reconciled{" "}
                      <span className="font-medium tabular-nums">
                        {String(selectedBank.lastReconciledAt).slice(0, 10)}
                      </span>
                      {selectedBank.lastReconciledBalance != null ? (
                        <>
                          {" "}
                          at{" "}
                          <span className="font-semibold tabular-nums">
                            {formatMoney(
                              selectedBank.lastReconciledBalance,
                              selectedBank.currency || currency
                            )}
                          </span>
                        </>
                      ) : null}
                    </p>
                  ) : null}

                  {openingHint ? (
                    <p className="text-xs text-stone-500">
                      {openingHint.label}:{" "}
                      <span className="font-semibold tabular-nums text-stone-700">
                        {formatMoney(openingHint.amount, currency)}
                      </span>
                    </p>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-stone-700">
                        Statement date <span className="text-red-600">*</span>
                      </span>
                      <input
                        type="date"
                        className={fieldClass}
                        disabled={formLocked || Boolean(existingInProgress)}
                        value={form.statementDate}
                        onChange={(e) =>
                          setForm({ ...form, statementDate: e.target.value })
                        }
                      />
                    </label>
                    <MoneyInput
                      value={form.statementEndingBalance}
                      onChange={(statementEndingBalance) =>
                        setForm({ ...form, statementEndingBalance })
                      }
                      label="Ending balance"
                      currency={
                        selectedBank?.currency || currency
                      }
                      disabled={formLocked || Boolean(existingInProgress)}
                      required
                    />
                  </div>

                  {existingInProgress ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                      <p className="font-medium">
                        {existingInProgress.number} is already in progress for
                        this account.
                      </p>
                      <p className="mt-1 text-xs text-amber-800/90">
                        Finish or reopen that worksheet before starting another.
                      </p>
                      <button
                        type="button"
                        disabled={busyRowId === existingInProgress.id}
                        onClick={resumeInProgress}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#c4a030] disabled:opacity-70"
                      >
                        {busyRowId === existingInProgress.id ? (
                          <ButtonSpinner />
                        ) : (
                          <Scale className="h-3.5 w-3.5" />
                        )}
                        Open worksheet
                      </button>
                    </div>
                  ) : null}

                  {!banks.length && !banksQuery.isLoading ? (
                    <p className="text-xs text-amber-700">
                      Add a bank account before starting a reconciliation.
                    </p>
                  ) : null}
                </section>

                {canSave && selectedBank ? (
                  <p className="rounded-xl bg-[#D4AF37]/10 px-3 py-2 text-xs text-stone-700 ring-1 ring-[#D4AF37]/25">
                    Reconcile{" "}
                    <span className="font-semibold">{selectedBank.name}</span>{" "}
                    to{" "}
                    <span className="font-semibold tabular-nums">
                      {formatMoney(form.statementEndingBalance, currency)}
                    </span>{" "}
                    as of{" "}
                    <span className="font-semibold tabular-nums">
                      {form.statementDate}
                    </span>
                  </p>
                ) : existingInProgress ? null : (
                  <p className="text-xs text-stone-500">
                    Choose an account and statement date to continue.
                  </p>
                )}
              </div>

              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
                <p className="text-[11px] text-stone-400">
                  {formLocked
                    ? "Opening worksheet…"
                    : busyRowId && existingInProgress
                      ? "Opening…"
                      : "Esc to close"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={formLocked}
                    onClick={closeEditor}
                    className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  {existingInProgress ? (
                    <button
                      type="button"
                      disabled={busyRowId === existingInProgress.id}
                      onClick={resumeInProgress}
                      className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                    >
                      {busyRowId === existingInProgress.id ? (
                        <ButtonSpinner />
                      ) : (
                        <Scale className="h-4 w-4" />
                      )}
                      Open worksheet
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!canWrite || !canSave || formLocked}
                      onClick={() => void save()}
                      className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                    >
                      {formLocked ? (
                        <ButtonSpinner />
                      ) : (
                        <Scale className="h-4 w-4" />
                      )}
                      {formLocked ? "Starting…" : "Start"}
                    </button>
                  )}
                </div>
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
