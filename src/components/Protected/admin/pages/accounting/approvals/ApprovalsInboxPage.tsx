"use client";

/**
 * Approvals inbox — maker-checker queue for journals, AP, expenses, write-offs.
 * One shared query (all pending) matches desk prefetch; tabs filter client-side
 * so switching entity is instant and badges stay in sync.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CircleAlert,
  Clock3,
  Inbox,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingApprovalsQuery,
  useAccountingInitialized,
  useBulkDecideApprovalsMutation,
  useDecideApprovalMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  ConfirmReasonModal,
  MoneyCell,
  accountingErrorMessage,
} from "../shared";
import { useAccountingDeskUrlOwner } from "../accountingDesk";

type ApprovalRow = {
  id: string;
  entity: string;
  entityId: string;
  label: string;
  amount: string;
  requestedById: string;
  requestedByName: string | null;
  requestedAt: string;
  selfRequested?: boolean;
};

const TABS: Array<{
  entity: string;
  label: string;
  short: string;
  permission: string | string[];
  href: (id: string) => string;
}> = [
  {
    entity: "journal_entry",
    label: "Journals",
    short: "Journals",
    permission: P.AccountingJournalsApprove,
    href: (id) => `/admin/accounting/journals/${id}`,
  },
  {
    entity: "supplier_bill",
    label: "Bills",
    short: "Bills",
    permission: P.AccountingPayablesApprove,
    href: (id) => `/admin/accounting/bills/${id}`,
  },
  {
    entity: "supplier_payment",
    label: "Supplier payments",
    short: "Payments",
    permission: P.AccountingPayablesApprove,
    href: (id) => `/admin/accounting/supplier-payments/${id}`,
  },
  {
    entity: "purchase_order",
    label: "Purchase orders",
    short: "POs",
    permission: P.AccountingPayablesApprove,
    href: (id) => `/admin/accounting/purchase-orders/${id}`,
  },
  {
    entity: "expense",
    label: "Expenses",
    short: "Expenses",
    permission: P.AccountingExpensesApprove,
    href: (id) => `/admin/accounting/expenses/${id}`,
  },
  {
    entity: "write_off",
    label: "Write-offs",
    short: "Write-offs",
    // Dual-control: matches APPROVE_PERMISSION.write_off (.every).
    permission: [P.AccountingReceivablesWrite, P.AccountingJournalsApprove],
    href: (id) => `/admin/accounting/invoices/${id}`,
  },
];

function ageLabel(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1h";
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function ageTone(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h >= 48) return "text-red-700 bg-red-50 ring-red-100";
  if (h >= 24) return "text-amber-800 bg-amber-50 ring-amber-100";
  return "text-stone-600 bg-stone-50 ring-stone-100";
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
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

export default function ApprovalsInboxPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const ownsUrl = useAccountingDeskUrlOwner("approvals");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const allowSelf = Boolean(settings?.allowSelfApproval);

  const visibleTabs = TABS.filter((t) =>
    Array.isArray(t.permission)
      ? t.permission.every((p) => can(p))
      : can(t.permission)
  );

  const tab = sp.get("entity") || visibleTabs[0]?.entity || "journal_entry";
  const decide = useDecideApprovalMutation();
  const bulk = useBulkDecideApprovalsMutation();
  const [selected, setSelected] = useState<string[]>([]);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [tabSwitching, setTabSwitching] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);

  // Empty filters = same key as desk/prefetch (API returns all pending entities).
  const q = useAccountingApprovalsQuery({}, visibleTabs.length > 0);

  const allRows = useMemo(() => {
    return (
      ((q.data as { approvals?: ApprovalRow[] })?.approvals ??
        (q.data as { items?: ApprovalRow[] })?.items ??
        []) as ApprovalRow[]
    );
  }, [q.data]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allRows) {
      map.set(r.entity, (map.get(r.entity) ?? 0) + 1);
    }
    return map;
  }, [allRows]);

  const rows = useMemo(
    () => allRows.filter((r) => r.entity === tab),
    [allRows, tab]
  );

  const totalPending = allRows.length;
  const tabMeta = TABS.find((t) => t.entity === tab);
  const canAct = useCallback(
    (row: ApprovalRow) => allowSelf || !row.selfRequested,
    [allowSelf]
  );
  const eligible = useMemo(() => rows.filter(canAct), [rows, canAct]);
  const allEligibleSelected =
    eligible.length > 0 && eligible.every((r) => selected.includes(r.id));

  const blocking = isAdminQueryBlockingLoad(q.isLoading, allRows.length > 0 || q.isFetched);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => rows.some((r) => r.id === id)));
  }, [rows]);

  useEffect(() => {
    if (!tabSwitching) return;
    const t = window.setTimeout(() => setTabSwitching(false), 120);
    return () => window.clearTimeout(t);
  }, [tab, tabSwitching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  const setTab = (entity: string) => {
    if (entity === tab) return;
    setTabSwitching(true);
    setSelected([]);
    if (!ownsUrl) return;
    const next = new URLSearchParams(sp.toString());
    next.set("entity", entity);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const openItem = (href: string) => {
    setBusyHref(href);
    // App Router only — closePanel()+push races (replace back to list).
    // Path change dismisses the desk modal automatically.
    router.push(href);
  };

  const approveOne = async (id: string) => {
    setBusyId(id);
    try {
      await decide.mutateAsync({ id, decision: "approve" });
      addToast("Approved", "success");
      setSelected((prev) => prev.filter((x) => x !== id));
    } catch (e) {
      addToast(accountingErrorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const bulkApprove = async () => {
    const ids = selected.filter((id) => {
      const row = rows.find((r) => r.id === id);
      return row && canAct(row);
    });
    if (!ids.length) {
      addToast("No eligible items selected", "error");
      return;
    }
    const results = await bulk.mutateAsync({ ids, decision: "approve" });
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    addToast(
      fail ? `Approved ${ok}, failed ${fail}` : `Approved ${ok} item(s)`,
      fail ? "error" : "success"
    );
    setSelected([]);
  };

  useEffect(() => {
    if (!q.isFetching) setManualRefresh(false);
  }, [q.isFetching]);

  const onRefresh = () => {
    setManualRefresh(true);
    void q.refetch();
  };

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  if (!visibleTabs.length) {
    return (
      <AccountingGate>
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
          <Inbox className="mx-auto h-8 w-8 text-stone-300" />
          <p className="mt-3 text-sm font-medium text-stone-800">
            No approval permissions
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Ask an admin for journal, payables, or expense approve access.
          </p>
        </div>
      </AccountingGate>
    );
  }

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
                  Approvals
                </h1>
                <LivePulse mode={liveMode} />
                {totalPending > 0 ? (
                  <span className="rounded-full bg-[#D4AF37]/15 px-2.5 py-1 text-[11px] font-semibold text-[#6b5a12] ring-1 ring-[#D4AF37]/35">
                    {totalPending} pending
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Maker-checker inbox. Self-requested items are{" "}
                {allowSelf ? "allowed" : "blocked"} for self-approval. Queue
                stays live as new requests arrive.
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
              <button
                type="button"
                disabled={!selected.length || bulk.isPending}
                onClick={() => void bulkApprove()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
              >
                {bulk.isPending ? <ButtonSpinner /> : <Check className="h-4 w-4" />}
                Bulk approve ({selected.length})
              </button>
            </div>
          </div>
        </header>

        {!allowSelf ? (
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Self-approval is off for this company. Items you submitted stay
              visible but approve is disabled until another approver acts.
            </p>
          </div>
        ) : null}

        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleTabs.map((t) => {
            const count = counts.get(t.entity) ?? 0;
            const active = tab === t.entity;
            return (
              <button
                key={t.entity}
                type="button"
                onClick={() => setTab(t.entity)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[#D4AF37] text-white shadow-sm"
                    : "border border-stone-200 bg-white text-stone-700 hover:border-stone-300"
                }`}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                    active
                      ? "bg-white/25 text-white"
                      : count > 0
                        ? "bg-[#D4AF37]/15 text-[#6b5a12]"
                        : "bg-stone-100 text-stone-400"
                  }`}
                >
                  {count}
                </span>
                {tabSwitching && active ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
              </button>
            );
          })}
        </div>

        {q.isError ? <AccountingErrorMessage error={q.error} /> : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <Inbox className="h-8 w-8 text-stone-300" />
                    <p className="mt-3 text-sm font-medium text-stone-800">
                      Nothing waiting in {tabMeta?.label ?? "this tab"}
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-stone-500">
                      New requests appear here live when someone submits for
                      approval.
                    </p>
                  </div>
                ) : (
                  rows.map((row) => {
                    const disabledSelf = !canAct(row);
                    const href = tabMeta?.href(row.entityId) ?? "#";
                    const rowBusy = busyId === row.id || decide.isPending;
                    return (
                      <div key={row.id} className="space-y-3 px-4 py-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1"
                            disabled={disabledSelf || bulk.isPending}
                            checked={selected.includes(row.id)}
                            onChange={(e) => {
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...prev, row.id]
                                  : prev.filter((x) => x !== row.id)
                              );
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              disabled={busyHref === href}
                              onClick={() => openItem(href)}
                              className="text-left text-sm font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                            >
                              {row.label}
                              {busyHref === href ? (
                                <ButtonSpinner className="ml-1.5 inline" />
                              ) : null}
                            </button>
                            <p className="mt-1 text-xs text-stone-500">
                              {row.requestedByName ?? "Staff"}
                            </p>
                            {disabledSelf ? (
                              <p className="mt-1 text-xs text-amber-700">
                                Self-approval is off for your company.
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <MoneyCell value={row.amount} currency={currency} />
                            <span
                              className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${ageTone(row.requestedAt)}`}
                            >
                              <Clock3 className="h-3 w-3" />
                              {ageLabel(row.requestedAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 pl-7">
                          <button
                            type="button"
                            disabled={disabledSelf || rowBusy || bulk.isPending}
                            onClick={() => void approveOne(row.id)}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#D4AF37] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            {busyId === row.id && decide.isPending ? (
                              <ButtonSpinner />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={rowBusy || bulk.isPending}
                            onClick={() => setRejectId(row.id)}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all eligible"
                          checked={allEligibleSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelected(eligible.map((r) => r.id));
                            } else setSelected([]);
                          }}
                        />
                      </th>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Requester</th>
                      <th className="px-4 py-3">Age</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-14 text-center">
                          <Inbox className="mx-auto h-8 w-8 text-stone-300" />
                          <p className="mt-3 text-sm font-medium text-stone-800">
                            Nothing waiting in {tabMeta?.label ?? "this tab"}
                          </p>
                          <p className="mt-1 text-xs text-stone-500">
                            New requests appear here live when someone submits
                            for approval.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const disabledSelf = !canAct(row);
                        const href = tabMeta?.href(row.entityId) ?? "#";
                        const rowBusy = busyId === row.id || decide.isPending;
                        return (
                          <tr
                            key={row.id}
                            className="border-t border-stone-100 transition hover:bg-stone-50/70"
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                disabled={disabledSelf || bulk.isPending}
                                checked={selected.includes(row.id)}
                                onChange={(e) => {
                                  setSelected((prev) =>
                                    e.target.checked
                                      ? [...prev, row.id]
                                      : prev.filter((x) => x !== row.id)
                                  );
                                }}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                disabled={busyHref === href}
                                onClick={() => openItem(href)}
                                className="text-left font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                              >
                                {row.label}
                                {busyHref === href ? (
                                  <ButtonSpinner className="ml-1.5 inline" />
                                ) : null}
                              </button>
                              {disabledSelf ? (
                                <p className="mt-0.5 text-xs text-amber-700">
                                  Self-approval is off for your company.
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-stone-700">
                              {row.requestedByName ?? "Staff"}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${ageTone(row.requestedAt)}`}
                              >
                                <Clock3 className="h-3 w-3" />
                                {ageLabel(row.requestedAt)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <MoneyCell
                                value={row.amount}
                                currency={currency}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    disabledSelf || rowBusy || bulk.isPending
                                  }
                                  onClick={() => void approveOne(row.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#D4AF37] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                                >
                                  {busyId === row.id && decide.isPending ? (
                                    <ButtonSpinner />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )}
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={rowBusy || bulk.isPending}
                                  onClick={() => setRejectId(row.id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-40"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Reject
                                </button>
                              </div>
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

        <ConfirmReasonModal
          open={Boolean(rejectId)}
          title="Reject approval"
          requireReason
          confirmLabel="Reject"
          busy={decide.isPending}
          onClose={() => setRejectId(null)}
          onConfirm={async (reason) => {
            if (!rejectId) return;
            setBusyId(rejectId);
            try {
              await decide.mutateAsync({
                id: rejectId,
                decision: "reject",
                reason,
              });
              addToast("Rejected", "success");
              setRejectId(null);
              setSelected((prev) => prev.filter((x) => x !== rejectId));
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            } finally {
              setBusyId(null);
            }
          }}
        />
      </div>
    </AccountingGate>
  );
}
