"use client";

/**
 * Chart of accounts — list + create/edit/archive/import.
 * Default (unfiltered) query key matches desk prefetch for instant open.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import HqScopePolicyBanner from "@/components/Protected/admin/pages/hq/HqScopePolicyBanner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import type { ListAccountsParams, LedgerAccountDto } from "@/services/accounting";
import {
  useAccountingAccountsQuery,
  useAccountingInitialized,
  useAccountingLocationFilter,
  useArchiveAccountingAccountMutation,
  useCreateAccountingAccountMutation,
  useImportAccountingAccountsMutation,
  usePatchAccountingAccountMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  LocationPicker,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
} from "../shared";

const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

const TYPE_LABEL: Record<(typeof TYPES)[number], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function LivePulse({
  mode,
}: {
  mode: "first" | "manual" | "idle";
}) {
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
    <div className="animate-pulse space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

export default function ChartOfAccountsPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const loc = useAccountingLocationFilter();
  const currency = settings?.baseCurrency ?? "USD";

  const [includeArchived, setIncludeArchived] = useState(false);
  const [asOf, setAsOf] = useState(todayIsoDate);
  const [searchDraft, setSearchDraft] = useState("");
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<null | "create" | LedgerAccountDto>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    type: "expense",
    subtype: "operating_expense",
    parentId: "",
    description: "",
  });
  const [manualRefresh, setManualRefresh] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [newBusy, startNewTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = searchDraft.trim();
      setQ((prev) => {
        if (prev === next) return prev;
        setFilterBusy(true);
        return next;
      });
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  /**
   * Only set keys that are active — empty object matches desk prefetch so the
   * panel paints instantly from cache, then quietly refreshes balances.
   */
  const filters = useMemo(() => {
    const f: ListAccountsParams = {};
    if (includeArchived) f.includeArchived = true;
    if (asOf && asOf !== todayIsoDate()) f.asOf = asOf;
    const locId = loc.effectiveLocationId;
    if (locId) f.locationId = locId;
    if (q) f.q = q;
    return f;
  }, [includeArchived, asOf, loc.effectiveLocationId, q]);

  const accountsQuery = useAccountingAccountsQuery(filters);
  const createMutation = useCreateAccountingAccountMutation();
  const patchMutation = usePatchAccountingAccountMutation();
  const archiveMutation = useArchiveAccountingAccountMutation();
  const importMutation = useImportAccountingAccountsMutation();

  const rows = accountsQuery.data ?? [];
  const blocking = isAdminQueryBlockingLoad(
    accountsQuery.isLoading,
    rows.length > 0 || accountsQuery.isFetched
  );
  const hasActiveFilters = Object.keys(filters).length > 0;
  const saving = createMutation.isPending || patchMutation.isPending;

  useEffect(() => {
    if (!accountsQuery.isFetching) {
      setFilterBusy(false);
      setManualRefresh(false);
    }
  }, [accountsQuery.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  const grouped = useMemo(() => {
    const map = new Map<string, LedgerAccountDto[]>();
    for (const t of TYPES) map.set(t, []);
    for (const a of rows) {
      const list = map.get(a.type) ?? [];
      list.push(a);
      map.set(a.type, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    return map;
  }, [rows]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void accountsQuery.refetch();
  };

  const openCreate = () => {
    startNewTransition(() => {
      setForm({
        code: "",
        name: "",
        type: "expense",
        subtype: "operating_expense",
        parentId: "",
        description: "",
      });
      setDrawer("create");
    });
  };

  const openEdit = (a: LedgerAccountDto) => {
    setForm({
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      parentId: a.parentId ?? "",
      description: a.description ?? "",
    });
    setDrawer(a);
  };

  const openAccount = (id: string) => {
    const href = `/admin/accounting/chart-of-accounts/${id}`;
    setBusyHref(href);
    router.push(href);
  };

  const save = async () => {
    if (!canManage) return;
    try {
      if (drawer === "create") {
        await createMutation.mutateAsync({
          code: form.code.trim(),
          name: form.name.trim(),
          type: form.type,
          subtype: form.subtype,
          parentId: form.parentId || null,
          description: form.description || null,
        });
        addToast("Account created", "success");
      } else if (drawer && typeof drawer === "object") {
        await patchMutation.mutateAsync({
          id: drawer.id,
          body: {
            name: form.name.trim(),
            description: form.description || null,
            parentId: form.parentId || null,
          },
        });
        addToast("Account updated", "success");
      }
      setDrawer(null);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const archive = async (a: LedgerAccountDto) => {
    if (!canManage) return;
    if (
      !window.confirm(
        `Archive ${a.code} ${a.name}? Balance must be zero and mappings remapped.`
      )
    ) {
      return;
    }
    setArchivingId(a.id);
    try {
      await archiveMutation.mutateAsync({ id: a.id });
      addToast("Account archived", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setArchivingId(null);
    }
  };

  const onImport = async (file: File | null) => {
    if (!file || !canManage) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await importMutation.mutateAsync(fd);
      addToast("Accounts imported", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clearFilters = () => {
    setSearchDraft("");
    setQ("");
    setIncludeArchived(false);
    setAsOf(todayIsoDate());
    loc.setLocationId("");
    setFilterBusy(true);
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
                  Chart of accounts
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} accounts
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                System accounts are locked. Archive only when balance is zero —
                stays live as journals post and balances move.
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
                <>
                  <button
                    type="button"
                    disabled={importMutation.isPending}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
                  >
                    {importMutation.isPending ? (
                      <ButtonSpinner />
                    ) : (
                      <Upload className="h-4 w-4 text-stone-500" />
                    )}
                    {importMutation.isPending ? "Importing…" : "Import CSV"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => void onImport(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    disabled={newBusy || drawer === "create"}
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                  >
                    {newBusy ? <ButtonSpinner /> : <Plus className="h-4 w-4" />}
                    New account
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <HqScopePolicyBanner
          locationScoped={loc.locationScoped}
          locationName={loc.scopedLocationName}
        />

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Filters</h2>
              <p className="text-xs text-stone-500">
                Location, as-of date, or search by code / name
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filterBusy && accountsQuery.isFetching ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                  Applying…
                </span>
              ) : null}
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-[#8a7318] hover:underline"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LocationPicker
              value={loc.locationId}
              onChange={(id) => {
                setFilterBusy(true);
                loc.setLocationId(id);
              }}
              syncHqPreference
              className="min-w-0"
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">As of</span>
              <input
                type="date"
                value={asOf}
                onChange={(e) => {
                  setFilterBusy(true);
                  setAsOf(e.target.value || todayIsoDate());
                }}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-700">Search</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Code or name"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-2 lg:col-span-4">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => {
                  setFilterBusy(true);
                  setIncludeArchived(e.target.checked);
                }}
                className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              />
              Show archived
            </label>
          </div>
        </div>

        {accountsQuery.isError ? (
          <AccountingErrorMessage error={accountsQuery.error} />
        ) : null}

        {blocking ? (
          <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
            <TableSkeleton />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-stone-200/80 bg-white px-4 py-16 text-center shadow-sm">
            <Landmark className="h-9 w-9 text-stone-300" />
            <p className="mt-3 text-sm font-medium text-stone-800">
              {hasActiveFilters
                ? "No accounts match these filters"
                : "No accounts yet"}
            </p>
            <p className="mt-1 max-w-sm text-xs text-stone-500">
              {hasActiveFilters
                ? "Clear filters or adjust search to see the full chart."
                : "Run accounting setup or create your first ledger account."}
            </p>
            {canManage && !hasActiveFilters ? (
              <button
                type="button"
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                New account
              </button>
            ) : null}
          </div>
        ) : (
          TYPES.map((type) => {
            const typeRows = grouped.get(type) ?? [];
            if (!typeRows.length) return null;
            return (
              <section
                key={type}
                className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-3">
                  <h2 className="text-sm font-semibold text-stone-900">
                    {TYPE_LABEL[type]}
                  </h2>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-stone-500">
                    {typeRows.length}
                  </span>
                </div>

                {/* Mobile cards */}
                <div className="divide-y divide-stone-100 md:hidden">
                  {typeRows.map((a) => {
                    const href = `/admin/accounting/chart-of-accounts/${a.id}`;
                    const rowBusy = busyHref === href || archivingId === a.id;
                    return (
                      <div key={a.id} className="px-4 py-3">
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => openAccount(a.id)}
                          className="flex w-full items-start justify-between gap-3 text-left disabled:opacity-70"
                        >
                          <div>
                            <p className="font-mono text-xs font-semibold text-[#8a7318]">
                              {a.code}
                              {busyHref === href ? (
                                <ButtonSpinner className="ml-1.5 inline" />
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-sm font-medium text-stone-900">
                              {a.name}
                            </p>
                            <p className="mt-0.5 text-xs capitalize text-stone-500">
                              {a.subtype.replace(/_/g, " ")}
                            </p>
                          </div>
                          <MoneyCell value={a.balance} currency={currency} />
                        </button>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusChip
                            status={
                              a.archivedAt
                                ? "archived"
                                : a.isActive
                                  ? "active"
                                  : "void"
                            }
                          />
                          {a.systemKey ? (
                            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                              system
                            </span>
                          ) : null}
                          {a.isHeader ? (
                            <span className="text-[10px] uppercase text-stone-400">
                              header
                            </span>
                          ) : null}
                          {canManage && !a.systemKey ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(a)}
                                className="text-xs font-medium text-stone-700 hover:underline"
                              >
                                Edit
                              </button>
                              {!a.archivedAt ? (
                                <button
                                  type="button"
                                  disabled={archivingId === a.id}
                                  onClick={() => void archive(a)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 disabled:opacity-50"
                                >
                                  {archivingId === a.id ? (
                                    <ButtonSpinner />
                                  ) : null}
                                  Archive
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Code</th>
                        <th className="px-4 py-2.5 font-semibold">Name</th>
                        <th className="px-4 py-2.5 font-semibold">Subtype</th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Balance
                        </th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {typeRows.map((a) => {
                        const href = `/admin/accounting/chart-of-accounts/${a.id}`;
                        return (
                          <tr
                            key={a.id}
                            className="border-t border-stone-100 transition hover:bg-stone-50/70"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs">
                              <button
                                type="button"
                                disabled={busyHref === href}
                                onClick={() => openAccount(a.id)}
                                className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                              >
                                {a.code}
                                {busyHref === href ? <ButtonSpinner /> : null}
                              </button>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="font-medium text-stone-900">
                                {a.name}
                              </span>
                              {a.systemKey ? (
                                <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                                  system
                                </span>
                              ) : null}
                              {a.isHeader ? (
                                <span className="ml-2 text-xs text-stone-400">
                                  header
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5 capitalize text-stone-500">
                              {a.subtype.replace(/_/g, " ")}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              <MoneyCell value={a.balance} currency={currency} />
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusChip
                                status={
                                  a.archivedAt
                                    ? "archived"
                                    : a.isActive
                                      ? "active"
                                      : "void"
                                }
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                disabled={!canManage || Boolean(a.systemKey)}
                                onClick={() => openEdit(a)}
                                className="mr-3 text-xs font-medium text-stone-700 hover:underline disabled:opacity-40"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={
                                  !canManage ||
                                  Boolean(a.systemKey) ||
                                  Boolean(a.archivedAt) ||
                                  archivingId === a.id
                                }
                                onClick={() => void archive(a)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-red-600 disabled:opacity-40"
                              >
                                {archivingId === a.id ? <ButtonSpinner /> : null}
                                Archive
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}

        {drawer ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coa-drawer-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !saving) setDrawer(null);
            }}
          >
            <div className="w-full max-w-lg space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
              <h3
                id="coa-drawer-title"
                className="text-lg font-semibold text-stone-900"
              >
                {drawer === "create" ? "New account" : "Edit account"}
              </h3>
              {drawer === "create" ? (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Code
                    </span>
                    <input
                      value={form.code}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, code: e.target.value }))
                      }
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                      autoFocus
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Type
                    </span>
                    <select
                      value={form.type}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, type: e.target.value }))
                      }
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-stone-700">
                      Subtype
                    </span>
                    <input
                      value={form.subtype}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, subtype: e.target.value }))
                      }
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                    />
                  </label>
                </>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-stone-700">Name</span>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                  autoFocus={drawer !== "create"}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-stone-700">
                  Description
                </span>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                  rows={3}
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setDrawer(null)}
                  className="rounded-xl border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    saving ||
                    !form.name.trim() ||
                    (drawer === "create" && !form.code.trim())
                  }
                  onClick={() => void save()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60"
                >
                  {saving ? <ButtonSpinner /> : null}
                  {saving
                    ? drawer === "create"
                      ? "Creating…"
                      : "Saving…"
                    : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
