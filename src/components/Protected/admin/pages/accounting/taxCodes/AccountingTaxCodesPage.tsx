"use client";

/**
 * Tax codes — ledger tax rates and accounts.
 * Default `includeInactive: true` matches desk prefetch for split-second open.
 * SALES mirrors checkout Tax settings (synced).
 */

import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Tags,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingTaxCodesQuery,
  useCreateTaxCodeMutation,
  usePatchTaxCodeMutation,
  useSyncTaxCodesMutation,
} from "@/hooks/useAccounting";
import type { TaxCodeDto } from "@/services/accounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  StatusChip,
  accountingErrorMessage,
} from "../shared";

const TaxSettingsPage = lazy(
  () =>
    import("@/components/Protected/admin/pages/tax-settings/TaxSettingsPage")
);

type FormState = {
  code: string;
  name: string;
  rate: string;
  kind: string;
  salesTaxAccountId: string;
  purchaseTaxAccountId: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  rate: "0",
  kind: "output",
  salesTaxAccountId: "",
  purchaseTaxAccountId: "",
  isActive: true,
};

const KIND_LABELS: Record<string, string> = {
  output: "Output (sales)",
  input: "Input (purchases)",
  both: "Both",
  exempt: "Exempt",
  zero_rated: "Zero rated",
};

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
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

