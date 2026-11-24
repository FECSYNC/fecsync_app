"use client";

/**
 * Bank accounts — cash, bank, till, clearing linked to the ledger.
 * List key matches desk prefetch ({ includeArchived: true }) for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
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
  useAccountingLookupsQuery,
  useArchiveBankAccountMutation,
  useBankAccountsQuery,
  useCreateBankAccountMutation,
  usePatchBankAccountMutation,
} from "@/hooks/useAccounting";
import type { BankAccountDto } from "@/services/accounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  LocationPicker,
  MoneyCell,
  MoneyInput,
  StatusChip,
  accountingErrorMessage,
} from "../shared";

const KINDS = [
  { id: "bank", label: "Bank" },
  { id: "cash", label: "Cash" },
  { id: "petty_cash", label: "Petty cash" },
  { id: "till_cash", label: "Till" },
  { id: "payment_clearing", label: "Clearing" },
  { id: "credit_card", label: "Card" },
] as const;

type ViewTab = "active" | "all" | "archived";

const fieldClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50";

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

function kindLabel(kind: string) {
  return kind.replace(/_/g, " ");
}

type FormState = {
  name: string;
  kind: string;
  locationId: string;
  ledgerAccountId: string;
  bankName: string;
  accountLast4: string;
  currency: string;
  openingBalance: string;
  stripeAccountId: string;
  isDefault: boolean;
};

function emptyForm(currency = "USD"): FormState {
  return {
    name: "",
    kind: "bank",
    locationId: "",
    ledgerAccountId: "",
    bankName: "",
    accountLast4: "",
    currency,
    openingBalance: "0.00",
    stripeAccountId: "",
    isDefault: false,
  };
}

export default function BankAccountsPage() {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canRead =
    can(P.AccountingBankingRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canManage = can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const currencyDefault = settings?.baseCurrency ?? "USD";

  /** Matches desk prefetch — instant paint when opening from the rail. */
  const listQuery = useBankAccountsQuery(
    { includeArchived: true },
    canRead
  );
  const createMutation = useCreateBankAccountMutation();
  const patchMutation = usePatchBankAccountMutation();
  const archiveMutation = useArchiveBankAccountMutation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<ViewTab>("active");
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | "new" | BankAccountDto>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(currencyDefault));
  const [saving, setSaving] = useState(false);

  const editorOpen = Boolean(editing);
  /** Venue list for LocationPicker — live while the editor is open. */
  const lookupsWarm = useAccountingLookupsQuery(editorOpen && canManage);

  const allRows = useMemo(() => {
    const data = listQuery.data;
    const list = Array.isArray(data) ? (data as BankAccountDto[]) : [];
    return [...list].sort((a, b) => {
      const aArch = Boolean(a.archivedAt);
      const bArch = Boolean(b.archivedAt);
      if (aArch !== bArch) return aArch ? 1 : -1;
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [listQuery.data]);

  const activeCount = useMemo(
    () => allRows.filter((r) => !r.archivedAt).length,
    [allRows]
  );
  const archivedCount = useMemo(
    () => allRows.filter((r) => Boolean(r.archivedAt)).length,
    [allRows]
  );

  const rows = useMemo(() => {
    if (view === "all") return allRows;
    if (view === "archived") return allRows.filter((r) => Boolean(r.archivedAt));
    return allRows.filter((r) => !r.archivedAt);
  }, [allRows, view]);

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    allRows.length > 0 || listQuery.isFetched
  );

  const formLocked =
    saving ||
    createMutation.isPending ||
    patchMutation.isPending ||
    archiveMutation.isPending;

  useEffect(() => {
    if (!listQuery.isFetching) setManualRefresh(false);
  }, [listQuery.isFetching]);

  useEffect(() => {
    if (!busyRowId) return;
    const t = window.setTimeout(() => setBusyRowId(null), 1200);
    return () => window.clearTimeout(t);
  }, [busyRowId]);

  useEffect(() => {
    if (!editing) return;
    bodyRef.current?.scrollTo({ top: 0 });
    // Focus name after paint so the required field is never scrolled away.
    const t = window.setTimeout(() => {
      nameRef.current?.focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !formLocked) setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [editing, formLocked]);

  const editorLiveMode: "first" | "manual" | "idle" =
    editorOpen && lookupsWarm.isPending && !lookupsWarm.data
      ? "first"
      : editorOpen && lookupsWarm.isFetching
        ? "manual"
        : "idle";

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const warmEditorDeps = useCallback(() => {
    if (!canManage) return;
    void qc.prefetchQuery({
      queryKey: accountingKeys.lookups(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.getAccountingLookups()),
    });
  }, [canManage, qc]);

  const onRefresh = () => {
    setManualRefresh(true);
    void listQuery.refetch();
  };

  const openNew = useCallback(() => {
    setBusyRowId("new");
    warmEditorDeps();
    setForm(emptyForm(currencyDefault));
    setEditing("new");
    window.setTimeout(() => setBusyRowId(null), 0);
  }, [currencyDefault, warmEditorDeps]);

  const openEdit = (b: BankAccountDto) => {
    setBusyRowId(b.id);
    warmEditorDeps();
    setForm({
      name: b.name,
      kind: b.kind,
      locationId: b.locationId ?? "",
      ledgerAccountId: b.ledgerAccountId,
      bankName: b.bankName ?? "",
      accountLast4: b.accountLast4 ?? "",
      currency: b.currency,
      openingBalance: b.openingBalance,
      stripeAccountId: b.stripeAccountId ?? "",
      isDefault: b.isDefault,
    });
    setEditing(b);
    window.setTimeout(() => setBusyRowId(null), 0);
  };

  const closeEditor = () => {
    if (formLocked) return;
    setEditing(null);
  };

  const canSave = form.name.trim().length > 0;

  const save = async () => {
    if (!canManage) return;
    if (!form.name.trim()) {
      addToast("Enter an account name", "error");
      return;
    }
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      locationId: form.locationId || null,
      ledgerAccountId: form.ledgerAccountId || null,
      bankName: form.bankName.trim() || null,
      accountLast4: form.accountLast4.trim() || null,
      currency: form.currency || undefined,
      openingBalance: form.openingBalance,
      stripeAccountId: form.stripeAccountId.trim() || null,
      isDefault: form.isDefault,
    };
    setSaving(true);
    try {
      if (editing === "new") {
        await createMutation.mutateAsync(body);
        addToast("Bank account created", "success");
      } else if (editing && typeof editing === "object") {
        await patchMutation.mutateAsync({ id: editing.id, body });
        addToast("Bank account updated", "success");
      }
      setEditing(null);
      void listQuery.refetch();
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const onArchive = async (b: BankAccountDto) => {
    if (!canManage || b.archivedAt) return;
    setBusyRowId(`archive:${b.id}`);
    try {
      await archiveMutation.mutateAsync(b.id);
      addToast("Bank account archived", "success");
      void listQuery.refetch();
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusyRowId(null);
    }
  };

  const viewTabs: { id: ViewTab; label: string; count: number }[] = [
    { id: "active", label: "Active", count: activeCount },
    { id: "all", label: "All", count: allRows.length },
    { id: "archived", label: "Archived", count: archivedCount },
  ];

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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Bank accounts
                </h1>
                <LivePulse mode={liveMode} />
                {allRows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {activeCount}/{allRows.length} active
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Cash, bank, till, and payment clearing accounts linked to the
                ledger — stays live with Banking, transfers, and payment
                pickers.
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
              {canManage ? (
                <button
                  type="button"
                  disabled={busyRowId === "new" || editing === "new"}
                  onClick={openNew}
                  onMouseEnter={warmEditorDeps}
                  onFocus={warmEditorDeps}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyRowId === "new" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add account
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {listQuery.isError ? (
          <AccountingErrorMessage error={listQuery.error} />
        ) : null}

        <div
          role="tablist"
          aria-label="Bank account views"
          className="flex flex-wrap gap-1 rounded-xl border border-stone-200/80 bg-white p-1 shadow-sm"
        >
          {viewTabs.map((t) => {
            const selected = view === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setView(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  selected
                    ? "bg-[#D4AF37]/15 text-stone-900 ring-1 ring-[#D4AF37]/35"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                    selected
                      ? "bg-white/80 text-stone-700"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Building2 className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {view === "archived"
                  ? "No archived accounts"
                  : view === "all"
                    ? "No bank accounts yet"
                    : "No active bank accounts"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {view === "archived"
                  ? "Archived accounts stay here for history and audits."
                  : "Add an account so receipts, payments, and transfers can settle to the ledger."}
              </p>
              {canManage && view !== "archived" ? (
                <button
                  type="button"
                  disabled={busyRowId === "new" || Boolean(editing)}
                  onClick={openNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyRowId === "new" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add account
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((b) => {
                  const archived = Boolean(b.archivedAt);
                  const archiving = busyRowId === `archive:${b.id}`;
                  const editingRow = busyRowId === b.id;
                  return (
                    <div
                      key={b.id}
                      className={`flex flex-col gap-2 px-4 py-4 ${
                        archived ? "bg-stone-50/60 opacity-80" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-stone-900">
                            {b.name}
                            {b.isDefault ? (
                              <span className="ml-2 rounded-md bg-[#D4AF37]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a7318]">
                                Default
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs capitalize text-stone-500">
                            {kindLabel(b.kind)}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-xs text-stone-500">
                            {[b.ledgerAccountCode, b.ledgerAccountName]
                              .filter(Boolean)
                              .join(" ") || "No ledger link"}
                          </p>
                        </div>
                        <div className="text-right">
                          <MoneyCell
                            value={b.balance ?? b.openingBalance}
                            currency={b.currency || currencyDefault}
                          />
                          <div className="mt-1">
                            <StatusChip
                              status={archived ? "archived" : "active"}
                            />
                          </div>
                        </div>
                      </div>
                      {canManage && !archived ? (
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={editingRow || formLocked}
                            onClick={() => openEdit(b)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8a7318] hover:underline disabled:opacity-60"
                          >
                            {editingRow ? <ButtonSpinner /> : null}
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={archiving || formLocked}
                            onClick={() => void onArchive(b)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline disabled:opacity-60"
                          >
                            {archiving ? <ButtonSpinner /> : null}
                            Archive
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Name</th>
                      <th className="px-4 py-2.5 font-semibold">Kind</th>
                      <th className="px-4 py-2.5 font-semibold">Ledger</th>
                      <th className="px-4 py-2.5 font-semibold">Balance</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => {
                      const archived = Boolean(b.archivedAt);
                      const archiving = busyRowId === `archive:${b.id}`;
                      const editingRow = busyRowId === b.id;
                      return (
                        <tr
                          key={b.id}
                          className={`border-t border-stone-100 transition hover:bg-stone-50/70 ${
                            archived ? "bg-stone-50/40" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5 font-medium text-stone-900">
                            {b.name}
                            {b.isDefault ? (
                              <span className="ml-2 rounded-md bg-[#D4AF37]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a7318]">
                                Default
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 capitalize text-stone-600">
                            {kindLabel(b.kind)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-stone-600">
                            {[b.ledgerAccountCode, b.ledgerAccountName]
                              .filter(Boolean)
                              .join(" ") || "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <MoneyCell
                              value={b.balance ?? b.openingBalance}
                              currency={b.currency || currencyDefault}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip
                              status={archived ? "archived" : "active"}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {canManage && !archived ? (
                              <div className="flex justify-end gap-3">
                                <button
                                  type="button"
                                  disabled={editingRow || formLocked}
                                  onClick={() => openEdit(b)}
                                  className="inline-flex items-center gap-1.5 font-medium text-[#8a7318] hover:underline disabled:opacity-60"
                                >
                                  {editingRow ? <ButtonSpinner /> : null}
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={archiving || formLocked}
                                  onClick={() => void onArchive(b)}
                                  className="inline-flex items-center gap-1.5 font-medium text-red-700 hover:underline disabled:opacity-60"
                                >
                                  {archiving ? <ButtonSpinner /> : null}
                                  Archive
                                </button>
                              </div>
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

        {editing ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              editing === "new" ? "New bank account" : "Edit bank account"
            }
            className="fixed inset-y-0 left-0 right-0 z-[70] flex lg:left-64"
          >
            <button
              type="button"
              aria-label="Close overlay"
              tabIndex={-1}
              className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
              onClick={closeEditor}
            />
            <div className="relative m-auto flex max-h-[min(92vh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-6">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-stone-900">
                      {editing === "new"
                        ? "New bank account"
                        : "Edit bank account"}
                    </h2>
                    <LivePulse mode={editorLiveMode} />
                  </div>
                  <p className="text-xs text-stone-500">
                    Creates a ledger link used by Banking, transfers, and
                    payment pickers
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
                className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5"
              >
                {/* Essentials — always first so Name is never buried */}
                <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Essentials
                  </p>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Name <span className="text-red-600">*</span>
                    </span>
                    <input
                      ref={nameRef}
                      className={fieldClass}
                      disabled={formLocked}
                      placeholder="e.g. Bank operating"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </label>
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-stone-700">
                      Kind
                    </span>
                    <div
                      role="radiogroup"
                      aria-label="Account kind"
                      className="flex flex-wrap gap-1.5"
                    >
                      {KINDS.map((k) => {
                        const selected = form.kind === k.id;
                        const locked = formLocked || editing !== "new";
                        return (
                          <button
                            key={k.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={locked}
                            onClick={() => setForm({ ...form, kind: k.id })}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold capitalize transition disabled:opacity-60 ${
                              selected
                                ? "bg-[#D4AF37] text-white shadow-sm"
                                : "bg-stone-100 text-stone-700 hover:bg-stone-200/80"
                            }`}
                          >
                            {k.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Scope & ledger
                  </p>
                  <LocationPicker
                    value={form.locationId}
                    onChange={(locationId) =>
                      setForm({ ...form, locationId })
                    }
                    label="Venue scope"
                    allowCompanyWide
                    disabled={formLocked}
                  />
                  <AccountPicker
                    value={form.ledgerAccountId}
                    onChange={(ledgerAccountId) =>
                      setForm({ ...form, ledgerAccountId })
                    }
                    types={["asset", "liability"]}
                    label="Ledger account"
                    disabled={formLocked}
                    lazy
                  />
                  <p className="text-xs text-stone-500">
                    Leave blank to auto-create a matching ledger account under
                    Cash &amp; banks.
                  </p>
                </section>

                <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Bank details
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-stone-700">
                        Bank name
                      </span>
                      <input
                        className={fieldClass}
                        disabled={formLocked}
                        placeholder="Optional"
                        value={form.bankName}
                        onChange={(e) =>
                          setForm({ ...form, bankName: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-stone-700">
                        Last 4
                      </span>
                      <input
                        className={fieldClass}
                        disabled={formLocked}
                        placeholder="1234"
                        maxLength={4}
                        inputMode="numeric"
                        value={form.accountLast4}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            accountLast4: e.target.value.replace(/\D/g, ""),
                          })
                        }
                      />
                    </label>
                  </div>
                  <MoneyInput
                    value={form.openingBalance}
                    onChange={(openingBalance) =>
                      setForm({ ...form, openingBalance })
                    }
                    label="Opening balance"
                    currency={form.currency || currencyDefault}
                    disabled={formLocked || editing !== "new"}
                  />
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      disabled={formLocked}
                      onChange={(e) =>
                        setForm({ ...form, isDefault: e.target.checked })
                      }
                      className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                    />
                    Default for payments &amp; receipts
                  </label>
                </section>

                <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    Integrations
                  </p>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Stripe connected account
                    </span>
                    <input
                      className={fieldClass}
                      disabled={formLocked}
                      placeholder="acct_…"
                      value={form.stripeAccountId}
                      onChange={(e) =>
                        setForm({ ...form, stripeAccountId: e.target.value })
                      }
                    />
                  </label>
                </section>

                {!canSave ? (
                  <p className="text-xs text-stone-500">
                    Enter a name to enable Create.
                  </p>
                ) : null}
              </div>

              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
                <p className="text-[11px] text-stone-400">
                  {formLocked ? "Saving to ledger…" : "Esc to close"}
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
                    disabled={!canManage || !canSave || formLocked}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                  >
                    {formLocked ? (
                      <ButtonSpinner />
                    ) : (
                      <Building2 className="h-4 w-4" />
                    )}
                    {formLocked
                      ? editing === "new"
                        ? "Creating…"
                        : "Saving…"
                      : editing === "new"
                        ? "Create account"
                        : "Save changes"}
                  </button>
                </div>
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
