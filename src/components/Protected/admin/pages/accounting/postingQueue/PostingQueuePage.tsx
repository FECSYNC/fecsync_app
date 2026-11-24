"use client";

/**
 * Posting exceptions queue — failed / pending / skipped automatic postings.
 * Default tab `failed` matches desk prefetch for split-second open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Inbox,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingLookupsQuery,
  usePostingQueueQuery,
  useProcessPostingQueueMutation,
  useRetryPostingQueueMutation,
  useSkipPostingQueueMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
} from "../shared";
import {
  accountingPanelFromHref,
  useAccountingDesk,
  type AccountingDeskPanel,
} from "../accountingDesk";

type Tab = "failed" | "pending" | "skipped";

type QueueRow = {
  id?: string;
  sourceType?: string;
  sourceId?: string;
  sourceEvent?: string;
  status?: string;
  errorCode?: string | null;
  warningCode?: string | null;
  lastError?: string | null;
  errorMessage?: string | null;
  skippedReason?: string | null;
  attempts?: number;
  journalEntryId?: string | null;
  createdAt?: string;
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

function sourceHref(sourceType: string, sourceId: string) {
  const map: Record<string, string> = {
    booking: `/admin/bookings/${sourceId}`,
    pos_sale: `/admin/pos/sales/${sourceId}`,
    supplier_bill: `/admin/accounting/bills/${sourceId}`,
    supplier_payment: `/admin/accounting/supplier-payments/${sourceId}`,
    expense: `/admin/accounting/expenses/${sourceId}`,
    purchase_order: `/admin/accounting/purchase-orders/${sourceId}`,
    journal: `/admin/accounting/journals/${sourceId}`,
  };
  return (
    map[sourceType] ??
    `/admin/accounting/source-entries?type=${encodeURIComponent(sourceType)}&id=${encodeURIComponent(sourceId)}`
  );
}

function shouldUseAppRoute(href: string) {
  if (href.includes("/admin/bookings/") || href.includes("/admin/pos/")) {
    return true;
  }
  if (
    /\/admin\/accounting\/(bills|supplier-payments|expenses|purchase-orders|journals)\/[^/?]+/.test(
      href
    )
  ) {
    return true;
  }
  return false;
}

function ledgerFocusFromHref(href: string): {
  accountId?: string;
  systemKey?: string;
} | null {
  if (!href.includes("/admin/accounting/ledger")) return null;
  try {
    const u = new URL(href, "http://local.invalid");
    const accountId = u.searchParams.get("accountId") ?? undefined;
    const systemKey = u.searchParams.get("systemKey") ?? undefined;
    if (accountId || systemKey) return { accountId, systemKey };
    return {};
  } catch {
    return {};
  }
}

export default function PostingQueuePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canManage = can(P.AccountingManage);
  const canRead = canManage || can(P.AccountingRead);

  /** Default `failed` matches desk prefetch. */
  const [tab, setTab] = useState<Tab>("failed");
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [skipTarget, setSkipTarget] = useState<QueueRow | null>(null);
  const [skipReason, setSkipReason] = useState("");

  const statusFilter = tab === "pending" ? "pending" : tab;
  const query = usePostingQueueQuery({ status: statusFilter }, canRead);
  const pendingQuery = usePostingQueueQuery(
    { status: "processing" },
    canRead && tab === "pending"
  );

  const rows = useMemo(() => {
    const primary = asItems<QueueRow>(query.data, ["items", "rows"]);
    if (tab !== "pending") return primary;
    const processing = asItems<QueueRow>(pendingQuery.data, ["items", "rows"]);
    return [...primary, ...processing];
  }, [query.data, pendingQuery.data, tab]);

  const counts = asRecord(
    asRecord(query.data).counts ?? asRecord(pendingQuery.data).counts
  );

  const process = useProcessPostingQueueMutation();
  const retry = useRetryPostingQueueMutation();
  const skip = useSkipPostingQueueMutation();
  const lookups = useAccountingLookupsQuery(canRead);
  const suspenseAccountId = String(
    asRecord(asRecord(lookups.data).systemAccounts).suspense ??
      asRecord(lookups.data).suspenseAccountId ??
      ""
  );

  const suspenseHref = suspenseAccountId
    ? `/admin/accounting/ledger?accountId=${encodeURIComponent(suspenseAccountId)}`
    : "/admin/accounting/ledger?systemKey=suspense";

  const blocking = isAdminQueryBlockingLoad(
    query.isLoading,
    rows.length > 0 || query.isFetched
  );

  useEffect(() => {
    if (!query.isFetching && !(tab === "pending" && pendingQuery.isFetching)) {
      setManualRefresh(false);
      setFilterBusy(false);
    }
  }, [query.isFetching, pendingQuery.isFetching, tab]);

  useEffect(() => {
    if (desk?.panel === "ledger") setBusyHref(null);
  }, [desk?.panel]);

  useEffect(() => {
    if (!busyHref && !busyRowId) return;
    const t = window.setTimeout(() => {
      setBusyHref(null);
      setBusyRowId(null);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [busyHref, busyRowId]);

  useEffect(() => {
    if (!skipTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || skip.isPending) return;
      setSkipTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skipTarget, skip.isPending]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || filterBusy || process.isPending
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void query.refetch();
    if (tab === "pending") void pendingQuery.refetch();
  };

  const setTabSafe = (next: Tab) => {
    if (next === tab) return;
    setFilterBusy(true);
    setTab(next);
  };

  const warm = useCallback(
    (href: string) => {
      try {
        prefetchAdminRoute(qc, href, can, user);
        router.prefetch(href);
        const panel = accountingPanelFromHref(href);
        if (panel) desk?.warmPanel(panel);
      } catch {
        /* never block open */
      }
    },
    [qc, can, user, router, desk]
  );

  const go = useCallback(
    (href: string) => {
      setBusyHref(href);
      warm(href);
      const ledgerFocus = ledgerFocusFromHref(href);
      if (ledgerFocus != null && desk) {
        desk.openLedger(
          ledgerFocus.accountId || ledgerFocus.systemKey
            ? ledgerFocus
            : suspenseAccountId
              ? { accountId: suspenseAccountId }
              : { systemKey: "suspense" }
        );
        window.setTimeout(() => setBusyHref(null), 180);
        return;
      }
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
    [desk, router, warm, suspenseAccountId]
  );

  const onProcess = async () => {
    try {
      await process.mutateAsync();
      addToast("Queue processed", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const onRetry = async (row: QueueRow) => {
    const id = String(row.id ?? "");
    if (!id) return;
    setBusyRowId(`retry-${id}`);
    try {
      await retry.mutateAsync(id);
      addToast("Retried", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusyRowId(null);
    }
  };

  const openSkip = (row: QueueRow) => {
    setBusyRowId(`skip-open-${String(row.id)}`);
    setSkipReason("");
    setSkipTarget(row);
    window.setTimeout(() => setBusyRowId(null), 200);
  };

  const onSkip = async () => {
    if (!skipTarget?.id) return;
    const reason = skipReason.trim();
    if (reason.length < 3) {
      addToast("Enter a skip reason (at least 3 characters)", "error");
      return;
    }
    try {
      await skip.mutateAsync({ id: String(skipTarget.id), reason });
      addToast("Skipped", "success");
      setSkipTarget(null);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const failedCount = Number(counts.failed ?? 0);
  const pendingCount =
    Number(counts.pending ?? 0) + Number(counts.processing ?? 0);
  const skippedCount = Number(counts.skipped ?? 0);

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
                  Posting queue
                </h1>
                <LivePulse mode={liveMode} />
                {failedCount > 0 ? (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-red-800 ring-1 ring-red-200">
                    {failedCount} failed
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Failed, pending, and skipped automatic postings — stays live as
                sales, bills, and journals enqueue.
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
              {canManage ? (
                <button
                  type="button"
                  disabled={process.isPending}
                  onClick={() => void onProcess()}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {process.isPending ? (
                    <ButtonSpinner />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {process.isPending ? "Processing…" : "Process now"}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-900">
              Suspense balance
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              Review uncleared suspense postings in the ledger.
            </p>
          </div>
          <button
            type="button"
            disabled={busyHref === suspenseHref}
            onClick={() => go(suspenseHref)}
            onMouseEnter={() => warm(suspenseHref)}
            onFocus={() => warm(suspenseHref)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#8a7318] shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
          >
            {busyHref === suspenseHref ? <ButtonSpinner /> : null}
            Open suspense ledger →
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-stone-200">
          {(
            [
              ["failed", `Failed (${Number.isFinite(failedCount) ? failedCount : "…"})`],
              [
                "pending",
                `Pending (${Number.isFinite(pendingCount) ? pendingCount : "…"})`,
              ],
              [
                "skipped",
                `Skipped (${Number.isFinite(skippedCount) ? skippedCount : "…"})`,
              ],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTabSafe(key)}
              className={`relative px-3 py-2.5 text-sm font-medium transition ${
                tab === key
                  ? "text-stone-900"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {label}
              {tab === key ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#D4AF37]" />
              ) : null}
            </button>
          ))}
          {filterBusy ? (
            <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
              Updating…
            </span>
          ) : null}
        </div>

        {query.isError ? <AccountingErrorMessage error={query.error} /> : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Inbox className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No {tab} items
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {tab === "failed"
                  ? "Failed postings will appear here for retry or skip."
                  : tab === "pending"
                    ? "Nothing waiting to post right now."
                    : "Skipped items will list here with their reason."}
              </p>
              {canManage && tab === "failed" ? (
                <button
                  type="button"
                  disabled={process.isPending}
                  onClick={() => void onProcess()}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {process.isPending ? <ButtonSpinner /> : <Play className="h-4 w-4" />}
                  Process now
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((r) => {
                  const id = String(r.id ?? "");
                  const href = sourceHref(
                    String(r.sourceType ?? ""),
                    String(r.sourceId ?? "")
                  );
                  const message = String(
                    r.lastError ??
                      r.errorMessage ??
                      r.skippedReason ??
                      "—"
                  );
                  return (
                    <div key={id} className="flex flex-col gap-2 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          disabled={busyHref === href}
                          onClick={() => go(href)}
                          onMouseEnter={() => warm(href)}
                          className="min-w-0 text-left font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                        >
                          {String(r.sourceType)} {String(r.sourceId)}
                          {busyHref === href ? (
                            <ButtonSpinner className="ml-1.5 inline" />
                          ) : null}
                        </button>
                        <StatusChip status={String(r.status)} />
                      </div>
                      <p className="font-mono text-[11px] text-stone-500">
                        {String(r.errorCode ?? r.warningCode ?? "—")}
                      </p>
                      <p className="line-clamp-2 text-xs text-stone-600">
                        {message}
                      </p>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {["failed", "skipped", "pending"].includes(
                            String(r.status)
                          ) ? (
                            <button
                              type="button"
                              disabled={
                                busyRowId === `retry-${id}` || retry.isPending
                              }
                              onClick={() => void onRetry(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-[#8a7318] hover:bg-stone-50 disabled:opacity-70"
                            >
                              {busyRowId === `retry-${id}` ? (
                                <ButtonSpinner />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              Retry
                            </button>
                          ) : null}
                          {["failed", "pending", "processing"].includes(
                            String(r.status)
                          ) ? (
                            <button
                              type="button"
                              disabled={
                                busyRowId === `skip-open-${id}` ||
                                skip.isPending
                              }
                              onClick={() => openSkip(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-70"
                            >
                              {busyRowId === `skip-open-${id}` ? (
                                <ButtonSpinner />
                              ) : (
                                <SkipForward className="h-3.5 w-3.5" />
                              )}
                              Skip…
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Source</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Error</th>
                      <th className="px-4 py-2.5 font-semibold">Message</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const id = String(r.id ?? "");
                      const href = sourceHref(
                        String(r.sourceType ?? ""),
                        String(r.sourceId ?? "")
                      );
                      const message = String(
                        r.lastError ??
                          r.errorMessage ??
                          r.skippedReason ??
                          "—"
                      );
                      return (
                        <tr
                          key={id}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => go(href)}
                              onMouseEnter={() => warm(href)}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {String(r.sourceType)} {String(r.sourceId)}
                              {busyHref === href ? <ButtonSpinner /> : null}
                            </button>
                            {r.sourceEvent ? (
                              <div className="mt-0.5 text-[11px] text-stone-500">
                                {String(r.sourceEvent)}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusChip status={String(r.status)} />
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-stone-600">
                            {String(r.errorCode ?? r.warningCode ?? "—")}
                          </td>
                          <td className="max-w-xs truncate px-4 py-2.5 text-stone-700">
                            {message}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex items-center gap-2">
                              {canManage &&
                              ["failed", "skipped", "pending"].includes(
                                String(r.status)
                              ) ? (
                                <button
                                  type="button"
                                  disabled={
                                    busyRowId === `retry-${id}` ||
                                    retry.isPending
                                  }
                                  onClick={() => void onRetry(r)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                                >
                                  {busyRowId === `retry-${id}` ? (
                                    <ButtonSpinner />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  Retry
                                </button>
                              ) : null}
                              {canManage &&
                              ["failed", "pending", "processing"].includes(
                                String(r.status)
                              ) ? (
                                <button
                                  type="button"
                                  disabled={
                                    busyRowId === `skip-open-${id}` ||
                                    skip.isPending
                                  }
                                  onClick={() => openSkip(r)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline disabled:opacity-70"
                                >
                                  {busyRowId === `skip-open-${id}` ? (
                                    <ButtonSpinner />
                                  ) : (
                                    <SkipForward className="h-3.5 w-3.5" />
                                  )}
                                  Skip…
                                </button>
                              ) : null}
                            </div>
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

        {failedCount > 0 && tab !== "failed" ? (
          <button
            type="button"
            onClick={() => setTabSafe("failed")}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-900"
          >
            <AlertTriangle className="h-4 w-4" />
            {failedCount} failed item{failedCount === 1 ? "" : "s"} need attention
          </button>
        ) : null}
      </div>

      {skipTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skip-queue-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h3
              id="skip-queue-title"
              className="text-lg font-semibold text-stone-900"
            >
              Skip posting
            </h3>
            <p className="text-sm text-stone-600">
              {String(skipTarget.sourceType)} {String(skipTarget.sourceId)} —
              this marks the queue item skipped without posting.
            </p>
            <textarea
              rows={4}
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              placeholder="Reason (at least 3 characters)"
              disabled={skip.isPending}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={skip.isPending}
                onClick={() => setSkipTarget(null)}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={skip.isPending || skipReason.trim().length < 3}
                onClick={() => void onSkip()}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {skip.isPending ? <ButtonSpinner /> : null}
                {skip.isPending ? "Skipping…" : "Skip item"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