function formatRate(rate: string) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return `${rate}%`;
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })}%`;
}

export default function AccountingTaxCodesPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canManage = can(P.AccountingManage);
  const canRead = canManage || can(P.AccountingRead);
  const canTaxSettings = can(P.TaxManage) || canManage;

  const listQuery = useAccountingTaxCodesQuery(
    { includeInactive: true },
    canRead
  );
  const createMutation = useCreateTaxCodeMutation();
  const patchMutation = usePatchTaxCodeMutation();
  const syncMutation = useSyncTaxCodesMutation();

  const [editing, setEditing] = useState<null | "new" | TaxCodeDto>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [busyNew, setBusyNew] = useState(false);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [busySettings, setBusySettings] = useState(false);

  const rows = listQuery.data ?? [];
  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    rows.length > 0 || listQuery.isFetched
  );

  useEffect(() => {
    if (!listQuery.isFetching) setManualRefresh(false);
  }, [listQuery.isFetching]);

  useEffect(() => {
    if (!busyRowId && !busyNew) return;
    const t = window.setTimeout(() => {
      setBusyRowId(null);
      setBusyNew(false);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [busyRowId, busyNew]);

  useEffect(() => {
    if (!editing && !settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (createMutation.isPending || patchMutation.isPending) return;
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    editing,
    settingsOpen,
    createMutation.isPending,
    patchMutation.isPending,
  ]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (!showInactive && !t.isActive) return false;
      if (!needle) return true;
      return (
        t.code.toLowerCase().includes(needle) ||
        t.name.toLowerCase().includes(needle) ||
        t.kind.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, showInactive]);

  const activeCount = rows.filter((t) => t.isActive).length;
  const syncedCount = rows.filter((t) => t.syncedFromTaxSettings).length;
  const saving = createMutation.isPending || patchMutation.isPending;
  const syncedEditing =
    typeof editing === "object" && editing?.syncedFromTaxSettings === true;

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || syncMutation.isPending || saving
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void listQuery.refetch();
  };

  const openSettings = () => {
    setBusySettings(true);
    setSettingsMounted(true);
    setSettingsOpen(true);
    try {
      prefetchAdminRoute(qc, "/admin/tax-settings", can, user);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => setBusySettings(false), 200);
  };

  const openNew = () => {
    setBusyNew(true);
    setForm(EMPTY_FORM);
    setEditing("new");
  };

  const openEdit = (t: TaxCodeDto) => {
    setBusyRowId(t.id);
    setForm({
      code: t.code,
      name: t.name,
      rate: t.rate,
      kind: t.kind,
      salesTaxAccountId: t.salesTaxAccountId ?? "",
      purchaseTaxAccountId: t.purchaseTaxAccountId ?? "",
      isActive: t.isActive,
    });
    setEditing(t);
  };

  const onSync = async () => {
    try {
      await syncMutation.mutateAsync();
      addToast("Synced from checkout tax", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const save = async () => {
    if (!canManage) return;
    try {
      if (editing === "new") {
        await createMutation.mutateAsync({
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          rate: form.rate,
          kind: form.kind,
          salesTaxAccountId: form.salesTaxAccountId || null,
          purchaseTaxAccountId: form.purchaseTaxAccountId || null,
        });
        addToast("Tax code created", "success");
      } else if (editing && typeof editing === "object") {
        if (editing.syncedFromTaxSettings) {
          addToast("Synced SALES rate is managed from Tax settings", "error");
          return;
        }
        await patchMutation.mutateAsync({
          id: editing.id,
          body: {
            name: form.name.trim(),
            rate: form.rate,
            kind: form.kind,
            salesTaxAccountId: form.salesTaxAccountId || null,
            purchaseTaxAccountId: form.purchaseTaxAccountId || null,
            isActive: form.isActive,
          },
        });
        addToast("Tax code updated", "success");
      }
      setEditing(null);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
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
                  Tax codes
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {activeCount} active
                    {syncedCount > 0 ? ` · ${syncedCount} synced` : ""}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Ledger tax rates for bills, expenses, and journals.{" "}
                <strong className="font-semibold text-stone-800">SALES</strong>{" "}
                mirrors checkout tax
                {canTaxSettings ? (
                  <>
                    {" "}
                    —{" "}
                    <button
                      type="button"
                      disabled={busySettings}
                      onClick={openSettings}
                      className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                    >
                      {busySettings ? <ButtonSpinner /> : null}
                      Open tax settings
                    </button>
                  </>
                ) : null}
                .
              </p>
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={manualRefresh || blocking}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
              >
                {manualRefresh ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-stone-500" />
                )}
                {manualRefresh ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                disabled={!canManage || syncMutation.isPending}
                onClick={() => void onSync()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
              >
                {syncMutation.isPending ? (
                  <ButtonSpinner />
                ) : (
                  <Settings2 className="h-4 w-4 text-stone-500" />
                )}
                {syncMutation.isPending
                  ? "Syncing…"
                  : "Sync from checkout tax"}
              </button>
              <button
                type="button"
                disabled={!canManage || busyNew}
                onClick={openNew}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
              >
                {busyNew ? <ButtonSpinner /> : <Plus className="h-4 w-4" />}
                New tax code
              </button>
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[12rem] flex-1 text-sm sm:max-w-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Search
              </span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Code or name…"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </span>
            </label>
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className={`inline-flex cursor-pointer items-center rounded-xl border px-3.5 py-2 text-sm font-medium shadow-sm transition ${
                showInactive
                  ? "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                  : "border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8a7318]"
              }`}
            >
              {showInactive ? "Showing inactive" : "Active only"}
            </button>
          </div>
        </div>

        <AccountingErrorMessage error={listQuery.error} />

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Tags className="h-4 w-4 text-[#D4AF37]" />
              <h2 className="text-sm font-semibold text-stone-900">Codes</h2>
              {filtered.length > 0 ? (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                  {filtered.length}
                </span>
              ) : null}
            </div>
            {listQuery.isFetching && !blocking ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
                <Loader2 className="h-3 w-3 animate-spin text-[#D4AF37]" />
                Syncing…
              </span>
            ) : null}
          </div>

          {blocking ? (
            <TableSkeleton />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <Tags className="h-10 w-10 text-stone-300" />
              <p className="text-sm font-medium text-stone-800">
                No tax codes match
              </p>
              <p className="max-w-sm text-xs text-stone-500">
                Clear search, show inactive codes, or sync from checkout tax.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    <th className="px-4 py-3 sm:px-5">Code</th>
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Rate</th>
                    <th className="px-3 py-3">Kind</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-4 py-3 text-right sm:px-5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const rowBusy = busyRowId === t.id;
                    return (
                      <tr
                        key={t.id}
                        className="border-t border-stone-100 transition hover:bg-stone-50/60"
                      >
                        <td className="px-4 py-3 sm:px-5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[12px] font-semibold tracking-wide text-stone-800">
                              {t.code}
                            </span>
                            {t.syncedFromTaxSettings ? (
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 ring-1 ring-sky-200">
                                Synced
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-medium text-stone-900">
                          {t.name}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-stone-700">
                          {formatRate(t.rate)}
                        </td>
                        <td className="px-3 py-3 text-stone-700">
                          {KIND_LABELS[t.kind] ?? t.kind}
                        </td>
                        <td className="px-3 py-3">
                          <StatusChip
                            status={t.isActive ? "active" : "archived"}
                          />
                        </td>
                        <td className="px-4 py-3 text-right sm:px-5">
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => openEdit(t)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#8a7318] shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                          >
                            {rowBusy ? <ButtonSpinner /> : null}
                            {t.syncedFromTaxSettings ? "View" : "Edit"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tax-code-editor-title"
          onClick={() => {
            if (!saving) setEditing(null);
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden border-b border-stone-100">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.14),_transparent_55%)]"
              />
              <div className="relative flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
                <div>
                  <h3
                    id="tax-code-editor-title"
                    className="text-lg font-semibold text-stone-900"
                  >
                    {editing === "new" ? "New tax code" : "Tax code"}
                  </h3>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {editing === "new"
                      ? "Create a rate for purchases, bills, or journals"
                      : syncedEditing
                        ? "Synced from checkout — rate is read-only here"
                        : "Update rate, kind, and tax ledger accounts"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditing(null)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  Esc
                </button>
              </div>
            </div>

            <div className="space-y-3 overflow-y-auto p-4 sm:p-5">
              {syncedEditing ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Rate is managed in checkout tax settings.{" "}
                  {canTaxSettings ? (
                    <button
                      type="button"
                      onClick={openSettings}
                      className="cursor-pointer font-semibold underline"
                    >
                      Open tax settings
                    </button>
                  ) : null}
                </p>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-stone-700">
                  Code
                </span>
                <input
                  value={form.code}
                  disabled={editing !== "new" || saving}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="e.g. VAT20"
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-stone-700">
                  Name
                </span>
                <input
                  value={form.name}
                  disabled={syncedEditing || saving}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-stone-700">
                    Rate (%)
                  </span>
                  <input
                    value={form.rate}
                    disabled={syncedEditing || saving}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, rate: e.target.value }))
                    }
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-stone-700">
                    Kind
                  </span>
                  <select
                    value={form.kind}
                    disabled={syncedEditing || saving}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, kind: e.target.value }))
                    }
                    className="w-full cursor-pointer rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
                  >
                    {Object.entries(KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <AccountPicker
                label="Sales tax account"
                value={form.salesTaxAccountId}
                disabled={saving}
                lazy
                onChange={(id) =>
                  setForm((f) => ({ ...f, salesTaxAccountId: id }))
                }
              />
              <AccountPicker
                label="Purchase tax account"
                value={form.purchaseTaxAccountId}
                disabled={saving}
                lazy
                onChange={(id) =>
                  setForm((f) => ({ ...f, purchaseTaxAccountId: id }))
                }
              />

              {editing !== "new" && !syncedEditing ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    disabled={saving}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, isActive: e.target.checked }))
                    }
                    className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                  />
                  Active
                </label>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 px-4 py-3 sm:px-5">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
                className="inline-flex cursor-pointer rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
              >
                Close
              </button>
              {!syncedEditing ? (
                <button
                  type="button"
                  disabled={!canManage || saving}
                  onClick={() => void save()}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {saving ? <ButtonSpinner /> : null}
                  {saving ? "Saving…" : "Save"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {settingsMounted ? (
        <div
          className={`fixed inset-0 z-[70] ${settingsOpen ? "pointer-events-auto" : "pointer-events-none"}`}
          aria-hidden={!settingsOpen}
        >
          <button
            type="button"
            tabIndex={settingsOpen ? 0 : -1}
            aria-label="Close tax settings"
            onClick={() => setSettingsOpen(false)}
            className={`absolute inset-0 bg-stone-900/40 backdrop-blur-[2px] transition-opacity ${
              settingsOpen ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tax settings"
            className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-stone-200 bg-white shadow-xl transition-transform duration-200 sm:inset-y-6 sm:bottom-auto sm:rounded-2xl ${
              settingsOpen
                ? "translate-y-0 opacity-100"
                : "translate-y-4 opacity-0 sm:translate-y-2"
            }`}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-stone-900">
                Checkout tax settings
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50"
              >
                <X className="h-3.5 w-3.5" />
                Esc
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <Suspense
                fallback={
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-[#D4AF37]" />
                  </div>
                }
              >
                <TaxSettingsPage />
              </Suspense>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
