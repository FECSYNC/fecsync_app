"use client";

/**
 * AR receipts list — customer payments applied to manual invoices.
 * Default (unfiltered) query key matches desk prefetch for instant open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banknote,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
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
  useAccountingReceiptQuery,
  useAccountingReceiptsQuery,
  useVoidReceiptMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  ConfirmReasonModal,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  openAccountingCsv,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";
import ReceiptNewPage from "./ReceiptNewPage";

type ReceiptRow = {
  id: string;
  number: string;
  receiptDate: string;
  method: string;
  amount: string;
  unappliedAmount: string;
  status: string;
  partyKey?: string | null;
  currency?: string;
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

export default function ReceiptsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const ownsUrl = useAccountingDeskUrlOwner("receipts");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canWrite = can(P.AccountingReceivablesWrite);
  const canExport = can(P.AccountingExport);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const partyKey = sp.get("partyKey") ?? "";
  const cursor = sp.get("cursor") ?? "";
  const drawerId = sp.get("receiptId") ?? "";

  const [partyDraft, setPartyDraft] = useState(partyKey);
  const [filterBusy, setFilterBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [busyReceiptId, setBusyReceiptId] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [newReceiptOpen, setNewReceiptOpen] = useState(false);

  // Warm form query deps while the list is open (banks, lookups, settings).
  useEffect(() => {
    if (!canWrite) return;
    prefetchAdminRoute(qc, "/admin/accounting/receipts/new", can, user);
    router.prefetch("/admin/accounting/receipts/new");
  }, [canWrite, can, user, qc, router]);

  useEffect(() => setPartyDraft(partyKey), [partyKey]);

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
    if (partyDraft === partyKey) return;
    const t = window.setTimeout(() => {
      setParams({ partyKey: partyDraft.trim() });
    }, 280);
    return () => window.clearTimeout(t);
  }, [partyDraft, partyKey, setParams]);

  /** Only set active keys — empty object matches desk prefetch. */
  const filters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (partyKey) f.partyKey = partyKey;
    if (cursor) f.cursor = cursor;
    return f;
  }, [partyKey, cursor]);

  const list = useAccountingReceiptsQuery(filters);
  const detail = useAccountingReceiptQuery(drawerId, Boolean(drawerId));
  const voidM = useVoidReceiptMutation();

  const items = useMemo(
    () =>
      ((list.data as { items?: ReceiptRow[] } | undefined)?.items ??
        []) as ReceiptRow[],
    [list.data]
  );
  const nextCursor =
    (list.data as { nextCursor?: string | null } | undefined)?.nextCursor ??
    null;

  const receipt =
    (detail.data as { receipt?: Record<string, unknown> })?.receipt ??
    (detail.data as Record<string, unknown> | undefined);

  const blocking = isAdminQueryBlockingLoad(
    list.isLoading,
    items.length > 0 || list.isFetched
  );
  const hasActiveFilters = Boolean(partyKey);

  useEffect(() => {
    if (!list.isFetching) {
      setFilterBusy(false);
      setPageBusy(false);
      setManualRefresh(false);
    }
  }, [list.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!busyReceiptId) return;
    if (drawerId === busyReceiptId && (detail.isFetched || detail.isError)) {
      setBusyReceiptId(null);
    }
  }, [busyReceiptId, drawerId, detail.isFetched, detail.isError]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void list.refetch();
    if (drawerId) void detail.refetch();
  };

  const onExport = () => {
    setExportBusy(true);
    openAccountingCsv("/api/admin/accounting/receipts", {
      partyKey: partyKey || undefined,
    });
    window.setTimeout(() => setExportBusy(false), 600);
  };

  const warmNew = useCallback(() => {
    if (!canWrite) return;
    prefetchAdminRoute(qc, "/admin/accounting/receipts/new", can, user);
    router.prefetch("/admin/accounting/receipts/new");
  }, [canWrite, can, user, qc, router]);

  /** Instant overlay — no Next route wait (same pattern as New journal). */
  const openNew = () => {
    setBusyHref("new-receipt");
    warmNew();
    setNewReceiptOpen(true);
    window.setTimeout(() => setBusyHref(null), 120);
  };

  const openReceipt = (id: string) => {
    setBusyReceiptId(id);
    setParams({ receiptId: id }, false);
  };

  const closeDrawer = () => {
    setBusyReceiptId(null);
    setParams({ receiptId: "" }, false);
  };

  const clearFilters = () => {
    if (!ownsUrl) return;
    setPartyDraft("");
    setFilterBusy(true);
    const next = new URLSearchParams();
    if (drawerId) next.set("receiptId", drawerId);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
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
                  Receipts
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
                Customer payments applied to manual invoices — stays live as
                receipts, allocations, and voids land.
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
                  disabled={busyHref === "new-receipt" || newReceiptOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  onFocus={warmNew}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                >
                  {busyHref === "new-receipt" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Record receipt
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
                Narrow by customer party key
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filterBusy && list.isFetching ? (
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
          <label className="block max-w-xl text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Party key
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={partyDraft}
                onChange={(e) => setPartyDraft(e.target.value)}
                placeholder="guest:… / account:… / user:…"
                className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              />
            </span>
          </label>
        </div>

        {list.isError ? <AccountingErrorMessage error={list.error} /> : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Banknote className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                {hasActiveFilters
                  ? "No receipts match this party"
                  : "No receipts yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                {hasActiveFilters
                  ? "Clear the filter or try another party key."
                  : "Record a customer payment and allocate it to open invoices."}
              </p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={busyHref === "new-receipt" || newReceiptOpen}
                  onClick={openNew}
                  onMouseEnter={warmNew}
                  onFocus={warmNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                >
                  {busyHref === "new-receipt" ? (
                    <ButtonSpinner />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Record one
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {items.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busyReceiptId === r.id}
                    onClick={() => openReceipt(r.id)}
                    className="flex w-full flex-col gap-2 px-4 py-4 text-left transition hover:bg-stone-50 disabled:opacity-70"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#8a7318]">
                          {r.number}
                          {busyReceiptId === r.id ? (
                            <ButtonSpinner className="ml-1.5 inline" />
                          ) : null}
                        </p>
                        <p className="mt-0.5 truncate text-xs capitalize text-stone-500">
                          {r.method.replace(/_/g, " ")} ·{" "}
                          {String(r.receiptDate).slice(0, 10)}
                        </p>
                      </div>
                      <MoneyCell
                        value={r.amount}
                        currency={r.currency ?? currency}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip status={r.status} />
                      <span className="text-xs text-stone-500">
                        Unapplied{" "}
                        <MoneyCell
                          value={r.unappliedAmount}
                          currency={r.currency ?? currency}
                          className="inline"
                        />
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Number</th>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">Method</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Unapplied
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-stone-100 transition hover:bg-stone-50/70"
                      >
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            disabled={busyReceiptId === r.id}
                            onClick={() => openReceipt(r.id)}
                            className="inline-flex items-center gap-1.5 font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                          >
                            {r.number}
                            {busyReceiptId === r.id ? <ButtonSpinner /> : null}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-stone-600">
                          {String(r.receiptDate).slice(0, 10)}
                        </td>
                        <td className="px-4 py-2.5 capitalize text-stone-600">
                          {r.method.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusChip status={r.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <MoneyCell
                            value={r.amount}
                            currency={r.currency ?? currency}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <MoneyCell
                            value={r.unappliedAmount}
                            currency={r.currency ?? currency}
                          />
                        </td>
                      </tr>
                    ))}
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

        {drawerId ? (
          <div className="fixed inset-0 z-40 flex justify-end bg-stone-900/40 backdrop-blur-[1px]">
            <button
              type="button"
              aria-label="Close receipt drawer"
              className="absolute inset-0 cursor-default"
              onClick={closeDrawer}
            />
            <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-stone-200 bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Receipt
                  </p>
                  <h2 className="truncate text-lg font-semibold text-stone-900">
                    {String(receipt?.number ?? (detail.isLoading ? "…" : "—"))}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
                >
                  <X className="h-4 w-4" />
                  Close
                </button>
              </div>

              {detail.isLoading && !receipt ? (
                <div className="mt-10 flex justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#D4AF37]" />
                </div>
              ) : null}
              {detail.isError ? (
                <div className="mt-4">
                  <AccountingErrorMessage error={detail.error} />
                </div>
              ) : null}

              {receipt ? (
                <div className="mt-5 space-y-4 text-sm">
                  <div className="grid gap-3 rounded-xl border border-stone-100 bg-stone-50/70 p-4">
                    <p className="flex justify-between gap-3">
                      <span className="text-stone-500">Date</span>
                      <span className="tabular-nums text-stone-900">
                        {String(receipt.receiptDate).slice(0, 10)}
                      </span>
                    </p>
                    <p className="flex justify-between gap-3">
                      <span className="text-stone-500">Method</span>
                      <span className="capitalize text-stone-900">
                        {String(receipt.method).replace(/_/g, " ")}
                      </span>
                    </p>
                    <p className="flex justify-between gap-3">
                      <span className="text-stone-500">Status</span>
                      <StatusChip status={String(receipt.status)} />
                    </p>
                    <p className="flex justify-between gap-3">
                      <span className="text-stone-500">Amount</span>
                      <MoneyCell
                        value={String(receipt.amount)}
                        currency={String(receipt.currency ?? currency)}
                      />
                    </p>
                    <p className="flex justify-between gap-3">
                      <span className="text-stone-500">Unapplied</span>
                      <MoneyCell
                        value={String(receipt.unappliedAmount)}
                        currency={String(receipt.currency ?? currency)}
                      />
                    </p>
                    {receipt.reference ? (
                      <p className="flex justify-between gap-3">
                        <span className="text-stone-500">Reference</span>
                        <span className="text-right text-stone-900">
                          {String(receipt.reference)}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold text-stone-900">
                      Allocations
                    </p>
                    {((receipt.allocations as Array<{
                      invoiceId: string;
                      amount: string;
                    }>) ?? []).length === 0 ? (
                      <p className="text-xs text-stone-500">
                        No allocations on this receipt.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {(
                          (receipt.allocations as Array<{
                            invoiceId: string;
                            amount: string;
                          }>) ?? []
                        ).map((a) => {
                          const href = `/admin/accounting/invoices/${a.invoiceId}`;
                          return (
                            <li
                              key={a.invoiceId}
                              className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 px-3 py-2"
                            >
                              <Link
                                href={href}
                                onClick={() => setBusyHref(href)}
                                className="inline-flex items-center gap-1.5 font-medium text-[#8a7318] hover:underline"
                              >
                                Invoice
                                {busyHref === href ? <ButtonSpinner /> : null}
                              </Link>
                              <MoneyCell
                                value={a.amount}
                                currency={String(receipt.currency ?? currency)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {canWrite && receipt.status === "posted" ? (
                    <button
                      type="button"
                      disabled={voidM.isPending}
                      onClick={() => setConfirmVoid(true)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-60"
                    >
                      {voidM.isPending ? <ButtonSpinner /> : null}
                      {voidM.isPending ? "Voiding…" : "Void receipt"}
                    </button>
                  ) : null}
                  {receipt.voidReason ? (
                    <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Void reason: {String(receipt.voidReason)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <ConfirmReasonModal
          open={confirmVoid}
          title="Void receipt"
          message="Reverses the receipt journal and restores invoice balances."
          requireReason
          confirmLabel="Void"
          busy={voidM.isPending}
          onClose={() => setConfirmVoid(false)}
          onConfirm={async (reason) => {
            try {
              await voidM.mutateAsync({ id: drawerId, reason });
              addToast("Receipt voided", "success");
              setConfirmVoid(false);
              void detail.refetch();
              void list.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />

        {newReceiptOpen ? (
          <ReceiptNewPage
            embedded
            initialPartyKey={partyKey || undefined}
            onClose={() => setNewReceiptOpen(false)}
            onCreated={(receiptId) => {
              setNewReceiptOpen(false);
              void list.refetch();
              if (receiptId) openReceipt(receiptId);
            }}
          />
        ) : null}
      </div>
    </AccountingGate>
  );
}
