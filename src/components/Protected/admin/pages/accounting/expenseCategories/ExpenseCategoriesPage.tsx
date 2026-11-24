"use client";

/**
 * Expense categories — map claims to ledger accounts + default tax.
 * List key matches desk prefetch ({ includeInactive: true }) for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FolderTree,
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
  useAccountingAccountsQuery,
  useAccountingTaxCodesQuery,
  useCreateExpenseCategoryMutation,
  useExpenseCategoriesQuery,
  usePatchExpenseCategoryMutation,
} from "@/hooks/useAccounting";
import type { ExpenseCategoryDto } from "@/services/accounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  StatusChip,
  TaxCodePicker,
  accountingErrorMessage,
} from "../shared";

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

type FormState = {
  name: string;
  ledgerAccountId: string;
  defaultTaxCodeId: string;
  isActive: boolean;
  sortOrder: string;
};

const emptyForm = (sortOrder = "0"): FormState => ({
  name: "",
  ledgerAccountId: "",
  defaultTaxCodeId: "",
  isActive: true,
  sortOrder,
});

export default function ExpenseCategoriesPage() {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.AccountingManage);
  const listQuery = useExpenseCategoriesQuery({ includeInactive: true });
  const createMutation = useCreateExpenseCategoryMutation();
  const patchMutation = usePatchExpenseCategoryMutation();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | "new" | ExpenseCategoryDto>(
    null
  );
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  /** Warm chart + tax while the editor is open (and keep them live). */
  const editorOpen = Boolean(editing);
  const accountsWarm = useAccountingAccountsQuery({}, editorOpen && canManage);
  const taxWarm = useAccountingTaxCodesQuery({}, editorOpen && canManage);

  const rows = useMemo(() => {
    const data = listQuery.data;
    const list = Array.isArray(data) ? data : [];
    return [...list].sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
    );
  }, [listQuery.data]);

  const activeCount = useMemo(
    () => rows.filter((r) => r.isActive).length,
    [rows]
  );

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    rows.length > 0 || listQuery.isFetched
  );

  const formLocked =
    saving || createMutation.isPending || patchMutation.isPending;

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
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !formLocked) setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, formLocked]);

  const editorLiveMode: "first" | "manual" | "idle" =
    editorOpen &&
    ((accountsWarm.isPending && !accountsWarm.data) ||
      (taxWarm.isPending && !taxWarm.data))
      ? "first"
      : editorOpen && (accountsWarm.isFetching || taxWarm.isFetching)
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
      queryKey: accountingKeys.accounts(),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listAccountingAccounts()
        ),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.taxCodes({}),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listAccountingTaxCodes({})
        ),
    });
  }, [canManage, qc]);

  const onRefresh = () => {
    setManualRefresh(true);
    void listQuery.refetch();
  };

  const openNew = useCallback(() => {
    setBusyRowId("new");
    warmEditorDeps();
    setForm(emptyForm(String(rows.length)));
    setEditing("new");
    window.setTimeout(() => setBusyRowId(null), 0);
  }, [rows.length, warmEditorDeps]);

  const openEdit = (c: ExpenseCategoryDto) => {
    setBusyRowId(c.id);
    warmEditorDeps();
    setForm({
      name: c.name,
      ledgerAccountId: c.ledgerAccountId,
      defaultTaxCodeId: c.defaultTaxCodeId ?? "",
      isActive: c.isActive,
      sortOrder: String(c.sortOrder ?? 0),
    });
    setEditing(c);
    window.setTimeout(() => setBusyRowId(null), 0);
  };

  const closeEditor = () => {
    if (formLocked) return;
    setEditing(null);
  };

  const canSave =
    form.name.trim().length > 0 && Boolean(form.ledgerAccountId);

  const save = async () => {
    if (!canManage) return;
    if (!form.name.trim()) {
      addToast("Enter a category name", "error");
      return;
    }
    if (!form.ledgerAccountId) {
      addToast("Select an expense account", "error");
      return;
    }
    const body = {
      name: form.name.trim(),
      ledgerAccountId: form.ledgerAccountId,
      defaultTaxCodeId: form.defaultTaxCodeId || null,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
    };
    setSaving(true);
    try {
      if (editing === "new") {
        await createMutation.mutateAsync(body);
        addToast("Category created", "success");
      } else if (editing && typeof editing === "object") {
        await patchMutation.mutateAsync({ id: editing.id, body });
        addToast("Category updated", "success");
      }
      setEditing(null);
      void listQuery.refetch();
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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Expense categories
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {activeCount}/{rows.length} active
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Map staff expense categories to ledger accounts and default tax
                codes — stays live with New expense pickers.
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
                  Add category
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
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <FolderTree className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No expense categories yet
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Add categories so staff can file claims against the right ledger
                account.
              </p>
              {canManage ? (
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
                  Add category
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((c) => (
                  <div
                    key={c.id}
                    className={`flex flex-col gap-2 px-4 py-4 ${
                      c.isActive ? "" : "bg-stone-50/60 opacity-80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-900">{c.name}</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-stone-500">
                          {[c.ledgerAccountCode, c.ledgerAccountName]
                            .filter(Boolean)
                            .join(" ") || "No account"}
                        </p>
                      </div>
                      <StatusChip
                        status={c.isActive ? "active" : "archived"}
                      />
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={busyRowId === c.id || formLocked}
                        onClick={() => openEdit(c)}
                        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-[#8a7318] hover:underline disabled:opacity-60"
                      >
                        {busyRowId === c.id ? <ButtonSpinner /> : null}
                        Edit
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Name</th>
                      <th className="px-4 py-2.5 font-semibold">Account</th>
                      <th className="px-4 py-2.5 font-semibold">Tax</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-t border-stone-100 transition hover:bg-stone-50/70 ${
                          c.isActive ? "" : "bg-stone-50/40"
                        }`}
                      >
                        <td className="px-4 py-2.5 font-medium text-stone-900">
                          {c.name}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-stone-600">
                          {[c.ledgerAccountCode, c.ledgerAccountName]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-2.5 text-stone-600">
                          {c.defaultTaxCodeLabel || "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusChip
                            status={c.isActive ? "active" : "archived"}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canManage ? (
                            <button
                              type="button"
                              disabled={busyRowId === c.id || formLocked}
                              onClick={() => openEdit(c)}
                              className="inline-flex items-center gap-1.5 font-medium text-[#8a7318] hover:underline disabled:opacity-60"
                            >
                              {busyRowId === c.id ? <ButtonSpinner /> : null}
                              Edit
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
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
              editing === "new"
                ? "New expense category"
                : "Edit expense category"
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
            <div className="relative m-auto flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-6">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-stone-900">
                      {editing === "new"
                        ? "New expense category"
                        : "Edit expense category"}
                    </h2>
                    <LivePulse mode={editorLiveMode} />
                  </div>
                  <p className="text-xs text-stone-500">
                    Linked to New expense pickers across the desk
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
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-stone-700">
                    Name <span className="text-red-600">*</span>
                  </span>
                  <input
                    className={fieldClass}
                    disabled={formLocked}
                    placeholder="e.g. Travel"
                    autoFocus={editing === "new"}
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                  />
                </label>
                <AccountPicker
                  value={form.ledgerAccountId}
                  onChange={(ledgerAccountId) =>
                    setForm({ ...form, ledgerAccountId })
                  }
                  types={["expense", "asset"]}
                  label="Expense account"
                  required
                  disabled={formLocked}
                />
                <TaxCodePicker
                  value={form.defaultTaxCodeId}
                  onChange={(defaultTaxCodeId) =>
                    setForm({ ...form, defaultTaxCodeId })
                  }
                  label="Default tax code"
                  disabled={formLocked}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Sort order
                    </span>
                    <input
                      type="number"
                      className={fieldClass}
                      disabled={formLocked}
                      value={form.sortOrder}
                      onChange={(e) =>
                        setForm({ ...form, sortOrder: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      disabled={formLocked}
                      onChange={(e) =>
                        setForm({ ...form, isActive: e.target.checked })
                      }
                      className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                    />
                    Active (shown on New expense)
                  </label>
                </div>
                {!canSave ? (
                  <p className="text-xs text-stone-500">
                    Enter a name and choose an expense account to enable Create.
                  </p>
                ) : null}
              </div>
              <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
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
                  {formLocked ? <ButtonSpinner /> : <FolderTree className="h-4 w-4" />}
                  {formLocked
                    ? "Saving…"
                    : editing === "new"
                      ? "Create category"
                      : "Save changes"}
                </button>
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
