"use client";

/**
 * Accounting periods — monthly close, reopen, and year-end.
 * Empty filters match desk prefetch (API returns all years); FY filter is client-side.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingPeriodsQuery,
  useClosePeriodMutation,
  useGeneratePeriodsMutation,
  usePeriodCloseChecklistQuery,
  useReopenPeriodMutation,
  useYearEndCloseMutation,
} from "@/hooks/useAccounting";
import type { AccountingPeriodDto } from "@/services/accounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
} from "../shared";
type ChecklistItem = {
  kind?: string;
  severity?: string;
  id?: string;
  label?: string;
  message?: string;
  href?: string;
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
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

function periodLabel(p: AccountingPeriodDto) {
  return `P${String(p.periodNumber).padStart(2, "0")}`;
}

export default function AccountingPeriodsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canManage = can(P.AccountingManage);
  const canClose = can(P.AccountingPeriodsClose) || canManage;
  const canReopen = can(P.AccountingPeriodsReopen) || canManage;
  const canRead =
    can(P.AccountingRead) || canManage || canClose || canReopen;

  const yearNow = new Date().getFullYear();
  const [fiscalYear, setFiscalYear] = useState(yearNow);
  const [yearBusy, setYearBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    null | "generate" | "year-end"
  >(null);
  const [closeTarget, setCloseTarget] = useState<AccountingPeriodDto | null>(
    null
  );
  const [reopenTarget, setReopenTarget] = useState<AccountingPeriodDto | null>(
    null
  );
  const [reopenReason, setReopenReason] = useState("");
  const [yearEndConfirm, setYearEndConfirm] = useState(false);
  const [yearEndSummary, setYearEndSummary] = useState<{
    fiscalYear: number;
    journalEntryId: string | null;
  } | null>(null);

  /**
   * Empty key matches desk prefetch. API returns all years; we filter FY here
   * so the first paint hits cache instead of waiting on a second request.
   */
  const periodsQuery = useAccountingPeriodsQuery({}, canRead);
  const checklistQuery = usePeriodCloseChecklistQuery(
    closeTarget?.id ?? "",
    Boolean(closeTarget)
  );
  const generateMutation = useGeneratePeriodsMutation();
  const closeMutation = useClosePeriodMutation();
  const reopenMutation = useReopenPeriodMutation();
  const yearEndMutation = useYearEndCloseMutation();

  const allPeriods = useMemo(
    () =>
      [...(periodsQuery.data ?? [])].sort((a, b) =>
        a.fiscalYear !== b.fiscalYear
          ? b.fiscalYear - a.fiscalYear
          : a.periodNumber - b.periodNumber
      ),
    [periodsQuery.data]
  );

  const periods = useMemo(
    () =>
      allPeriods
        .filter((p) => p.fiscalYear === fiscalYear)
        .sort((a, b) => a.periodNumber - b.periodNumber),
    [allPeriods, fiscalYear]
  );

  const openCount = useMemo(
    () => periods.filter((p) => p.status === "open").length,
    [periods]
  );
  const closedCount = useMemo(
    () => periods.filter((p) => p.status === "closed").length,
    [periods]
  );
  const lockedCount = useMemo(
    () => periods.filter((p) => p.status === "locked").length,
    [periods]
  );

  const checklistData = asRecord(checklistQuery.data);
  const checklistItems = asItems<ChecklistItem>(checklistData.items);
  const blockingFromItems = checklistItems.filter(
    (i) => String(i.severity) === "blocking"
  );
  const warningsFromItems = checklistItems.filter(
    (i) => String(i.severity) === "warning"
  );
  const legacyBlocking = asItems<ChecklistItem>(checklistData.blocking);
  const legacyWarnings = asItems<ChecklistItem>(checklistData.warnings);
  const blockingItems = blockingFromItems.length
    ? blockingFromItems
    : legacyBlocking;
  const warningItems = warningsFromItems.length
    ? warningsFromItems
    : legacyWarnings;
  const canClosePeriod =
    checklistData.canClose === true ||
    (checklistData.canClose !== false && blockingItems.length === 0);

  const blocking = isAdminQueryBlockingLoad(
    periodsQuery.isLoading,
    allPeriods.length > 0 || periodsQuery.isFetched
  );

  useEffect(() => {
    if (!periodsQuery.isFetching) {
      setManualRefresh(false);
      setYearBusy(false);
    }
  }, [periodsQuery.isFetching]);

  useEffect(() => {
    if (!busyRowId) return;
    const t = window.setTimeout(() => setBusyRowId(null), 1600);
    return () => window.clearTimeout(t);
  }, [busyRowId]);

  useEffect(() => {
    if (!closeTarget && !reopenTarget && !yearEndConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        closeMutation.isPending ||
        reopenMutation.isPending ||
        yearEndMutation.isPending
      ) {
        return;
      }
      setCloseTarget(null);
      setReopenTarget(null);
      setYearEndConfirm(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    closeTarget,
    reopenTarget,
    yearEndConfirm,
    closeMutation.isPending,
    reopenMutation.isPending,
    yearEndMutation.isPending,
  ]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || yearBusy
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void periodsQuery.refetch();
  };

  const onFiscalYearChange = (next: number) => {
    if (!Number.isFinite(next)) return;
    setYearBusy(true);
    setFiscalYear(next);
    setYearEndSummary(null);
  };

  const warmJournal = useCallback(
    (id: string) => {
      const href = `/admin/accounting/journals/${id}`;
      prefetchAdminRoute(qc, href, can, user);
      router.prefetch(href);
    },
    [qc, can, user, router]
  );

  const goJournal = useCallback(
    (id: string) => {
      const href = `/admin/accounting/journals/${id}`;
      setBusyRowId(`journal-${id}`);
      warmJournal(id);
      router.push(href);
    },
    [router, warmJournal]
  );

  const openClose = (p: AccountingPeriodDto) => {
    setBusyRowId(`close-${p.id}`);
    setCloseTarget(p);
  };

  const openReopen = (p: AccountingPeriodDto) => {
    setBusyRowId(`reopen-${p.id}`);
    setReopenReason("");
    setReopenTarget(p);
  };

  const onGenerate = async () => {
    if (!canManage) return;
    setBusyAction("generate");
    try {
      await generateMutation.mutateAsync({ fiscalYear });
      addToast(`Generated FY ${fiscalYear}`, "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusyAction(null);
    }
  };

  const onYearEnd = async () => {
    if (!canClose) return;
    setBusyAction("year-end");
    try {
      const res = asRecord(
        await yearEndMutation.mutateAsync({
          fiscalYear,
          confirm: true,
        })
      );
      setYearEndSummary({
        fiscalYear: Number(res.fiscalYear ?? fiscalYear),
        journalEntryId: res.journalEntryId
          ? String(res.journalEntryId)
          : null,
      });
      setYearEndConfirm(false);
      addToast("Year-end close complete", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusyAction(null);
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
                  Accounting periods
                </h1>
                <LivePulse mode={liveMode} />
                {periods.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    FY{fiscalYear} · {periods.length} months
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Close months in order. Year-end posts to retained earnings and
                locks the year — stays live as closes land.
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
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="sr-only">Fiscal year</span>
                <input
                  type="number"
                  value={fiscalYear}
                  onChange={(e) => onFiscalYearChange(Number(e.target.value))}
                  className="w-24 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </label>
              <button
                type="button"
                disabled={!canManage || busyAction === "generate" || generateMutation.isPending}
                onClick={() => void onGenerate()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
              >
                {busyAction === "generate" || generateMutation.isPending ? (
                  <ButtonSpinner />
                ) : (
                  <Sparkles className="h-4 w-4 text-stone-500" />
                )}
                {busyAction === "generate" || generateMutation.isPending
                  ? "Generating…"
                  : "Generate year"}
              </button>
              <button
                type="button"
                disabled={!canClose || busyAction === "year-end" || yearEndMutation.isPending}
                onClick={() => setYearEndConfirm(true)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60"
              >
                <Lock className="h-4 w-4" />
                Year-end close
              </button>
            </div>
          </div>
        </header>

        {!blocking && periods.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Open
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-stone-900">
                {openCount}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Closed
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-stone-900">
                {closedCount}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Locked
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-stone-900">
                {lockedCount}
              </p>
            </div>
          </div>
        ) : null}

        {yearEndSummary ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <p className="font-semibold">
                  FY{yearEndSummary.fiscalYear} closing entry summary
                </p>
                <p className="mt-1">
                  Revenue and expense balances were closed into retained
                  earnings and all 12 periods locked.
                </p>
                {yearEndSummary.journalEntryId ? (
                  <button
                    type="button"
                    disabled={
                      busyRowId ===
                      `journal-${yearEndSummary.journalEntryId}`
                    }
                    onClick={() =>
                      goJournal(yearEndSummary.journalEntryId!)
                    }
                    onMouseEnter={() =>
                      warmJournal(yearEndSummary.journalEntryId!)
                    }
                    className="mt-2 inline-flex items-center gap-1.5 font-medium text-emerald-900 underline disabled:opacity-70"
                  >
                    {busyRowId ===
                    `journal-${yearEndSummary.journalEntryId}` ? (
                      <ButtonSpinner />
                    ) : null}
                    Open closing journal
                  </button>
                ) : (
                  <p className="mt-2 text-emerald-800">
                    No P&amp;L balances required a closing journal for this
                    year.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {periodsQuery.isError ? (
          <AccountingErrorMessage error={periodsQuery.error} />
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : periods.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <CalendarRange className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No periods for FY{fiscalYear}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Generate the fiscal year to create twelve monthly periods you
                can close in order.
              </p>
              {canManage ? (
                <button
                  type="button"
                  disabled={
                    busyAction === "generate" || generateMutation.isPending
                  }
                  onClick={() => void onGenerate()}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyAction === "generate" || generateMutation.isPending ? (
                    <ButtonSpinner />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate FY{fiscalYear}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {periods.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-col gap-2 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-stone-900">
                          {periodLabel(p)}
                        </p>
                        <p className="mt-0.5 text-xs tabular-nums text-stone-500">
                          {String(p.startsOn).slice(0, 10)} →{" "}
                          {String(p.endsOn).slice(0, 10)}
                        </p>
                      </div>
                      <StatusChip status={p.status} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.status === "open" && canClose ? (
                        <button
                          type="button"
                          disabled={busyRowId === `close-${p.id}`}
                          onClick={() => openClose(p)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-70"
                        >
                          {busyRowId === `close-${p.id}` ? (
                            <ButtonSpinner />
                          ) : null}
                          Close…
                        </button>
                      ) : null}
                      {p.status === "closed" && canReopen ? (
                        <button
                          type="button"
                          disabled={busyRowId === `reopen-${p.id}`}
                          onClick={() => openReopen(p)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-70"
                        >
                          {busyRowId === `reopen-${p.id}` ? (
                            <ButtonSpinner />
                          ) : null}
                          Reopen…
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Period</th>
                      <th className="px-4 py-2.5 font-semibold">Starts</th>
                      <th className="px-4 py-2.5 font-semibold">Ends</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr
                        key={p.id}
                        className="border-t border-stone-100 transition hover:bg-stone-50/70"
                      >
                        <td className="px-4 py-2.5 font-semibold text-stone-900">
                          {periodLabel(p)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-stone-700">
                          {String(p.startsOn).slice(0, 10)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-stone-700">
                          {String(p.endsOn).slice(0, 10)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusChip status={p.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {p.status === "open" && canClose ? (
                            <button
                              type="button"
                              disabled={busyRowId === `close-${p.id}`}
                              onClick={() => openClose(p)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {busyRowId === `close-${p.id}` ? (
                                <ButtonSpinner />
                              ) : null}
                              Close…
                            </button>
                          ) : null}
                          {p.status === "closed" && canReopen ? (
                            <button
                              type="button"
                              disabled={busyRowId === `reopen-${p.id}`}
                              onClick={() => openReopen(p)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:underline disabled:opacity-70"
                            >
                              {busyRowId === `reopen-${p.id}` ? (
                                <ButtonSpinner />
                              ) : null}
                              Reopen…
                            </button>
                          ) : null}
                          {p.status === "locked" ? (
                            <span className="text-xs text-stone-400">
                              Locked
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {closeTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-period-title"
        >
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h3
              id="close-period-title"
              className="text-lg font-semibold text-stone-900"
            >
              Close period {periodLabel(closeTarget)}
            </h3>
            <p className="text-sm text-stone-600">
              Resolve blocking checklist items before closing. Warnings are
              advisory.
            </p>
            {checklistQuery.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-8 w-8 animate-spin text-[#D4AF37]" />
              </div>
            ) : null}
            {checklistQuery.isError ? (
              <AccountingErrorMessage error={checklistQuery.error} />
            ) : null}
            {blockingItems.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-red-700">Blocking</p>
                <ul className="mt-2 space-y-1 text-sm text-red-700">
                  {blockingItems.map((b, i) => {
                    const label = String(b.label ?? b.message ?? "Issue");
                    const href = b.href;
                    return (
                      <li key={i}>
                        {href ? (
                          <Link href={href} className="underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : checklistQuery.isFetched ? (
              <p className="text-sm text-emerald-700">No blocking items.</p>
            ) : null}
            {warningItems.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-amber-700">Warnings</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-700">
                  {warningItems.map((w, i) => {
                    const label = String(w.label ?? w.message ?? "Warning");
                    const href = w.href;
                    return (
                      <li key={i}>
                        {href ? (
                          <Link href={href} className="underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={closeMutation.isPending}
                onClick={() => setCloseTarget(null)}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !canClose ||
                  closeMutation.isPending ||
                  !canClosePeriod ||
                  blockingItems.length > 0 ||
                  checklistQuery.isLoading
                }
                onClick={async () => {
                  try {
                    await closeMutation.mutateAsync({ id: closeTarget.id });
                    addToast("Period closed", "success");
                    setCloseTarget(null);
                  } catch (err) {
                    addToast(accountingErrorMessage(err), "error");
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {closeMutation.isPending ? <ButtonSpinner /> : null}
                {closeMutation.isPending ? "Closing…" : "Close period"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reopenTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopen-period-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h3
              id="reopen-period-title"
              className="text-lg font-semibold text-stone-900"
            >
              Reopen {periodLabel(reopenTarget)}
            </h3>
            <textarea
              rows={4}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Reason (5–500 characters)"
              disabled={reopenMutation.isPending}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={reopenMutation.isPending}
                onClick={() => setReopenTarget(null)}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !canReopen ||
                  reopenReason.trim().length < 5 ||
                  reopenMutation.isPending
                }
                onClick={async () => {
                  try {
                    await reopenMutation.mutateAsync({
                      id: reopenTarget.id,
                      reason: reopenReason.trim(),
                    });
                    addToast("Period reopened", "success");
                    setReopenTarget(null);
                  } catch (err) {
                    addToast(accountingErrorMessage(err), "error");
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {reopenMutation.isPending ? <ButtonSpinner /> : null}
                {reopenMutation.isPending ? "Reopening…" : "Reopen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {yearEndConfirm ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="year-end-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h3
              id="year-end-title"
              className="text-lg font-semibold text-stone-900"
            >
              Year-end close FY{fiscalYear}?
            </h3>
            <p className="text-sm text-stone-600">
              This posts closing entries into retained earnings and locks all
              periods for the year. This cannot be undone from this screen.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={yearEndMutation.isPending}
                onClick={() => setYearEndConfirm(false)}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !canClose ||
                  yearEndMutation.isPending ||
                  busyAction === "year-end"
                }
                onClick={() => void onYearEnd()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {yearEndMutation.isPending || busyAction === "year-end" ? (
                  <ButtonSpinner />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                {yearEndMutation.isPending || busyAction === "year-end"
                  ? "Closing year…"
                  : "Confirm year-end"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
