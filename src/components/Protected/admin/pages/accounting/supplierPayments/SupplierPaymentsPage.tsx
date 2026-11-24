"use client";

/**
 * AP supplier payments list — allocate bank payments to open bills.
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
  Banknote,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingInitialized,
  useSupplierPaymentsQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  asItems,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";
import SupplierPaymentNewPage from "./SupplierPaymentNewPage";

const STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "posted",
  "void",
] as const;

type PaymentRow = {
  id: string;
  number: string;
  supplierName?: string | null;
  paymentDate?: string | null;
  amount?: string | null;
  status?: string | null;
  currency?: string | null;
  method?: string | null;
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

export default function SupplierPaymentsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const ownsUrl = useAccountingDeskUrlOwner("supplier-payments");
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canWrite = can(P.AccountingPayablesWrite);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const status = sp.get("status") ?? "";

  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newMounted, setNewMounted] = useState(false);

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

  /** Empty object matches desk prefetch when no filters. */
  const filters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (status) f.status = status;
    return f;
  }, [status]);

  const listQuery = useSupplierPaymentsQuery(filters);
  const rows = useMemo(
    () => asItems<PaymentRow>(listQuery.data, ["payments", "items"]),
    [listQuery.data]
  );

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    rows.length > 0 || listQuery.isFetched
  );
  const hasActiveFilters = Boolean(status);

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

  useEffect(() => {
    if (!canWrite) return;
    prefetchAdminRoute(
      qc,
      "/admin/accounting/supplier-payments/new",
      can,
      user
    );
    router.prefetch("/admin/accounting/supplier-payments/new");
    const t = window.setTimeout(() => setNewMounted(true), 350);
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
    setNewMounted(true);
    prefetchAdminRoute(
      qc,
      "/admin/accounting/supplier-payments/new",
      can,
      user
    );
    router.prefetch("/admin/accounting/supplier-payments/new");
  }, [canWrite, can, user, qc, router]);

  const openNew = () => {
    setBusyHref("new-payment");
    setNewMounted(true);
    setNewOpen(true);
    window.setTimeout(() => {
      setBusyHref(null);
      warmNew();
    }, 0);
  };

  const openPayment = (id: string) => {
    const href = `/admin/accounting/supplier-payments/${id}`;
    setBusyHref(href);
    router.push(href);
  };

  const clearFilters = () => {
    if (!ownsUrl) return;
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
                  Supplier payments
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} shown
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Allocate bank payments to open bills — stays live as posts,
                voids, and remittances land.
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
                  disabled={busyHref === "new-payment" || newOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  onFocus={warmNew}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyHref === "new-payment" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New payment
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Filters</h2>
              <p className="text-xs text-stone-500">Narrow by payment status</p>
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
          <label className="block min-w-[12rem] max-w-xs text-sm">
            <span className="mb-1 block font-medium text-stone-700">Status</span>
            <select
              value={status}
              onChange={(e) => setParams({ status: e.target.value })}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {listQuery.isError ? (
          <AccountingErrorMessage error={listQuery.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Banknote className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {hasActiveFilters
                  ? "No payments match these filters"
                  : "No supplier payments yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {hasActiveFilters
                  ? "Clear filters or adjust status to see more payments."
                  : "Record a payment against open bills to start the AP cycle."}
              </p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyHref === "new-payment" || newOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyHref === "new-payment" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New payment
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((p) => {
                  const href = `/admin/accounting/supplier-payments/${p.id}`;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busyHref === href}
                      onClick={() => openPayment(p.id)}
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {p.number}
                            {busyHref === href ? (
                              <ButtonSpinner className="ml-1.5 inline" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-stone-500">
                            {p.supplierName || "No supplier"} ·{" "}
                            {p.paymentDate
                              ? String(p.paymentDate).slice(0, 10)
                              : "—"}
                          </p>
                        </div>
                        <MoneyCell
                          value={p.amount}
                          currency={p.currency || currency}
                        />
                      </div>
                      <StatusChip status={String(p.status ?? "")} />
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Number</th>
                      <th className="px-4 py-2.5 font-semibold">Supplier</th>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const href = `/admin/accounting/supplier-payments/${p.id}`;
                      return (
                        <tr
                          key={p.id}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openPayment(p.id)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {p.number}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-stone-800">
                            {p.supplierName || "—"}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-stone-600">
                            {p.paymentDate
                              ? String(p.paymentDate).slice(0, 10)
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={p.amount}
                              currency={p.currency || currency}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip status={String(p.status ?? "")} />
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

        {newMounted || newOpen ? (
          <SupplierPaymentNewPage
            embedded
            active={newOpen}
            onClose={() => setNewOpen(false)}
            onCreated={(paymentId) => {
              setNewOpen(false);
              void listQuery.refetch();
              if (paymentId) openPayment(paymentId);
            }}
          />
        ) : null}
      </div>
    </AccountingGate>
  );
}
