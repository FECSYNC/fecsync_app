"use client";

/**
 * General ledger — account activity with running balance.
 * Quiet live sync; AccountPicker is lazy so first paint is not blocked by the
 * full chart load. Prefetch warms settings + accounts (ledger needs accountId).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Download,
  Loader2,
  RefreshCw,
  Scale,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import HqScopePolicyBanner from "@/components/Protected/admin/pages/hq/HqScopePolicyBanner";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingAccountQuery,
  useAccountingAccountsQuery,
  useAccountingInitialized,
  useAccountingLedgerQuery,
  useAccountingLocationFilter,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  LocationPicker,
  MoneyCell,
  openAccountingCsv,
} from "../shared";
import {
  useAccountingDesk,
  useAccountingDeskUrlOwner,
} from "../accountingDesk";

function sourceHref(sourceType?: string | null, sourceId?: string | null) {
  if (!sourceType || !sourceId) return null;
  if (sourceType === "booking") return `/admin/bookings/${sourceId}`;
  if (sourceType === "manual_invoice")
    return `/admin/accounting/invoices/${sourceId}`;
  if (sourceType === "pos_sale") return `/admin/pos/sales/${sourceId}`;
  if (sourceType === "supplier_bill")
    return `/admin/accounting/bills/${sourceId}`;
  if (sourceType === "expense") return `/admin/accounting/expenses/${sourceId}`;
  return null;
}

function LivePulse({ mode }: { mode: "first" | "manual" | "idle" }) {
  const active = mode !== "idle";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
          : "bg-stone-50 text-stone-500 ring-1 ring-stone-200/80"
      }`}
      title="Quiet live sync — does not block the page"
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
        <div key={i} className="h-11 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

export default function GeneralLedgerPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const desk = useAccountingDesk();
  const ownsUrl = useAccountingDeskUrlOwner("ledger");
  const can = useAuthStore((s) => s.can);
  const canExport = can(P.AccountingExport);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const loc = useAccountingLocationFilter(sp.get("locationId") ?? "");

  const [accountOverride, setAccountOverride] = useState<string | null>(null);
  const focusKey = `${desk?.ledgerFocus?.accountId ?? ""}:${desk?.ledgerFocus?.systemKey ?? ""}`;
  useEffect(() => {
    setAccountOverride(null);
  }, [focusKey]);

  // Desk openLedger focus survives panel switches when Next searchParams lag.
  const accountId =
    accountOverride ??
    sp.get("accountId") ??
    desk?.ledgerFocus?.accountId ??
    "";
  const systemKey =
    accountOverride != null
      ? ""
      : (sp.get("systemKey") ?? desk?.ledgerFocus?.systemKey ?? "");
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? new Date().toISOString().slice(0, 10);
  const locationId = sp.get("locationId") ?? loc.locationId ?? "";
  const cursor = sp.get("cursor") ?? "";

  const [filterBusy, setFilterBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);

  // Only load the full chart when resolving systemKey (suspense deep-link).
  const accounts = useAccountingAccountsQuery(
    { includeArchived: true },
    Boolean(systemKey) && !accountId
  );

  const resolvedAccountId = useMemo(() => {
    if (accountId) return accountId;
    if (!systemKey) return "";
    const hit = (accounts.data ?? []).find((a) => a.systemKey === systemKey);
    return hit?.id ?? "";
  }, [accountId, systemKey, accounts.data]);

  const selectedAccount = useAccountingAccountQuery(
    resolvedAccountId,
    Boolean(resolvedAccountId)
  );

  useEffect(() => {
    if (!ownsUrl) return;
    if (!accountId && resolvedAccountId && systemKey) {
      const next = new URLSearchParams(sp.toString());
      next.set("accountId", resolvedAccountId);
      next.delete("systemKey");
      router.replace(`?${next.toString()}`, { scroll: false });
    }
  }, [accountId, resolvedAccountId, systemKey, router, sp, ownsUrl]);

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

  const ledgerFilters = useMemo(
    () => ({
      accountId: resolvedAccountId,
      from: from || undefined,
      to: to || undefined,
      locationId: locationId || loc.effectiveLocationId || null,
      cursor: cursor || undefined,
    }),
    [resolvedAccountId, from, to, locationId, loc.effectiveLocationId, cursor]
  );

  const ledger = useAccountingLedgerQuery(
    ledgerFilters,
    Boolean(resolvedAccountId)
  );

  const data = ledger.data as {
    account?: { code: string; name: string; type: string };
    openingBalance?: string;
    closingBalance?: string;
    periodDebit?: string;
    periodCredit?: string;
    items?: Array<{
      id: string;
      entryId: string;
      entryNumber: string;
      entryDate: string;
      description?: string | null;
      memo?: string | null;
      sourceType?: string;
      sourceId?: string | null;
      debit: string;
      credit: string;
      runningBalance: string;
    }>;
    nextCursor?: string | null;
  };

  const items = data?.items ?? [];
  const blocking = isAdminQueryBlockingLoad(
    ledger.isLoading,
    Boolean(data?.account) || ledger.isFetched
  );
  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  useEffect(() => {
    if (!ledger.isFetching) {
      setFilterBusy(false);
      setPageBusy(false);
      setManualRefresh(false);
    }
  }, [ledger.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  const onRefresh = () => {
    if (!resolvedAccountId) return;
    setManualRefresh(true);
    void ledger.refetch();
  };

  const onExport = () => {
    if (!resolvedAccountId) return;
    setExportBusy(true);
    openAccountingCsv("/api/admin/accounting/ledger", {
      accountId: resolvedAccountId,
      from,
      to,
      locationId: locationId || loc.effectiveLocationId || undefined,
    });
    window.setTimeout(() => setExportBusy(false), 600);
  };

  const openHref = (href: string) => {
    setBusyHref(href);
    router.push(href);
  };

  const accountTitle =
    data?.account != null
      ? `${data.account.code} ${data.account.name}`
      : selectedAccount.data
        ? `${selectedAccount.data.code} ${selectedAccount.data.name}`
        : null;

  return (
    <AccountingGate requireInitialized={false}>
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
                  General ledger
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Account activity with running balance. Drill into journal
                entries and source documents — stays aligned as posts land.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={!resolvedAccountId || manualRefresh || blocking}
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
                  disabled={!resolvedAccountId || exportBusy}
                  onClick={onExport}
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
                >
                  {exportBusy ? (
                    <ButtonSpinner />
                  ) : (
                    <Download className="h-4 w-4 text-stone-500" />
                  )}
                  Export CSV
                </button>
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
                Pick an account, then narrow by date or location
              </p>
            </div>
            {filterBusy && ledger.isFetching ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                Applying…
              </span>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AccountPicker
              value={resolvedAccountId}
              onChange={(id) => {
                setAccountOverride(id);
                desk?.clearLedgerFocus();
                setParams({ accountId: id });
              }}
              postableOnly={false}
              hideArchived={false}
              lazy
              className="min-w-0 sm:col-span-2 lg:col-span-1"
            />
            <DateRangePicker
              from={from}
              to={to}
              onChange={({ from: f, to: t }) => setParams({ from: f, to: t })}
              disabled={filterBusy && ledger.isFetching}
            />
            <LocationPicker
              value={locationId}
              onChange={(id) => {
                loc.setLocationId(id);
                setParams({ locationId: id });
              }}
              syncHqPreference
              className="min-w-0"
            />
          </div>
        </div>

        {ledger.isError ? (
          <AccountingErrorMessage error={ledger.error} />
        ) : null}

        {!resolvedAccountId ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-200 bg-white px-4 py-14 text-center shadow-sm">
            <Scale className="h-8 w-8 text-stone-300" />
            <p className="mt-3 text-sm font-medium text-stone-800">
              Choose an account to view the ledger
            </p>
            <p className="mt-1 max-w-sm text-xs text-stone-500">
              Search by code or name above. Posted journal lines appear with a
              running balance for the selected range.
            </p>
          </div>
        ) : null}

        {resolvedAccountId && blocking ? (
          <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
            <TableSkeleton />
          </div>
        ) : null}

        {resolvedAccountId && !blocking && data?.account ? (
          <>
            {accountTitle ? (
              <div className="flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#8a7318]">
                  <Scale className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    Selected account
                  </p>
                  <p className="truncate text-base font-semibold text-stone-900">
                    {accountTitle}
                    {data.account?.type ? (
                      <span className="ml-2 text-xs font-medium text-stone-500">
                        {data.account.type}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Opening",
                  node: (
                    <MoneyCell
                      value={data.openingBalance}
                      currency={currency}
                      align="left"
                    />
                  ),
                },
                {
                  label: "Period debit",
                  node: (
                    <MoneyCell
                      value={data.periodDebit}
                      currency={currency}
                      align="left"
                    />
                  ),
                },
                {
                  label: "Period credit",
                  node: (
                    <MoneyCell
                      value={data.periodCredit}
                      currency={currency}
                      align="left"
                    />
                  ),
                },
                {
                  label: "Closing",
                  node: (
                    <MoneyCell
                      value={data.closingBalance}
                      currency={currency}
                      align="left"
                    />
                  ),
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    {c.label}
                  </p>
                  <p className="mt-1.5 text-base font-semibold text-stone-900">
                    {c.node}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              {/* Mobile */}
              <div className="divide-y divide-stone-100 md:hidden">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <BookOpen className="h-8 w-8 text-stone-300" />
                    <p className="mt-3 text-sm font-medium text-stone-800">
                      No lines in this range
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      Try a wider date range or another location.
                    </p>
                  </div>
                ) : (
                  items.map((row) => {
                    const journalHref = `/admin/accounting/journals/${row.entryId}`;
                    const src = sourceHref(row.sourceType, row.sourceId);
                    return (
                      <div key={row.id} className="space-y-2 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <button
                              type="button"
                              disabled={busyHref === journalHref}
                              onClick={() => openHref(journalHref)}
                              className="font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {row.entryNumber}
                              {busyHref === journalHref ? (
                                <ButtonSpinner className="ml-1.5 inline" />
                              ) : null}
                            </button>
                            <p className="mt-0.5 text-xs tabular-nums text-stone-500">
                              {String(row.entryDate).slice(0, 10)}
                            </p>
                          </div>
                          <MoneyCell
                            value={row.runningBalance}
                            currency={currency}
                          />
                        </div>
                        <p className="text-xs text-stone-600">
                          {row.description || row.memo || "—"}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs">
                          <span>
                            Dr{" "}
                            <MoneyCell value={row.debit} currency={currency} />
                          </span>
                          <span>
                            Cr{" "}
                            <MoneyCell value={row.credit} currency={currency} />
                          </span>
                          {src ? (
                            <button
                              type="button"
                              disabled={busyHref === src}
                              onClick={() => openHref(src)}
                              className="font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {row.sourceType}
                            </button>
                          ) : (
                            <span className="text-stone-400">
                              {row.sourceType || "—"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Entry</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3 text-right">Debit</th>
                      <th className="px-4 py-3 text-right">Credit</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-14 text-center">
                          <BookOpen className="mx-auto h-8 w-8 text-stone-300" />
                          <p className="mt-3 text-sm font-medium text-stone-800">
                            No lines in this range
                          </p>
                        </td>
                      </tr>
                    ) : (
                      items.map((row) => {
                        const journalHref = `/admin/accounting/journals/${row.entryId}`;
                        const src = sourceHref(row.sourceType, row.sourceId);
                        return (
                          <tr
                            key={row.id}
                            className="border-t border-stone-100 transition hover:bg-stone-50/70"
                          >
                            <td className="px-4 py-2.5 tabular-nums text-stone-700">
                              {String(row.entryDate).slice(0, 10)}
                            </td>
                            <td className="px-4 py-2.5">
                              <button
                                type="button"
                                disabled={busyHref === journalHref}
                                onClick={() => openHref(journalHref)}
                                className="font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                              >
                                {row.entryNumber}
                                {busyHref === journalHref ? (
                                  <ButtonSpinner className="ml-1.5 inline" />
                                ) : null}
                              </button>
                            </td>
                            <td className="max-w-[16rem] truncate px-4 py-2.5 text-stone-600">
                              {row.description || row.memo || "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              {src ? (
                                <button
                                  type="button"
                                  disabled={busyHref === src}
                                  onClick={() => openHref(src)}
                                  className="text-[#8a7318] hover:underline disabled:opacity-70"
                                >
                                  {row.sourceType}
                                </button>
                              ) : (
                                <span className="text-stone-500">
                                  {row.sourceType || "—"}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <MoneyCell
                                value={row.debit}
                                currency={currency}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <MoneyCell
                                value={row.credit}
                                currency={currency}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium">
                              <MoneyCell
                                value={row.runningBalance}
                                currency={currency}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={!cursor || pageBusy}
                onClick={() => {
                  setPageBusy(true);
                  setParams({ cursor: "" }, false);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm disabled:opacity-40"
              >
                {pageBusy && !cursor ? <ButtonSpinner /> : null}
                First page
              </button>
              <button
                type="button"
                disabled={!data.nextCursor || pageBusy}
                onClick={() => {
                  setPageBusy(true);
                  setParams({ cursor: data.nextCursor ?? "" }, false);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm disabled:opacity-40"
              >
                {pageBusy && data.nextCursor ? <ButtonSpinner /> : null}
                Next page
              </button>
            </div>
          </>
        ) : null}

        {resolvedAccountId &&
        !blocking &&
        !data?.account &&
        !ledger.isError ? (
          <div className="flex min-h-[20vh] items-center justify-center rounded-2xl border border-stone-200 bg-white">
            <Loader2 className="h-8 w-8 animate-spin text-[#D4AF37]" />
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
