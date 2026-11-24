"use client";

/**
 * Bank transfers — move cash between bank / till / clearing accounts.
 * List key matches desk prefetch ({}) for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  Loader2,
  Plus,
  RefreshCw,
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
  useBankTransfersQuery,
  useCreateBankTransferMutation,
  useVoidBankTransferMutation,
} from "@/hooks/useAccounting";
import type { BankAccountDto } from "@/services/accounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  ConfirmReasonModal,
  MoneyCell,
  MoneyInput,
  StatusChip,
  accountingErrorMessage,
  asItems,
  formatMoney,
  todayIsoDate,
} from "../shared";
import { useAccountingDesk } from "../accountingDesk";

const fieldClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50";

type TransferRow = {
  id: string;
  number?: string | null;
  fromBankAccountId?: string;
  toBankAccountId?: string;
  fromName?: string | null;
  toName?: string | null;
  amount?: string;
  feeAmount?: string;
  transferDate?: string;
  reference?: string | null;
  status?: string;
};

type FormState = {
  fromBankAccountId: string;
  toBankAccountId: string;
  amount: string;
  feeAmount: string;
  transferDate: string;
  reference: string;
};

function emptyForm(): FormState {
  return {
    fromBankAccountId: "",
    toBankAccountId: "",
    amount: "0.00",
    feeAmount: "0.00",
    transferDate: todayIsoDate(),
    reference: "",
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

export default function TransfersPage() {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const can = useAuthStore((s) => s.can);
  const canRead =
    can(P.AccountingBankingRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canWrite =
    can(P.AccountingBankingWrite) || can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  /** Empty filters match desk prefetch. */
  const listQuery = useBankTransfersQuery({}, canRead);
  const createMutation = useCreateBankTransferMutation();
  const voidMutation = useVoidBankTransferMutation();

  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);

  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showFee, setShowFee] = useState(false);
  const [voidTarget, setVoidTarget] = useState<TransferRow | null>(null);
  /** Defer bank picker fetch so hard refresh only hits transfers first. */
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
    const raw = asItems<TransferRow>(listQuery.data, ["transfers", "items"]);
    return [...raw].sort((a, b) =>
      String(b.transferDate ?? "").localeCompare(String(a.transferDate ?? ""))
    );
  }, [listQuery.data]);

  const postedCount = useMemo(
    () => allRows.filter((r) => String(r.status ?? "posted") !== "void").length,
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
    const t = window.setTimeout(() => setBusyRowId(null), 1200);
    return () => window.clearTimeout(t);
  }, [busyRowId]);

  useEffect(() => {
    if (!editorOpen) return;
    bodyRef.current?.scrollTo({ top: 0 });
    const t = window.setTimeout(() => {
      fromRef.current?.focus({ preventScroll: true });
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

  const editorLiveMode: "first" | "manual" | "idle" =
    editorOpen && banksQuery.isPending && !banksQuery.data
      ? "first"
      : editorOpen && banksQuery.isFetching
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
      return;
    }
  };

  const openNew = () => {
    setBusyRowId("new");
    warmBanks();
    const defaultFrom =
      banks.find((b) => b.isDefault)?.id ?? banks[0]?.id ?? "";
    setForm({ ...emptyForm(), fromBankAccountId: defaultFrom });
    setShowFee(false);
    setEditorOpen(true);
    window.setTimeout(() => setBusyRowId(null), 0);
  };

  const closeEditor = () => {
    if (formLocked) return;
    setEditorOpen(false);
  };

  const swapAccounts = () => {
    if (formLocked) return;
    setForm((prev) => ({
      ...prev,
      fromBankAccountId: prev.toBankAccountId,
      toBankAccountId: prev.fromBankAccountId,
    }));
  };

  const canSave =
    Boolean(form.fromBankAccountId) &&
    Boolean(form.toBankAccountId) &&
    form.fromBankAccountId !== form.toBankAccountId &&
    Number(form.amount) > 0;

  const fromBank = banks.find((b) => b.id === form.fromBankAccountId);
  const toBank = banks.find((b) => b.id === form.toBankAccountId);

  const resolveName = (id?: string, name?: string | null) =>
    name || (id ? bankNameById.get(id) : null) || "—";

  const accountOptionLabel = (b: BankAccountDto) => {
    const bal = formatMoney(b.balance ?? b.openingBalance, b.currency || currency);
    const kind = b.kind.replace(/_/g, " ");
    return `${b.name} · ${kind} · ${bal}`;
  };

  const save = async () => {
    if (!canWrite || !canSave) return;
    if (form.fromBankAccountId === form.toBankAccountId) {
      addToast("From and To must be different accounts", "error");
      return;
    }
    setSaving(true);
    try {
      await createMutation.mutateAsync({
        fromBankAccountId: form.fromBankAccountId,
        toBankAccountId: form.toBankAccountId,
        amount: form.amount,
        feeAmount: form.feeAmount || "0",
        transferDate: form.transferDate,
        reference: form.reference.trim() || null,
      });
      addToast("Transfer created", "success");
      setEditorOpen(false);
      void listQuery.refetch();
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmVoid = async (reason: string) => {
    if (!voidTarget || !canWrite) return;
    setBusyRowId(`void:${voidTarget.id}`);
    try {
      await voidMutation.mutateAsync({ id: voidTarget.id, reason });
      addToast("Transfer voided", "success");
      setVoidTarget(null);
      void listQuery.refetch();
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusyRowId(null);
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
                  Transfers
                </h1>
                <LivePulse mode={liveMode} />
                {allRows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {postedCount}/{allRows.length} posted
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Move funds between bank, cash, till, and clearing accounts —
                posts to the ledger and stays live with Banking balances.
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
                  New transfer
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {listQuery.isError ? (
          <AccountingErrorMessage error={listQuery.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : allRows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <ArrowLeftRight className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No transfers yet
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Move cash between accounts when you top up a till, sweep
                clearing, or rebalance operating accounts.
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
                  New transfer
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {allRows.map((t) => {
                  const voided = String(t.status) === "void";
                  const voiding = busyRowId === `void:${t.id}`;
                  return (
                    <div
                      key={t.id}
                      className={`flex flex-col gap-2 px-4 py-4 ${
                        voided ? "bg-stone-50/60 opacity-80" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs tabular-nums text-stone-500">
                            {String(t.transferDate ?? "").slice(0, 10)}
                            {t.number ? ` · ${t.number}` : ""}
                          </p>
                          <p className="mt-0.5 font-semibold text-stone-900">
                            {resolveName(t.fromBankAccountId, t.fromName)}
                            <span className="mx-1.5 font-normal text-stone-400">
                              →
                            </span>
                            {resolveName(t.toBankAccountId, t.toName)}
                          </p>
                          {t.reference ? (
                            <p className="mt-0.5 truncate text-xs text-stone-500">
                              {t.reference}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <MoneyCell value={t.amount} currency={currency} />
                          <div className="mt-1">
                            <StatusChip status={String(t.status ?? "posted")} />
                          </div>
                        </div>
                      </div>
                      {canWrite && !voided ? (
                        <button
                          type="button"
                          disabled={voiding || formLocked}
                          onClick={() => setVoidTarget(t)}
                          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-red-700 hover:underline disabled:opacity-60"
                        >
                          {voiding ? <ButtonSpinner /> : null}
                          Void
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">From</th>
                      <th className="px-4 py-2.5 font-semibold">To</th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        Amount
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.map((t) => {
                      const voided = String(t.status) === "void";
                      const voiding = busyRowId === `void:${t.id}`;
                      return (
                        <tr
                          key={t.id}
                          className={`border-t border-stone-100 transition hover:bg-stone-50/70 ${
                            voided ? "bg-stone-50/40" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5 tabular-nums text-stone-700">
                            {String(t.transferDate ?? "").slice(0, 10)}
                            {t.number ? (
                              <span className="mt-0.5 block text-[11px] text-stone-400">
                                {t.number}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-stone-900">
                            {resolveName(t.fromBankAccountId, t.fromName)}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-stone-900">
                            {resolveName(t.toBankAccountId, t.toName)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell value={t.amount} currency={currency} />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip
                              status={String(t.status ?? "posted")}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {canWrite && !voided ? (
                              <button
                                type="button"
                                disabled={voiding || formLocked}
                                onClick={() => setVoidTarget(t)}
                                className="inline-flex items-center gap-1.5 font-medium text-red-700 hover:underline disabled:opacity-60"
                              >
                                {voiding ? <ButtonSpinner /> : null}
                                Void
                              </button>
                            ) : null}
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
            aria-label="New transfer"
            className="fixed inset-y-0 left-0 right-0 z-[70] flex lg:left-64"
          >
            <button
              type="button"
              aria-label="Close overlay"
              tabIndex={-1}
              className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
              onClick={closeEditor}
            />
            <div className="relative m-auto flex max-h-[min(92vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-6">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-stone-900">
                      New transfer
                    </h2>
                    <LivePulse mode={editorLiveMode} />
                  </div>
                  <p className="text-xs text-stone-500">
                    Posts a journal and updates both bank balances
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
                      Route
                    </p>
                    {banksQuery.isFetching ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-stone-400">
                        <Loader2 className="h-3 w-3 animate-spin text-[#D4AF37]" />
                        Syncing accounts…
                      </span>
                    ) : null}
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1 flex items-center justify-between gap-2 font-medium text-stone-700">
                      <span>
                        From <span className="text-red-600">*</span>
                      </span>
                      {fromBank ? (
                        <span className="text-[11px] font-normal tabular-nums text-stone-500">
                          {formatMoney(
                            fromBank.balance ?? fromBank.openingBalance,
                            fromBank.currency || currency
                          )}
                        </span>
                      ) : null}
                    </span>
                    <select
                      ref={fromRef}
                      className={fieldClass}
                      disabled={formLocked || banksQuery.isLoading}
                      value={form.fromBankAccountId}
                      onChange={(e) =>
                        setForm({ ...form, fromBankAccountId: e.target.value })
                      }
                    >
                      <option value="">Select account…</option>
                      {banks.map((b) => (
                        <option
                          key={b.id}
                          value={b.id}
                          disabled={b.id === form.toBankAccountId}
                        >
                          {accountOptionLabel(b)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      disabled={
                        formLocked ||
                        (!form.fromBankAccountId && !form.toBankAccountId)
                      }
                      onClick={swapAccounts}
                      title="Swap From and To"
                      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600 transition hover:border-[#D4AF37]/50 hover:bg-[#D4AF37]/10 hover:text-stone-900 disabled:opacity-50"
                    >
                      <ArrowDownUp className="h-3.5 w-3.5" />
                      Swap
                    </button>
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1 flex items-center justify-between gap-2 font-medium text-stone-700">
                      <span>
                        To <span className="text-red-600">*</span>
                      </span>
                      {toBank ? (
                        <span className="text-[11px] font-normal tabular-nums text-stone-500">
                          {formatMoney(
                            toBank.balance ?? toBank.openingBalance,
                            toBank.currency || currency
                          )}
                        </span>
                      ) : null}
                    </span>
                    <select
                      className={fieldClass}
                      disabled={formLocked || banksQuery.isLoading}
                      value={form.toBankAccountId}
                      onChange={(e) =>
                        setForm({ ...form, toBankAccountId: e.target.value })
                      }
                    >
                      <option value="">Select account…</option>
                      {banks.map((b) => (
                        <option
                          key={b.id}
                          value={b.id}
                          disabled={b.id === form.fromBankAccountId}
                        >
                          {accountOptionLabel(b)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {banksQuery.isLoading ? (
                    <p className="text-xs text-stone-500">
                      Loading bank accounts…
                    </p>
                  ) : banks.length < 2 ? (
                    <p className="text-xs text-amber-700">
                      You need at least two active bank accounts to transfer.
                    </p>
                  ) : null}
                </section>

                <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Amount &amp; date
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MoneyInput
                      value={form.amount}
                      onChange={(amount) => setForm({ ...form, amount })}
                      label="Amount"
                      currency={currency}
                      disabled={formLocked}
                      required
                    />
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-stone-700">
                        Transfer date
                      </span>
                      <input
                        type="date"
                        className={fieldClass}
                        disabled={formLocked}
                        value={form.transferDate}
                        onChange={(e) =>
                          setForm({ ...form, transferDate: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Reference
                    </span>
                    <input
                      className={fieldClass}
                      disabled={formLocked}
                      placeholder="Optional memo"
                      value={form.reference}
                      onChange={(e) =>
                        setForm({ ...form, reference: e.target.value })
                      }
                    />
                  </label>
                  {!showFee ? (
                    <button
                      type="button"
                      disabled={formLocked}
                      onClick={() => setShowFee(true)}
                      className="text-xs font-medium text-[#8a7318] hover:underline disabled:opacity-60"
                    >
                      + Add fee
                    </button>
                  ) : (
                    <MoneyInput
                      value={form.feeAmount}
                      onChange={(feeAmount) =>
                        setForm({ ...form, feeAmount })
                      }
                      label="Fee (optional)"
                      currency={currency}
                      disabled={formLocked}
                    />
                  )}
                </section>

                {canSave && fromBank && toBank ? (
                  <p className="rounded-xl bg-[#D4AF37]/10 px-3 py-2 text-xs text-stone-700 ring-1 ring-[#D4AF37]/25">
                    Move{" "}
                    <span className="font-semibold tabular-nums">
                      {formatMoney(form.amount, currency)}
                    </span>{" "}
                    from <span className="font-semibold">{fromBank.name}</span>{" "}
                    → <span className="font-semibold">{toBank.name}</span>
                  </p>
                ) : (
                  <p className="text-xs text-stone-500">
                    Choose two different accounts and an amount greater than
                    zero.
                  </p>
                )}
              </div>

              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
                <p className="text-[11px] text-stone-400">
                  {formLocked ? "Posting transfer…" : "Esc to close"}
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
                  <button
                    type="button"
                    disabled={!canWrite || !canSave || formLocked}
                    onClick={() => void save()}
                    className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                  >
                    {formLocked ? (
                      <ButtonSpinner />
                    ) : (
                      <ArrowLeftRight className="h-4 w-4" />
                    )}
                    {formLocked ? "Creating…" : "Create transfer"}
                  </button>
                </div>
              </footer>
            </div>
          </div>
        ) : null}

        <ConfirmReasonModal
          open={Boolean(voidTarget)}
          title="Void transfer"
          message={
            voidTarget
              ? `Reverse ${resolveName(voidTarget.fromBankAccountId, voidTarget.fromName)} → ${resolveName(voidTarget.toBankAccountId, voidTarget.toName)} (${voidTarget.amount ?? "0.00"}). This posts a reversing journal.`
              : undefined
          }
          confirmLabel="Void transfer"
          requireReason
          reasonLabel="Reason"
          reasonMin={3}
          busy={voidMutation.isPending || Boolean(busyRowId?.startsWith("void:"))}
          onClose={() => {
            if (!voidMutation.isPending) setVoidTarget(null);
          }}
          onConfirm={confirmVoid}
        />
      </div>
    </AccountingGate>
  );
}
