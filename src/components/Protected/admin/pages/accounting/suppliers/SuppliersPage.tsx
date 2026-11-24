"use client";

/**
 * AP suppliers list — vendors with open balances and aging.
 * Default Active filter matches desk prefetch for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingInitialized,
  useAccountingSuppliersQuery,
  useImportSuppliersMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  asItems,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";
import SupplierNewPage from "./SupplierNewPage";

type SupplierRow = {
  id: string;
  code?: string;
  name: string;
  email?: string | null;
  balance?: string | null;
  overdue?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
  currency?: string | null;
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
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

function statusLabel(s: SupplierRow) {
  if (s.archivedAt || s.isActive === false) return "archived";
  return "active";
}

export default function SuppliersPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const ownsUrl = useAccountingDeskUrlOwner("suppliers");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canWrite = can(P.AccountingPayablesWrite);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  // Default Active matches desk prefetch key.
  const activeParam = sp.get("active");
  const active =
    activeParam === null ? "true" : (activeParam as "true" | "false" | "");
  const qParam = sp.get("q") ?? "";
  const hasBalance = sp.get("hasBalance") === "1";

  const [searchDraft, setSearchDraft] = useState(qParam);
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  /** Keep form mounted (hidden) so the next click paints instantly. */
  const [newSupplierMounted, setNewSupplierMounted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importMutation = useImportSuppliersMutation();

  useEffect(() => setSearchDraft(qParam), [qParam]);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      if (!ownsUrl) return;
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      // Persist Active default explicitly when clearing other filters keeps URL stable.
      if (!next.has("active") && activeParam === null) {
        /* leave default implicit */
      }
      setFilterBusy(true);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, sp, ownsUrl, activeParam]
  );

  useEffect(() => {
    if (searchDraft === qParam) return;
    const t = window.setTimeout(() => {
      setParams({ q: searchDraft.trim() });
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchDraft, qParam, setParams]);

  /** Active default + optional keys — matches desk prefetch for Active. */
  const filters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (active) f.active = active;
    if (qParam) f.q = qParam;
    if (hasBalance) f.hasBalance = "1";
    return f;
  }, [active, qParam, hasBalance]);

  const listQuery = useAccountingSuppliersQuery(filters);
  const rows = useMemo(
    () => asItems<SupplierRow>(listQuery.data, ["suppliers", "items"]),
    [listQuery.data]
  );

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    rows.length > 0 || listQuery.isFetched
  );
  const hasActiveFilters = Boolean(
    qParam || hasBalance || active !== "true"
  );

  useEffect(() => {
    if (!listQuery.isFetching) {
      setFilterBusy(false);
      setManualRefresh(false);
    }
  }, [listQuery.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  // Warm form query deps + pre-mount the overlay after first paint.
  useEffect(() => {
    if (!canWrite) return;
    prefetchAdminRoute(qc, "/admin/accounting/suppliers/new", can, user);
    router.prefetch("/admin/accounting/suppliers/new");
    const t = window.setTimeout(() => setNewSupplierMounted(true), 350);
    return () => window.clearTimeout(t);
  }, [canWrite, can, user, qc, router]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void listQuery.refetch();
  };

  const warmNew = useCallback(() => {
    if (!canWrite) return;
    setNewSupplierMounted(true);
    prefetchAdminRoute(qc, "/admin/accounting/suppliers/new", can, user);
    router.prefetch("/admin/accounting/suppliers/new");
  }, [canWrite, can, user, qc, router]);

  /** Instant overlay — open first, warm in the background. */
  const openNew = () => {
    setBusyHref("new-supplier");
    setNewSupplierMounted(true);
    setNewSupplierOpen(true);
    window.setTimeout(() => {
      setBusyHref(null);
      warmNew();
    }, 0);
  };

  const openSupplier = (id: string) => {
    const href = `/admin/accounting/suppliers/${id}`;
    setBusyHref(href);
    router.push(href);
  };

  const clearFilters = () => {
    if (!ownsUrl) return;
    setSearchDraft("");
    setFilterBusy(true);
    router.replace("?", { scroll: false });
  };

  const onImport = async (file: File | null) => {
    if (!file || !canWrite) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = (await importMutation.mutateAsync(fd)) as {
        created?: number;
        errors?: { row: number; error: string }[];
      };
      if (res.errors?.length) {
        addToast(`Import errors on ${res.errors.length} row(s)`, "error");
      } else {
        addToast(`Imported ${res.created ?? 0} supplier(s)`, "success");
      }
      void listQuery.refetch();
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
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
                  Suppliers
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} shown
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Payables vendors with open balances and aging — stays live as
                bills, payments, and imports land.
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
                    disabled={busyHref === "new-supplier" || newSupplierOpen}
                    onClick={openNew}
                    onMouseEnter={warmNew}
                    onFocus={warmNew}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                  >
                    {busyHref === "new-supplier" ? (
                      <ButtonSpinner />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    New supplier
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Filters</h2>
              <p className="text-xs text-stone-500">
                Search by name, code, or email — narrow by status or balance
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filterBusy && listQuery.isFetching ? (
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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-700">
                Search
              </span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Search name, code, email"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Status
              </span>
              <select
                value={active}
                onChange={(e) => setParams({ active: e.target.value })}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              >
                <option value="true">Active</option>
                <option value="false">Archived</option>
                <option value="">All</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={hasBalance}
                onChange={(e) =>
                  setParams({ hasBalance: e.target.checked ? "1" : "" })
                }
                className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              />
              With balance
            </label>
          </div>
        </div>

        {listQuery.isError ? (
          <AccountingErrorMessage error={listQuery.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Building2 className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {hasActiveFilters
                  ? "No suppliers match these filters"
                  : "No suppliers yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {hasActiveFilters
                  ? "Clear filters or adjust search to see more vendors."
                  : "Create a supplier or import a CSV to start AP."}
              </p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyHref === "new-supplier" || newSupplierOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyHref === "new-supplier" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New supplier
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((s) => {
                  const href = `/admin/accounting/suppliers/${s.id}`;
                  const overdue = Number(s.overdue ?? 0) > 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busyHref === href}
                      onClick={() => openSupplier(s.id)}
                      className={`flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70 ${
                        overdue ? "bg-red-50/40" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {s.name}
                            {busyHref === href ? (
                              <ButtonSpinner className="ml-1.5 inline" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-stone-500">
                            {s.code || "No code"} · {s.email || "No email"}
                          </p>
                        </div>
                        <MoneyCell
                          value={s.balance}
                          currency={s.currency || currency}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip status={statusLabel(s)} />
                        <span className="text-xs text-stone-500">
                          Overdue{" "}
                          <MoneyCell
                            value={s.overdue}
                            currency={s.currency || currency}
                            className={`inline ${
                              overdue ? "text-red-700" : ""
                            }`}
                          />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Code</th>
                      <th className="px-4 py-2.5 font-semibold">Name</th>
                      <th className="px-4 py-2.5 font-semibold">Email</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Balance
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Overdue
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const href = `/admin/accounting/suppliers/${s.id}`;
                      const overdue = Number(s.overdue ?? 0) > 0;
                      return (
                        <tr
                          key={s.id}
                          className={`border-t border-stone-100 transition hover:bg-stone-50/70 ${
                            overdue ? "bg-red-50/30" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-stone-600">
                            {s.code || "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openSupplier(s.id)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {s.name}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-stone-600">
                            {s.email || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={s.balance}
                              currency={s.currency || currency}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={s.overdue}
                              currency={s.currency || currency}
                              className={overdue ? "text-red-700" : undefined}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip status={statusLabel(s)} />
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

        {newSupplierMounted || newSupplierOpen ? (
          <SupplierNewPage
            embedded
            active={newSupplierOpen}
            onClose={() => setNewSupplierOpen(false)}
            onCreated={(supplierId) => {
              setNewSupplierOpen(false);
              void listQuery.refetch();
              if (supplierId) openSupplier(supplierId);
            }}
          />
        ) : null}
      </div>
    </AccountingGate>
  );
}
