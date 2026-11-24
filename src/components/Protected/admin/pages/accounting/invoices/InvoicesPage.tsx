"use client";

/**
 * AR invoices list — booking, manual, and credit notes.
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
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingInitialized,
  useAccountingInvoicesQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  MoneyCell,
  StatusChip,
  openAccountingCsv,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";

const STATUSES = ["draft", "sent", "paid", "overdue", "void", "cancelled"] as const;

type InvoiceRow = {
  id: string;
  number: string;
  kind: string;
  status: string;
  customerName?: string | null;
  amount: string;
  amountDue: string;
  dueAt?: string | null;
  currency?: string;
  bookingId?: string | null;
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

function hrefFor(inv: { id: string; kind: string }) {
  return inv.kind === "booking"
    ? `/admin/booking-invoices/${inv.id}`
    : `/admin/accounting/invoices/${inv.id}`;
}

export default function InvoicesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const ownsUrl = useAccountingDeskUrlOwner("invoices");
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingReceivablesWrite);
  const canExport = can(P.AccountingExport);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const kind = sp.get("kind") ?? "";
  const status = sp.get("status") ?? "";
  const overdue = sp.get("overdue") === "1";
  const qParam = sp.get("q") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const cursor = sp.get("cursor") ?? "";

  const [searchDraft, setSearchDraft] = useState(qParam);
  const [filterBusy, setFilterBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);

  useEffect(() => setSearchDraft(qParam), [qParam]);

  const setParams = useCallback(
    (patch: Record<string, string>, resetCursor = true) => {
      if (!ownsUrl) return;
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      if (resetCursor) next.delete("cursor");
      setFilterBusy(true);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, sp, ownsUrl]
  );

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
    if (kind) f.kind = kind;
    if (status) f.status = status;
    if (overdue) f.overdue = "1";
    if (qParam) f.q = qParam;
    if (from) f.from = from;
    if (to) f.to = to;
    if (cursor) f.cursor = cursor;
    return f;
  }, [kind, status, overdue, qParam, from, to, cursor]);

  const invoices = useAccountingInvoicesQuery(filters);

  const items = useMemo(
    () =>
      ((invoices.data as { items?: InvoiceRow[] } | undefined)?.items ??
        []) as InvoiceRow[],
    [invoices.data]
  );
  const nextCursor =
    (invoices.data as { nextCursor?: string | null } | undefined)?.nextCursor ??
    null;

  const blocking = isAdminQueryBlockingLoad(
    invoices.isLoading,
    items.length > 0 || invoices.isFetched
  );
  const hasActiveFilters = Object.keys(filters).some((k) => k !== "cursor");

  useEffect(() => {
    if (!invoices.isFetching) {
      setFilterBusy(false);
      setPageBusy(false);
      setManualRefresh(false);
    }
  }, [invoices.isFetching]);

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
    void invoices.refetch();
  };

  const onExport = () => {
    setExportBusy(true);
    openAccountingCsv("/api/admin/accounting/invoices", {
      kind: kind || undefined,
      status: status || undefined,
      overdue: overdue ? "1" : undefined,
      q: qParam || undefined,
      from: from || undefined,
      to: to || undefined,
    });
    window.setTimeout(() => setExportBusy(false), 600);
  };

  const openInvoice = (inv: InvoiceRow) => {
    const href = hrefFor(inv);
    setBusyHref(href);
    router.push(href);
  };

  const openNew = () => {
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
                  Invoices
                </h1>
                <LivePulse mode={liveMode} />
                {items.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {items.length}
                    {nextCursor ? "+" : ""} shown
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Booking invoices, manual invoices, and credit notes — stays live
                as issues, payments, and voids land.
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
                  onClick={openNew}
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
                Narrow by kind, status, date, or customer
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filterBusy && invoices.isFetching ? (
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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">Kind</span>
              <select
                value={kind}
                onChange={(e) => setParams({ kind: e.target.value })}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              >
                <option value="">All</option>
                <option value="booking">Booking</option>
                <option value="manual">Manual</option>
                <option value="credit_note">Credit note</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Status
              </span>
              <select
                value={status}
                onChange={(e) => setParams({ status: e.target.value })}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              >
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <DateRangePicker
                from={from}
                to={to}
                onChange={({ from: f, to: t }) => setParams({ from: f, to: t })}
                disabled={filterBusy && invoices.isFetching}
              />
            </div>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-700">
                Search
              </span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Number or customer"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </span>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={overdue}
                onChange={(e) =>
                  setParams({ overdue: e.target.checked ? "1" : "" })
                }
                className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              />
              Overdue
            </label>
          </div>
        </div>

        {invoices.isError ? (
          <AccountingErrorMessage error={invoices.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <FileText className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {hasActiveFilters
                  ? "No invoices match these filters"
                  : "No invoices yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {hasActiveFilters
                  ? "Clear filters or adjust search to see more invoices."
                  : "Create a manual invoice or wait for booking invoices to sync."}
              </p>
              {canWrite ? (
                <button
                  type="button"
                  onClick={openNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  Create one
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {items.map((inv) => {
                  const href = hrefFor(inv);
                  const highlight =
                    overdue || inv.status === "overdue";
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      disabled={busyHref === href}
                      onClick={() => openInvoice(inv)}
                      className={`flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70 ${
                        highlight ? "bg-red-50/50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {inv.number}
                            {busyHref === href ? (
                              <ButtonSpinner className="ml-1.5 inline" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-stone-500">
                            {inv.customerName || "No customer"} ·{" "}
                            {inv.kind.replace(/_/g, " ")}
                          </p>
                        </div>
                        <MoneyCell
                          value={inv.amount}
                          currency={inv.currency ?? currency}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip status={inv.status} />
                        <span className="text-xs tabular-nums text-stone-500">
                          Due{" "}
                          {inv.dueAt ? String(inv.dueAt).slice(0, 10) : "—"}
                        </span>
                        <span className="text-xs text-stone-500">
                          Balance{" "}
                          <MoneyCell
                            value={inv.amountDue}
                            currency={inv.currency ?? currency}
                            className="inline"
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
                      <th className="px-4 py-2.5 font-semibold">Number</th>
                      <th className="px-4 py-2.5 font-semibold">Kind</th>
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Due</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((inv) => {
                      const href = hrefFor(inv);
                      const highlight =
                        overdue || inv.status === "overdue";
                      return (
                        <tr
                          key={inv.id}
                          className={`border-t border-stone-100 transition hover:bg-stone-50/70 ${
                            highlight ? "bg-red-50/40" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openInvoice(inv)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {inv.number}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 capitalize text-stone-600">
                            {inv.kind.replace(/_/g, " ")}
                          </td>
                          <td className="px-4 py-2.5 text-stone-800">
                            {inv.customerName || "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip status={inv.status} />
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-stone-600">
                            {inv.dueAt
                              ? String(inv.dueAt).slice(0, 10)
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={inv.amount}
                              currency={inv.currency ?? currency}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={inv.amountDue}
                              currency={inv.currency ?? currency}
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

        {items.length > 0 || cursor ? (
          <div className="flex justify-between gap-2">
            <button
              type="button"
              disabled={!cursor || pageBusy}
              onClick={() => {
                setPageBusy(true);
                setParams({ cursor: "" }, false);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-40"
            >
              {pageBusy && cursor ? <ButtonSpinner /> : null}
              Newest
            </button>
            <button
              type="button"
              disabled={!nextCursor || pageBusy}
              onClick={() => {
                setPageBusy(true);
                setParams({ cursor: nextCursor ?? "" }, false);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-40"
            >
              {pageBusy && nextCursor ? <ButtonSpinner /> : null}
              Next page
            </button>
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
