"use client";

/**
 * Journals list — manual + system entries.
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
  BookOpen,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import HqScopePolicyBanner from "@/components/Protected/admin/pages/hq/HqScopePolicyBanner";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import type { ListJournalsParams } from "@/services/accounting";
import {
  useAccountingInitialized,
  useAccountingJournalsQuery,
  useAccountingLocationFilter,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  LocationPicker,
  MoneyCell,
  StatusChip,
  openAccountingCsv,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";
import JournalNewPage from "./JournalNewPage";

const STATUSES = [
  "",
  "draft",
  "pending_approval",
  "approved",
  "posted",
  "reversed",
];
const KINDS = [
  "",
  "system",
  "manual",
  "opening_balance",
  "adjustment",
  "reversal",
  "closing",
];

function LivePulse({
  mode,
}: {
  /** first = initial load, manual = user clicked Refresh, idle = quiet live badge */
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
    <div className="animate-pulse space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-11 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

export default function JournalsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const ownsUrl = useAccountingDeskUrlOwner("journals");
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingJournalsWrite);
  const canExport = can(P.AccountingExport);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const loc = useAccountingLocationFilter(sp.get("locationId") ?? "");

  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const status = sp.get("status") ?? "";
  const kind = sp.get("kind") ?? "";
  const sourceType = sp.get("sourceType") ?? "";
  const accountId = sp.get("accountId") ?? "";
  const locationId = sp.get("locationId") ?? loc.locationId ?? "";
  const qParam = sp.get("q") ?? "";
  const cursor = sp.get("cursor") ?? "";

  const [searchDraft, setSearchDraft] = useState(qParam);
  const [sourceDraft, setSourceDraft] = useState(sourceType);
  const [filterBusy, setFilterBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [newJournalOpen, setNewJournalOpen] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);

  useEffect(() => setSearchDraft(qParam), [qParam]);
  useEffect(() => setSourceDraft(sourceType), [sourceType]);

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

  // Debounce search / source so typing does not thrash the query key.
  useEffect(() => {
    if (searchDraft === qParam) return;
    const t = window.setTimeout(() => {
      setParams({ q: searchDraft.trim() });
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchDraft, qParam, setParams]);

  useEffect(() => {
    if (sourceDraft === sourceType) return;
    const t = window.setTimeout(() => {
      setParams({ sourceType: sourceDraft.trim() });
    }, 280);
    return () => window.clearTimeout(t);
  }, [sourceDraft, sourceType, setParams]);

  /** Only set keys that are active — empty object matches desk prefetch. */
  const filters = useMemo(() => {
    const f: ListJournalsParams = {};
    if (from) f.from = from;
    if (to) f.to = to;
    if (status) f.status = status;
    if (kind) f.kind = kind;
    if (sourceType) f.sourceType = sourceType;
    if (accountId) f.accountId = accountId;
    const locId = locationId || loc.effectiveLocationId;
    if (locId) f.locationId = locId;
    if (qParam) f.q = qParam;
    if (cursor) f.cursor = cursor;
    return f;
  }, [
    from,
    to,
    status,
    kind,
    sourceType,
    accountId,
    locationId,
    loc.effectiveLocationId,
    qParam,
    cursor,
  ]);

  const journals = useAccountingJournalsQuery(filters);
  const items = (journals.data?.items ?? []) as Array<{
    id: string;
    number: string;
    entryDate: string;
    status: string;
    kind: string;
    sourceType: string;
    memo: string | null;
    totalDebit: string;
    currency?: string;
  }>;
  const nextCursor =
    (journals.data as { nextCursor?: string | null })?.nextCursor ?? null;

  const blocking = isAdminQueryBlockingLoad(
    journals.isLoading,
    items.length > 0 || journals.isFetched
  );
  const hasActiveFilters = Object.keys(filters).some((k) => k !== "cursor");

  useEffect(() => {
    if (!journals.isFetching) {
      setFilterBusy(false);
      setPageBusy(false);
      setManualRefresh(false);
    }
  }, [journals.isFetching]);

  const onRefresh = () => {
    setManualRefresh(true);
    void journals.refetch();
  };

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  /**
   * Detail routes use App Router push (path change dismisses the desk).
   * New journal opens as an instant nested modal — no route race / refresh.
   */
  const openJournal = (id: string) => {
    const href = `/admin/accounting/journals/${id}`;
    setBusyHref(href);
    router.push(href);
  };

  const openNew = () => {
    setBusyHref("new-journal");
    setNewJournalOpen(true);
    window.setTimeout(() => setBusyHref(null), 120);
  };

  const onExport = () => {
    setExportBusy(true);
    openAccountingCsv("/api/admin/accounting/journals", {
      from,
      to,
      status,
      kind,
      sourceType,
      accountId,
      locationId: locationId || loc.effectiveLocationId || undefined,
      q: qParam,
    });
    window.setTimeout(() => setExportBusy(false), 600);
  };

  const clearFilters = () => {
    if (!ownsUrl) return;
    setSearchDraft("");
    setSourceDraft("");
    setFilterBusy(true);
    router.replace("?", { scroll: false });
  };

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
                  Journals
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
                Manual and system journal entries for your company ledger —
                stays live as posts, approvals, and reversals land.
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
                  Export CSV
                </button>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyHref === "new-journal" || newJournalOpen}
                  onClick={openNew}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyHref === "new-journal" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  New journal
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
                Narrow by date, status, account, or location
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filterBusy && journals.isFetching ? (
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
            <div className="sm:col-span-2">
              <DateRangePicker
                from={from}
                to={to}
                onChange={({ from: f, to: t }) => setParams({ from: f, to: t })}
                disabled={filterBusy && journals.isFetching}
              />
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Status
              </span>
              <select
                value={status}
                onChange={(e) => setParams({ status: e.target.value })}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              >
                {STATUSES.map((s) => (
                  <option key={s || "all"} value={s}>
                    {s ? s.replace(/_/g, " ") : "All"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">Kind</span>
              <select
                value={kind}
                onChange={(e) => setParams({ kind: e.target.value })}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              >
                {KINDS.map((k) => (
                  <option key={k || "all"} value={k}>
                    {k ? k.replace(/_/g, " ") : "All"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Source
              </span>
              <input
                value={sourceDraft}
                onChange={(e) => setSourceDraft(e.target.value)}
                placeholder="e.g. booking"
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-700">
                Search
              </span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Number, memo…"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </span>
            </label>
            <AccountPicker
              value={accountId}
              onChange={(id) => setParams({ accountId: id })}
              label="Account"
              className="min-w-0"
              lazy
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

        {journals.isError ? (
          <AccountingErrorMessage error={journals.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : (
            <>
              {/* Mobile */}
              <div className="divide-y divide-stone-100 md:hidden">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <BookOpen className="h-8 w-8 text-stone-300" />
                    <p className="mt-3 text-sm font-medium text-stone-800">
                      No journals match these filters
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-stone-500">
                      Adjust filters or create a manual journal entry.
                    </p>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={openNew}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white"
                      >
                        <Plus className="h-4 w-4" />
                        New journal
                      </button>
                    ) : null}
                  </div>
                ) : (
                  items.map((e) => {
                    const href = `/admin/accounting/journals/${e.id}`;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        disabled={busyHref === href}
                        onClick={() => openJournal(e.id)}
                        className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-[#8a7318]">
                              {e.number}
                              {busyHref === href ? (
                                <ButtonSpinner className="ml-1.5 inline" />
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-xs tabular-nums text-stone-500">
                              {String(e.entryDate).slice(0, 10)}
                            </p>
                          </div>
                          <MoneyCell
                            value={e.totalDebit}
                            currency={e.currency ?? currency}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusChip status={e.status} />
                          <span className="text-xs capitalize text-stone-500">
                            {e.kind.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-stone-400">
                            {e.sourceType}
                          </span>
                        </div>
                        {e.memo ? (
                          <p className="line-clamp-2 text-xs text-stone-600">
                            {e.memo}
                          </p>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Kind</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Memo</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-14 text-center">
                          <BookOpen className="mx-auto h-8 w-8 text-stone-300" />
                          <p className="mt-3 text-sm font-medium text-stone-800">
                            No journals match these filters
                          </p>
                          {canWrite ? (
                            <button
                              type="button"
                              onClick={openNew}
                              className="mt-3 text-sm font-semibold text-[#8a7318] hover:underline"
                            >
                              Create one
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ) : (
                      items.map((e) => {
                        const href = `/admin/accounting/journals/${e.id}`;
                        return (
                          <tr
                            key={e.id}
                            className="border-t border-stone-100 transition hover:bg-stone-50/70"
                          >
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                disabled={busyHref === href}
                                onClick={() => openJournal(e.id)}
                                className="font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                              >
                                {e.number}
                                {busyHref === href ? (
                                  <ButtonSpinner className="ml-1.5 inline" />
                                ) : null}
                              </button>
                            </td>
                            <td className="px-4 py-3 tabular-nums text-stone-700">
                              {String(e.entryDate).slice(0, 10)}
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={e.status} />
                            </td>
                            <td className="px-4 py-3 capitalize text-stone-700">
                              {e.kind.replace(/_/g, " ")}
                            </td>
                            <td className="px-4 py-3 text-stone-600">
                              {e.sourceType}
                            </td>
                            <td className="max-w-[16rem] truncate px-4 py-3 text-stone-600">
                              {e.memo || "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <MoneyCell
                                value={e.totalDebit}
                                currency={e.currency ?? currency}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
            Newest
          </button>
          <button
            type="button"
            disabled={!nextCursor || pageBusy}
            onClick={() => {
              setPageBusy(true);
              setParams({ cursor: nextCursor ?? "" }, false);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm disabled:opacity-40"
          >
            {pageBusy && nextCursor ? <ButtonSpinner /> : null}
            Next page
          </button>
        </div>

        {newJournalOpen ? (
          <JournalNewPage
            embedded
            onClose={() => setNewJournalOpen(false)}
            onCreated={(entryId) => {
              setNewJournalOpen(false);
              void journals.refetch();
              openJournal(entryId);
            }}
          />
        ) : null}
      </div>
    </AccountingGate>
  );
}
