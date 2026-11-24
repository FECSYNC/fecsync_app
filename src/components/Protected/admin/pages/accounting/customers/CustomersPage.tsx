"use client";

/**
 * AR customers list.
 * Default (unfiltered) query key matches desk prefetch for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingCustomersQuery,
  useAccountingInitialized,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  openAccountingCsv,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";

type CustomerRow = {
  partyKey: string;
  name: string;
  email?: string | null;
  balance: string;
  overdue: string;
  lastActivityAt?: string | null;
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

export default function CustomersPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const ownsUrl = useAccountingDeskUrlOwner("customers");
  const can = useAuthStore((s) => s.can);
  const canExport = can(P.AccountingExport);
  const canWrite = can(P.AccountingReceivablesWrite);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const qParam = sp.get("q") ?? "";
  const hasBalance = sp.get("hasBalance") === "1";
  const overdueOnly = sp.get("overdue") === "1";

  const [searchDraft, setSearchDraft] = useState(qParam);
  const [filterBusy, setFilterBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);

  useEffect(() => setSearchDraft(qParam), [qParam]);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      if (!ownsUrl) return;
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      setFilterBusy(true);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, sp, ownsUrl]
  );

  // Debounce search so typing does not thrash the query key / miss prefetch.
  useEffect(() => {
    if (searchDraft === qParam) return;
    const t = window.setTimeout(() => {
      setParams({ q: searchDraft.trim() });
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchDraft, qParam, setParams]);

  /** Only set active keys — empty object matches desk prefetch. */
  const filters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (qParam) f.q = qParam;
    if (hasBalance) f.hasBalance = "1";
    return f;
  }, [qParam, hasBalance]);

  const customers = useAccountingCustomersQuery(filters);

  const items = useMemo(() => {
    const raw =
      ((customers.data as { items?: CustomerRow[] } | undefined)?.items ??
        []) as CustomerRow[];
    return overdueOnly ? raw.filter((c) => Number(c.overdue) > 0) : raw;
  }, [customers.data, overdueOnly]);

  const blocking = isAdminQueryBlockingLoad(
    customers.isLoading,
    items.length > 0 || customers.isFetched
  );
  const hasActiveFilters = Boolean(qParam || hasBalance || overdueOnly);

  useEffect(() => {
    if (!customers.isFetching) {
      setFilterBusy(false);
      setManualRefresh(false);
    }
  }, [customers.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void customers.refetch();
  };

  const onExport = () => {
    setExportBusy(true);
    openAccountingCsv("/api/admin/accounting/customers", {
      q: qParam || undefined,
      hasBalance: hasBalance ? "1" : undefined,
    });
    window.setTimeout(() => setExportBusy(false), 600);
  };

  const openCustomer = (partyKey: string) => {
    const href = `/admin/accounting/customers/${encodeURIComponent(partyKey)}`;
    setBusyHref(href);
    router.push(href);
  };

  const openNewInvoice = () => {
    const href = "/admin/accounting/invoices/new";
    setBusyHref(href);
    router.push(href);
  };

  const clearFilters = () => {
    if (!ownsUrl) return;
    setSearchDraft("");
    setFilterBusy(true);
    router.replace("?", { scroll: false });
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
                  Customers
                </h1>
                <LivePulse mode={liveMode} />
                {items.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {items.length} shown
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Accounts receivable balances from guest profiles, booking
                accounts, and shop users — stays live as invoices and receipts
                post.
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
              {canExport ? (
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={onExport}
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
                >
                  {exportBusy ? (
                    <ButtonSpinner />
                  ) : (
                    <Download className="h-4 w-4 text-stone-500" />
                  )}
                  {exportBusy ? "Exporting…" : "Export CSV"}
                </button>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyHref === "/admin/accounting/invoices/new"}
                  onClick={openNewInvoice}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyHref === "/admin/accounting/invoices/new" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New invoice
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Filters</h2>
              <p className="text-xs text-stone-500">
                Search by name, email, or phone — narrow to balances or overdue
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filterBusy && customers.isFetching ? (
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
              <span className="mb-1 block font-medium text-stone-700">Search</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Name, email, phone"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-4 pb-2">
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={hasBalance}
                  onChange={(e) =>
                    setParams({ hasBalance: e.target.checked ? "1" : "" })
                  }
                  className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                />
                Has balance
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) =>
                    setParams({ overdue: e.target.checked ? "1" : "" })
                  }
                  className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                />
                Overdue only
              </label>
            </div>
          </div>
        </div>

        {customers.isError ? (
          <AccountingErrorMessage error={customers.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Users className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {hasActiveFilters
                  ? "No customers match these filters"
                  : "No customers with AR activity"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {hasActiveFilters
                  ? "Clear filters or adjust search to see more customers."
                  : "Balances appear when invoices are issued to guest, booking, or shop accounts."}
              </p>
              {canWrite && !hasActiveFilters ? (
                <button
                  type="button"
                  onClick={openNewInvoice}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  New invoice
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {/* Mobile */}
              <div className="divide-y divide-stone-100 md:hidden">
                {items.map((c) => {
                  const href = `/admin/accounting/customers/${encodeURIComponent(c.partyKey)}`;
                  return (
                    <button
                      key={c.partyKey}
                      type="button"
                      disabled={busyHref === href}
                      onClick={() => openCustomer(c.partyKey)}
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {c.name}
                            {busyHref === href ? (
                              <ButtonSpinner className="ml-1.5 inline" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-stone-500">
                            {c.email || "No email"}
                          </p>
                        </div>
                        <MoneyCell value={c.balance} currency={currency} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                        <span>
                          Overdue{" "}
                          <span
                            className={
                              Number(c.overdue) > 0
                                ? "font-semibold text-red-700"
                                : ""
                            }
                          >
                            <MoneyCell
                              value={c.overdue}
                              currency={currency}
                              className="inline"
                            />
                          </span>
                        </span>
                        <span>
                          {c.lastActivityAt
                            ? String(c.lastActivityAt).slice(0, 10)
                            : "No activity"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-4 py-2.5 font-semibold">Email</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Balance
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Overdue
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => {
                      const href = `/admin/accounting/customers/${encodeURIComponent(c.partyKey)}`;
                      return (
                        <tr
                          key={c.partyKey}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openCustomer(c.partyKey)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {c.name}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-stone-600">
                            {c.email || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <MoneyCell value={c.balance} currency={currency} />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <MoneyCell
                              value={c.overdue}
                              currency={currency}
                              className={
                                Number(c.overdue) > 0
                                  ? "text-red-700"
                                  : undefined
                              }
                            />
                          </td>
                          <td className="px-4 py-2.5 text-stone-500">
                            {c.lastActivityAt
                              ? String(c.lastActivityAt).slice(0, 10)
                              : "—"}
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
      </div>
    </AccountingGate>
  );
}
