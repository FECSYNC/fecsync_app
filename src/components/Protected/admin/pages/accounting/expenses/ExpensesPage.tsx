"use client";

/**
 * Expenses desk — claims, reimbursements, and on-account spend.
 * Tab filters match desk prefetch (all / mine / submitted) for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingExpensesQuery,
  useAccountingInitialized,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  asItems,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";
import ExpenseNewPage from "./ExpenseNewPage";

type Tab = "mine" | "all" | "approve";

type ExpenseRow = {
  id: string;
  number: string;
  expenseDate?: string | null;
  categoryName?: string | null;
  description?: string | null;
  amount?: string | null;
  status?: string | null;
  currency?: string | null;
  paymentMode?: string | null;
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

export default function ExpensesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const ownsUrl = useAccountingDeskUrlOwner("expenses");
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canSubmit = can(P.AccountingExpensesSubmit);
  const canRead =
    can(P.AccountingExpensesRead) || can(P.AccountingExpensesWrite);
  const canApprove = can(P.AccountingExpensesApprove);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const defaultTab: Tab = canApprove
    ? "approve"
    : canRead
      ? "all"
      : "mine";

  const tabFromUrl = useMemo((): Tab | null => {
    const raw = sp.get("tab");
    if (raw === "mine" || raw === "all" || raw === "approve") return raw;
    return null;
  }, [sp]);

  /**
   * Local tab is SSOT so Views clicks always work inside the desk overlay.
   * URL sync is best-effort when this panel owns the address bar (desk can
   * strip foreign query on panel switch).
   */
  const [tab, setTabState] = useState<Tab>(
    () => tabFromUrl ?? defaultTab
  );
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newMounted, setNewMounted] = useState(false);

  useEffect(() => {
    if (!ownsUrl || !tabFromUrl) return;
    setTabState((prev) => (prev === tabFromUrl ? prev : tabFromUrl));
  }, [ownsUrl, tabFromUrl]);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      setFilterBusy(true);
      if (!ownsUrl) return;
      const href =
        next === defaultTab
          ? "/admin/accounting/expenses"
          : `/admin/accounting/expenses?tab=${next}`;
      if (typeof window !== "undefined") {
        const here = `${window.location.pathname}${window.location.search}`;
        if (here !== href) {
          try {
            window.history.replaceState(window.history.state, "", href);
          } catch {
            /* ignore */
          }
        }
      }
      router.replace(href, { scroll: false });
    },
    [router, ownsUrl, defaultTab]
  );

  /** Keys match desk prefetch for each tab. */
  const filters = useMemo(() => {
    if (tab === "mine") return { mine: "1" };
    if (tab === "approve") return { status: "submitted" };
    return {};
  }, [tab]);

  const listQuery = useAccountingExpensesQuery(filters);
  const rows = useMemo(
    () => asItems<ExpenseRow>(listQuery.data, ["expenses", "items"]),
    [listQuery.data]
  );

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    rows.length > 0 || listQuery.isFetched
  );

  const tabs = useMemo(
    () =>
      (
        [
          ["mine", "My expenses", true],
          ["all", "All", canRead],
          ["approve", "To approve", canApprove],
        ] as const
      ).filter(([, , show]) => show),
    [canRead, canApprove]
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

  useEffect(() => {
    if (!canSubmit) return;
    prefetchAdminRoute(qc, "/admin/accounting/expenses/new", can, user);
    router.prefetch("/admin/accounting/expenses/new");
    const t = window.setTimeout(() => setNewMounted(true), 350);
    return () => window.clearTimeout(t);
  }, [canSubmit, can, user, qc, router]);

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
    if (!canSubmit) return;
    setNewMounted(true);
    prefetchAdminRoute(qc, "/admin/accounting/expenses/new", can, user);
    router.prefetch("/admin/accounting/expenses/new");
  }, [canSubmit, can, user, qc, router]);

  const openNew = () => {
    setBusyHref("new-expense");
    setNewMounted(true);
    setNewOpen(true);
    window.setTimeout(() => {
      setBusyHref(null);
      warmNew();
    }, 0);
  };

  const openExpense = (id: string) => {
    const href = `/admin/accounting/expenses/${id}`;
    setBusyHref(href);
    router.push(href);
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
                  Expenses
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} shown
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Claims, reimbursements, and on-account spend — stays live as
                submits, approvals, and payments land.
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
              {canSubmit ? (
                <button
                  type="button"
                  disabled={busyHref === "new-expense" || newOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  onFocus={warmNew}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyHref === "new-expense" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New expense
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Views</h2>
              <p className="text-xs text-stone-500">
                Switch between your claims, company-wide, and the approval queue
              </p>
            </div>
            {filterBusy && listQuery.isFetching ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                Applying…
              </span>
            ) : null}
          </div>
          <div
            role="tablist"
            aria-label="Expense views"
            className="relative z-10 flex flex-wrap gap-1 border-b border-stone-200"
          >
            {tabs.map(([key, label]) => {
              const selected = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(key)}
                  className={`relative -mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition ${
                    selected
                      ? "border-[#D4AF37] text-stone-900"
                      : "border-transparent text-stone-500 hover:text-stone-800"
                  }`}
                >
                  {label}
                  {key === "approve" && selected && rows.length > 0 ? (
                    <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-800 ring-1 ring-amber-200">
                      {rows.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
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
              <Receipt className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {tab === "approve"
                  ? "Nothing waiting for approval"
                  : tab === "mine"
                    ? "You have no expenses yet"
                    : "No expenses yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {tab === "approve"
                  ? "Submitted claims will appear here for maker-checker review."
                  : "Capture a receipt and submit a claim to get started."}
              </p>
              {canSubmit && tab !== "approve" ? (
                <button
                  type="button"
                  disabled={busyHref === "new-expense" || newOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyHref === "new-expense" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New expense
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((e) => {
                  const href = `/admin/accounting/expenses/${e.id}`;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      disabled={busyHref === href}
                      onClick={() => openExpense(e.id)}
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {e.number}
                            {busyHref === href ? (
                              <ButtonSpinner className="ml-1.5 inline" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-stone-500">
                            {e.categoryName || "No category"} ·{" "}
                            {e.expenseDate
                              ? String(e.expenseDate).slice(0, 10)
                              : "—"}
                          </p>
                          {e.description ? (
                            <p className="mt-0.5 truncate text-xs text-stone-600">
                              {e.description}
                            </p>
                          ) : null}
                        </div>
                        <MoneyCell
                          value={e.amount}
                          currency={e.currency || currency}
                        />
                      </div>
                      <StatusChip status={String(e.status ?? "")} />
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Number</th>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">Category</th>
                      <th className="px-4 py-2.5 font-semibold">Description</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => {
                      const href = `/admin/accounting/expenses/${e.id}`;
                      return (
                        <tr
                          key={e.id}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openExpense(e.id)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {e.number}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-stone-600">
                            {e.expenseDate
                              ? String(e.expenseDate).slice(0, 10)
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-stone-800">
                            {e.categoryName || "—"}
                          </td>
                          <td className="max-w-[14rem] truncate px-4 py-2.5 text-stone-600">
                            {e.description || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={e.amount}
                              currency={e.currency || currency}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip status={String(e.status ?? "")} />
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
          <ExpenseNewPage
            embedded
            active={newOpen}
            onClose={() => setNewOpen(false)}
            onCreated={(expenseId) => {
              setNewOpen(false);
              void listQuery.refetch();
              if (expenseId) openExpense(expenseId);
            }}
          />
        ) : null}
      </div>
    </AccountingGate>
  );
}
