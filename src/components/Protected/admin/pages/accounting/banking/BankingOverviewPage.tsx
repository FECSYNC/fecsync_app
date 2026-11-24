"use client";

/**
 * Banking overview — ledger balances, last statement, unmatched lines.
 * Empty bankAccounts({}) key matches desk prefetch for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Building2,
  Loader2,
  RefreshCw,
  Scale,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingInitialized,
  useBankAccountsQuery,
} from "@/hooks/useAccounting";
import type { BankAccountDto } from "@/services/accounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
} from "../shared";
import {
  accountingPanelFromHref,
  useAccountingDesk,
  type AccountingDeskPanel,
} from "../accountingDesk";

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

/** Detail account routes need a real page; list modules switch via desk. */
function shouldUseAppRoute(href: string) {
  return /\/admin\/accounting\/banking\/[^/?]+/.test(href);
}

export default function BankingOverviewPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead =
    can(P.AccountingBankingRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canWrite =
    can(P.AccountingBankingWrite) || can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);

  /** Empty filters match desk prefetch. */
  const listQuery = useBankAccountsQuery({}, canRead);
  const rows = useMemo(
    () => (listQuery.data ?? []) as BankAccountDto[],
    [listQuery.data]
  );

  const unmatchedTotal = useMemo(
    () => rows.reduce((n, b) => n + (b.unmatchedCount ?? 0), 0),
    [rows]
  );

  const blocking = isAdminQueryBlockingLoad(
    listQuery.isLoading,
    rows.length > 0 || listQuery.isFetched
  );

  useEffect(() => {
    if (!listQuery.isFetching) setManualRefresh(false);
  }, [listQuery.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!canRead) return;
    // Dev: skip — each panel import queues a Turbopack compile on hard refresh.
    if (process.env.NODE_ENV === "development") return;
    const hrefs = [
      "/admin/accounting/transfers",
      "/admin/accounting/reconciliations",
      "/admin/accounting/bank-accounts",
    ] as const;
    for (const href of hrefs) {
      const panel = accountingPanelFromHref(href);
      if (panel) desk?.warmPanel(panel);
    }
  }, [canRead, desk]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void listQuery.refetch();
  };

  const warm = useCallback(
    (href: string) => {
      prefetchAdminRoute(qc, href, can, user);
      router.prefetch(href);
      const panel = accountingPanelFromHref(href);
      if (panel) desk?.warmPanel(panel);
    },
    [qc, can, user, router, desk]
  );

  const go = useCallback(
    (href: string) => {
      setBusyHref(href);
      warm(href);
      if (shouldUseAppRoute(href)) {
        router.push(href);
        return;
      }
      const panel = accountingPanelFromHref(href) as AccountingDeskPanel | null;
      if (desk && panel) {
        desk.openPanel(panel);
        window.setTimeout(() => setBusyHref(null), 180);
        return;
      }
      router.push(href);
    },
    [desk, router, warm]
  );

  const openAccount = (id: string) => {
    go(`/admin/accounting/banking/${id}`);
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
                  Banking
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} accounts
                  </span>
                ) : null}
                {unmatchedTotal > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-amber-800 ring-1 ring-amber-200">
                    {unmatchedTotal} unmatched
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Ledger balances, statement balances, and unmatched lines — stays
                live as imports, matches, and reconciliations land.
              </p>
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={manualRefresh}
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
                disabled={Boolean(busyHref)}
                onClick={() => go("/admin/accounting/transfers")}
                onMouseEnter={() => warm("/admin/accounting/transfers")}
                onFocus={() => warm("/admin/accounting/transfers")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
              >
                {busyHref === "/admin/accounting/transfers" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeftRight className="h-4 w-4 text-stone-500" />
                )}
                Transfers
              </button>
              <button
                type="button"
                disabled={Boolean(busyHref)}
                onClick={() => go("/admin/accounting/reconciliations")}
                onMouseEnter={() => warm("/admin/accounting/reconciliations")}
                onFocus={() => warm("/admin/accounting/reconciliations")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
              >
                {busyHref === "/admin/accounting/reconciliations" ? (
                  <ButtonSpinner />
                ) : (
                  <Scale className="h-4 w-4 text-stone-500" />
                )}
                Reconciliations
              </button>
              {canWrite ? (
                <button
                  type="button"
                  disabled={Boolean(busyHref)}
                  onClick={() => go("/admin/accounting/bank-accounts")}
                  onMouseEnter={() => warm("/admin/accounting/bank-accounts")}
                  onFocus={() => warm("/admin/accounting/bank-accounts")}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyHref === "/admin/accounting/bank-accounts" ? (
                    <ButtonSpinner />
                  ) : (
                    <Building2 className="h-4 w-4" />
                  )}
                  Manage accounts
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
              <Building2 className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No bank accounts yet
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Add operating, cash, or clearing accounts to track balances and
                statement lines.
              </p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyHref === "/admin/accounting/bank-accounts"}
                  onClick={() => go("/admin/accounting/bank-accounts")}
                  onMouseEnter={() => warm("/admin/accounting/bank-accounts")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyHref === "/admin/accounting/bank-accounts" ? (
                    <ButtonSpinner />
                  ) : (
                    <Building2 className="h-4 w-4" />
                  )}
                  Manage accounts
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((b) => {
                  const href = `/admin/accounting/banking/${b.id}`;
                  const unmatched = b.unmatchedCount ?? 0;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      disabled={busyHref === href}
                      onClick={() => openAccount(b.id)}
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#8a7318]">
                            {b.name}
                            {busyHref === href ? (
                              <ButtonSpinner className="ml-1.5 inline" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs capitalize text-stone-500">
                            {kindLabel(b.kind)}
                            {b.accountLast4 ? ` ····${b.accountLast4}` : ""}
                          </p>
                        </div>
                        <MoneyCell
                          value={b.balance ?? b.openingBalance}
                          currency={b.currency || currency}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip
                          status={b.archivedAt ? "void" : "posted"}
                        />
                        {unmatched > 0 ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                            {unmatched} unmatched
                          </span>
                        ) : (
                          <span className="text-[11px] text-stone-400">
                            All matched
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Account</th>
                      <th className="px-4 py-2.5 font-semibold">Kind</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Ledger balance
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Last statement
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Unmatched
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => {
                      const href = `/admin/accounting/banking/${b.id}`;
                      const unmatched = b.unmatchedCount ?? 0;
                      return (
                        <tr
                          key={b.id}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openAccount(b.id)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {b.name}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 capitalize text-stone-700">
                            {kindLabel(b.kind)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={b.balance ?? b.openingBalance}
                              currency={b.currency || currency}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={b.lastReconciledBalance}
                              currency={b.currency || currency}
                            />
                            <div className="text-[11px] text-stone-500">
                              {b.lastReconciledAt
                                ? String(b.lastReconciledAt).slice(0, 10)
                                : "Never"}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {unmatched > 0 ? (
                              <span className="inline-flex min-w-[1.5rem] justify-end rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-800 ring-1 ring-amber-200">
                                {unmatched}
                              </span>
                            ) : (
                              <span className="tabular-nums text-stone-500">
                                0
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip
                              status={b.archivedAt ? "void" : "posted"}
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
      </div>
    </AccountingGate>
  );
}
