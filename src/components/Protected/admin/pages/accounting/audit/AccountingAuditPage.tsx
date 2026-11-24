"use client";

/**
 * Accounting audit trail — activity log with before/after diffs.
 * Default date range matches desk prefetch for split-second open.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  ExternalLink,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  accountingAuditDefaultFilters,
  useAccountingAuditQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  asItems,
  asRecord,
} from "../shared";
import {
  accountingPanelFromHref,
  useAccountingDesk,
  type AccountingDeskPanel,
} from "../accountingDesk";

type AuditRow = {
  id?: string;
  action?: string;
  entityType?: string;
  entityId?: string | null;
  description?: string | null;
  actor?: { id?: string; name?: string } | null;
  reason?: string | null;
  diff?: unknown;
  system?: boolean;
  createdAt?: string;
};

const ENTITY_TYPES = [
  "LedgerAccount",
  "JournalEntry",
  "AccountingPeriod",
  "AccountingSettings",
  "AccountingMapping",
  "TaxCode",
  "Supplier",
  "PurchaseOrder",
  "SupplierBill",
  "SupplierPayment",
  "CustomerReceipt",
  "Expense",
  "BankAccount",
  "BankTransaction",
  "BankTransfer",
  "BankReconciliation",
  "InventoryMovement",
  "BookingInvoice",
] as const;

const ENTITY_LABELS: Record<string, string> = {
  LedgerAccount: "Ledger account",
  JournalEntry: "Journal",
  AccountingPeriod: "Period",
  AccountingSettings: "Accounting settings",
  AccountingMapping: "Account mapping",
  TaxCode: "Tax code",
  Supplier: "Supplier",
  PurchaseOrder: "Purchase order",
  SupplierBill: "Bill",
  SupplierPayment: "Supplier payment",
  CustomerReceipt: "Customer receipt",
  Expense: "Expense",
  BankAccount: "Bank account",
  BankTransaction: "Bank transaction",
  BankTransfer: "Bank transfer",
  BankReconciliation: "Reconciliation",
  InventoryMovement: "Inventory movement",
  BookingInvoice: "Booking invoice",
};

/** Operator-friendly labels for known settings / common audit fields. */
const FIELD_LABELS: Record<string, string> = {
  id: "Record id",
  enabled: "Accounting enabled",
  enabledAt: "Enabled at",
  timezone: "Timezone",
  baseCurrency: "Base currency",
  allowNegativeStock: "Allow negative stock",
  allowSelfApproval: "Allow self-approval",
  billReminderDaysBefore: "Bill reminder days",
  bookingRevenueRecognition: "Booking revenue recognition",
  fiscalYearStartMonth: "Fiscal year start month",
  retainedEarningsAccountId: "Retained earnings account",
  suspenseAccountId: "Suspense account",
  defaultArAccountId: "Default AR account",
  defaultApAccountId: "Default AP account",
  defaultCashAccountId: "Default cash account",
  defaultBankAccountId: "Default bank account",
  inventoryValuationMethod: "Inventory valuation",
  requireJournalApproval: "Require journal approval",
  statementFooter: "Statement footer",
  status: "Status",
  number: "Number",
  name: "Name",
  code: "Code",
  memo: "Memo",
  description: "Description",
  amount: "Amount",
  currency: "Currency",
  postedAt: "Posted at",
  voidedAt: "Voided at",
  closedAt: "Closed at",
  lockedAt: "Locked at",
};

const VALUE_LABELS: Record<string, string> = {
  on_confirm: "On booking confirm",
  on_visit: "On visit / check-in",
  open: "Open",
  closed: "Closed",
  locked: "Locked",
  draft: "Draft",
  posted: "Posted",
  voided: "Voided",
  approved: "Approved",
  rejected: "Rejected",
  fifo: "FIFO",
  weighted_average: "Weighted average",
};

function titleCaseWords(raw: string) {
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanEntityType(type?: string | null) {
  if (!type) return "—";
  return ENTITY_LABELS[type] ?? titleCaseWords(type);
}

function humanFieldLabel(key: string) {
  return FIELD_LABELS[key] ?? titleCaseWords(key);
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

function humanAction(action: string) {
  const raw = action.startsWith("accounting.")
    ? action.slice("accounting.".length)
    : action;
  if (!raw) return "—";
  const known: Record<string, string> = {
    setup: "Accounting setup",
    "settings.update": "Settings updated",
    "period.close": "Period closed",
    "period.reopen": "Period reopened",
    "period.year_end": "Year-end close",
    "journal.create": "Journal created",
    "journal.post": "Journal posted",
    "journal.void": "Journal voided",
    "bill.create": "Bill drafted",
    "bill.post": "Bill posted",
    "bill.void": "Bill voided",
    "bill.approve": "Bill approved",
    "expense.create": "Expense created",
    "expense.post": "Expense posted",
  };
  if (known[raw]) return known[raw];
  const parts = raw.split(".");
  if (parts.length >= 2) {
    const entity = titleCaseWords(parts[0]!);
    const verb = titleCaseWords(parts.slice(1).join(" "));
    return `${entity}: ${verb}`;
  }
  return titleCaseWords(raw);
}

function formatWhen(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.slice(0, 19).replace("T", " ");
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entityHref(entityType?: string, entityId?: string | null) {
  if (!entityType || !entityId) return null;
  const map: Record<string, string> = {
    JournalEntry: `/admin/accounting/journals/${entityId}`,
    LedgerAccount: `/admin/accounting/chart-of-accounts`,
    AccountingPeriod: `/admin/accounting/periods`,
    TaxCode: `/admin/accounting/tax-codes`,
    AccountingMapping: `/admin/accounting/mappings`,
    AccountingSettings: `/admin/accounting/settings`,
    Supplier: `/admin/accounting/suppliers/${entityId}`,
    PurchaseOrder: `/admin/accounting/purchase-orders/${entityId}`,
    SupplierBill: `/admin/accounting/bills/${entityId}`,
    SupplierPayment: `/admin/accounting/supplier-payments/${entityId}`,
    CustomerReceipt: `/admin/accounting/receipts/${entityId}`,
    Expense: `/admin/accounting/expenses/${entityId}`,
    BankAccount: `/admin/accounting/bank-accounts`,
    BankTransfer: `/admin/accounting/transfers`,
    BankReconciliation: `/admin/accounting/reconciliations`,
    InventoryMovement: `/admin/accounting/inventory/movements`,
  };
  return map[entityType] ?? null;
}

function shouldUseAppRoute(href: string) {
  if (
    /\/admin\/accounting\/(bills|supplier-payments|expenses|purchase-orders|journals|suppliers|receipts)\/[^/?]+/.test(
      href
    )
  ) {
    return true;
  }
  return false;
}

type FieldChange = { key: string; from: unknown; to: unknown };

function isFieldDiffEntry(
  v: unknown
): v is { from?: unknown; to?: unknown } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return "from" in rec || "to" in rec;
}

/** Normalize stored audit diffs into a flat field list (matches `diffSnapshots`). */
function parseDiffFields(diff: unknown): FieldChange[] {
  if (diff == null) return [];
  const d = asRecord(diff);

  // Legacy full-snapshot shape: { before, after }
  if ("before" in d || "after" in d) {
    const before = asRecord(d.before);
    const after = asRecord(d.after);
    const keys = new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);
    return [...keys]
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        key,
        from: key in before ? before[key] : null,
        to: key in after ? after[key] : null,
      }))
      .filter(
        (c) => JSON.stringify(c.from) !== JSON.stringify(c.to)
      );
  }

  // Canonical field-level shape: { field: { from, to } }
  return Object.keys(d)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const entry = d[key];
      if (isFieldDiffEntry(entry)) {
        return {
          key,
          from: "from" in entry ? entry.from ?? null : null,
          to: "to" in entry ? entry.to ?? null : null,
        };
      }
      return { key, from: null, to: entry };
    });
}

function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (VALUE_LABELS[v]) return VALUE_LABELS[v];
    // ISO timestamps → readable local time
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return formatWhen(v);
    }
    return v;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "number" || typeof x === "string")) {
      return v.map((x) => String(x)).join(", ");
    }
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function changeKind(c: FieldChange): "added" | "removed" | "changed" {
  if (c.from == null && c.to != null) return "added";
  if (c.from != null && c.to == null) return "removed";
  return "changed";
}

export default function AccountingAuditPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead =
    can(P.AccountingAuditRead) ||
    can(P.AccountingManage) ||
    can(P.AccountingRead);

  const defaults = useMemo(() => accountingAuditDefaultFilters(), []);
  const [entityType, setEntityType] = useState("");
  const [entityIdDraft, setEntityIdDraft] = useState("");
  const [userIdDraft, setUserIdDraft] = useState("");
  const [entityId, setEntityId] = useState("");
  const [userId, setUserId] = useState("");
  const [range, setRange] = useState(defaults);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<AuditRow[][]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [busyDiffId, setBusyDiffId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const appendingRef = useRef(false);
  const appliedDataAtRef = useRef(0);

  const filters = useMemo(
    () => ({
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      userId: userId || undefined,
      from: range.from || undefined,
      to: range.to || undefined,
      ...(cursor ? { cursor } : {}),
    }),
    [entityType, entityId, userId, range.from, range.to, cursor]
  );

  const query = useAccountingAuditQuery(filters, canRead);

  const rows = useMemo(() => pages.flat(), [pages]);

  const blocking = isAdminQueryBlockingLoad(
    query.isLoading && !cursor,
    rows.length > 0 || query.isFetched
  );

  useEffect(() => {
    if (query.isFetching) return;
    // Clear button busy flags even when the request failed / had no body.
    setFilterBusy(false);
    setManualRefresh(false);
    setMoreBusy(false);
    if (!query.data) return;
    // Skip duplicate applies (avoids setState churn / HMR update loops).
    if (
      !appendingRef.current &&
      query.dataUpdatedAt === appliedDataAtRef.current
    ) {
      return;
    }
    appliedDataAtRef.current = query.dataUpdatedAt;
    const items = asItems<AuditRow>(query.data, ["items", "rows"]);
    const next = asRecord(query.data).nextCursor;
    setNextCursor(next ? String(next) : null);
    if (appendingRef.current) {
      appendingRef.current = false;
      setPages((prev) => [...prev, items]);
      return;
    }
    if (!cursor) setPages([items]);
  }, [query.data, query.isFetching, cursor, query.dataUpdatedAt]);

  useEffect(() => {
    if (!busyHref && !busyDiffId) return;
    const t = window.setTimeout(() => {
      setBusyHref(null);
      setBusyDiffId(null);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [busyHref, busyDiffId]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  const fieldChanges = useMemo(
    () => (selected ? parseDiffFields(selected.diff) : []),
    [selected]
  );

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || filterBusy || moreBusy
      ? "manual"
      : "idle";

  const resetPages = () => {
    appendingRef.current = false;
    appliedDataAtRef.current = 0;
    setCursor(undefined);
    setPages([]);
    setNextCursor(null);
  };

  const applyIdFilters = () => {
    const nextEntity = entityIdDraft.trim();
    const nextUser = userIdDraft.trim();
    if (nextEntity === entityId && nextUser === userId) return;
    setFilterBusy(true);
    resetPages();
    setEntityId(nextEntity);
    setUserId(nextUser);
  };

  const onEntityTypeChange = (next: string) => {
    if (next === entityType) return;
    setFilterBusy(true);
    resetPages();
    setEntityType(next);
  };

  const onRangeChange = (next: { from: string; to: string }) => {
    if (next.from === range.from && next.to === range.to) return;
    setFilterBusy(true);
    resetPages();
    setRange(next);
  };

  const onRefresh = () => {
    setManualRefresh(true);
    if (cursor) {
      appendingRef.current = false;
      resetPages();
      return;
    }
    void query.refetch();
  };

  const onLoadMore = () => {
    if (!nextCursor || moreBusy) return;
    appendingRef.current = true;
    setMoreBusy(true);
    setCursor(nextCursor);
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

  const openDiff = (row: AuditRow) => {
    const id = String(row.id ?? "");
    setBusyDiffId(id || "diff");
    setSelected(row);
    window.setTimeout(() => setBusyDiffId(null), 200);
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
                  Audit trail
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length}
                    {nextCursor ? "+" : ""} events
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Who changed what in accounting — with before/after diffs. Stays
                live as journals, bills, periods, and queue actions land.
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
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Filters</h2>
              <p className="text-xs text-stone-500">
                Filter by record type or date. Dates use your company accounting
                timezone.
              </p>
            </div>
            {filterBusy && query.isFetching ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                Applying…
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="audit-entity-type">
                Record type
              </label>
              <select
                id="audit-entity-type"
                value={entityType}
                onChange={(e) => onEntityTypeChange(e.target.value)}
                className="min-w-[12rem] cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              >
                <option value="">All record types</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanEntityType(t)}
                  </option>
                ))}
              </select>
              <input
                className="min-w-[9rem] flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 sm:max-w-[14rem]"
                placeholder="Record id (optional)"
                value={entityIdDraft}
                onChange={(e) => setEntityIdDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyIdFilters();
                }}
              />
              <input
                className="min-w-[9rem] flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 sm:max-w-[14rem]"
                placeholder="Staff user id (optional)"
                value={userIdDraft}
                onChange={(e) => setUserIdDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyIdFilters();
                }}
              />
              <button
                type="button"
                onClick={applyIdFilters}
                disabled={filterBusy}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
              >
                {filterBusy &&
                (entityIdDraft.trim() !== entityId ||
                  userIdDraft.trim() !== userId) ? (
                  <ButtonSpinner />
                ) : (
                  <Search className="h-4 w-4 text-stone-500" />
                )}
                Search
              </button>
            </div>
            <DateRangePicker
              from={range.from}
              to={range.to}
              onChange={onRangeChange}
            />
          </div>
        </div>

        <AccountingErrorMessage error={query.error} />

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-[#D4AF37]" />
              <h2 className="text-sm font-semibold text-stone-900">Events</h2>
            </div>
            {query.isFetching && !blocking ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
                <Loader2 className="h-3 w-3 animate-spin text-[#D4AF37]" />
                Syncing…
              </span>
            ) : null}
          </div>

          {blocking ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <ClipboardList className="h-10 w-10 text-stone-300" />
              <p className="text-sm font-medium text-stone-800">
                No audit events in this range
              </p>
              <p className="max-w-sm text-xs text-stone-500">
                Try widening the dates, clearing entity filters, or perform an
                accounting action — new rows appear live.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                      <th className="whitespace-nowrap px-4 py-3 sm:px-5">
                        When
                      </th>
                      <th className="whitespace-nowrap px-3 py-3">
                        What happened
                      </th>
                      <th className="whitespace-nowrap px-3 py-3">Record</th>
                      <th className="whitespace-nowrap px-3 py-3">Who</th>
                      <th className="px-3 py-3">Summary</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const id = String(r.id ?? "");
                      const href = entityHref(
                        String(r.entityType ?? ""),
                        r.entityId ? String(r.entityId) : null
                      );
                      const actorName =
                        asRecord(r.actor).name != null
                          ? String(asRecord(r.actor).name)
                          : r.system
                            ? "System"
                            : "—";
                      const hasDiff = Boolean(r.diff);
                      const openBusy = Boolean(href && busyHref === href);
                      const diffBusy = busyDiffId === id;
                      return (
                        <tr
                          key={id}
                          className="border-t border-stone-100 transition hover:bg-stone-50/60"
                        >
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-stone-600 sm:px-5">
                            {formatWhen(r.createdAt)}
                          </td>
                          <td className="px-3 py-3 font-medium text-stone-900">
                            {humanAction(String(r.action ?? ""))}
                          </td>
                          <td className="px-3 py-3 text-stone-700">
                            {humanEntityType(
                              r.entityType ? String(r.entityType) : null
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-stone-700">
                            {actorName}
                          </td>
                          <td className="max-w-xs px-3 py-3 text-stone-600">
                            <span className="line-clamp-2">
                              {String(r.description ?? "—")}
                            </span>
                            {r.reason ? (
                              <span className="mt-0.5 block text-[11px] text-amber-800">
                                Reason: {String(r.reason)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right sm:px-5">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              {href ? (
                                <button
                                  type="button"
                                  disabled={openBusy}
                                  onMouseEnter={() => warm(href)}
                                  onFocus={() => warm(href)}
                                  onClick={() => go(href)}
                                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                                >
                                  {openBusy ? (
                                    <ButtonSpinner />
                                  ) : (
                                    <ExternalLink className="h-3.5 w-3.5 text-stone-500" />
                                  )}
                                  Open
                                </button>
                              ) : null}
                              {hasDiff ? (
                                <button
                                  type="button"
                                  disabled={diffBusy}
                                  onClick={() => openDiff(r)}
                                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#8a7318] shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                                >
                                  {diffBusy ? <ButtonSpinner /> : null}
                                  View changes
                                </button>
                              ) : null}
                              {!href && !hasDiff ? (
                                <span className="text-[11px] text-stone-400">
                                  —
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {nextCursor ? (
                <div className="border-t border-stone-100 px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    disabled={moreBusy}
                    onClick={onLoadMore}
                    className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70 sm:w-auto"
                  >
                    {moreBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
                    ) : null}
                    {moreBusy ? "Loading…" : "Load more"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-diff-title"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden border-b border-stone-100">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.14),_transparent_55%)]"
              />
              <div className="relative flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      id="audit-diff-title"
                      className="text-lg font-semibold text-stone-900"
                    >
                      What changed
                    </h2>
                    <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                      {fieldChanges.length}{" "}
                      {fieldChanges.length === 1 ? "change" : "changes"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-stone-600">
                    {humanAction(String(selected.action ?? ""))}
                    {selected.description
                      ? ` — ${String(selected.description)}`
                      : ""}
                  </p>
                  {selected.entityType ? (
                    <p className="mt-1 text-[11px] text-stone-400">
                      {humanEntityType(String(selected.entityType))}
                      {selected.createdAt
                        ? ` · ${formatWhen(selected.createdAt)}`
                        : ""}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Esc
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {fieldChanges.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500">
                  No details were saved for this event.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-stone-200/80">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-stone-50/90 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                        <th className="w-[28%] px-3 py-2.5 sm:px-4">Setting</th>
                        <th className="px-3 py-2.5 sm:px-4">Before</th>
                        <th className="px-3 py-2.5 sm:px-4">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldChanges.map((c) => {
                        const kind = changeKind(c);
                        const rowTone =
                          kind === "added"
                            ? "bg-emerald-50/40"
                            : kind === "removed"
                              ? "bg-red-50/40"
                              : "bg-white";
                        const chip =
                          kind === "added"
                            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                            : kind === "removed"
                              ? "bg-red-50 text-red-800 ring-red-200"
                              : "bg-amber-50 text-amber-900 ring-amber-200";
                        const chipLabel =
                          kind === "added"
                            ? "Added"
                            : kind === "removed"
                              ? "Removed"
                              : "Changed";
                        return (
                          <tr
                            key={c.key}
                            className={`border-t border-stone-100 ${rowTone}`}
                          >
                            <td className="align-top px-3 py-3 sm:px-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-[13px] font-semibold text-stone-800">
                                  {humanFieldLabel(c.key)}
                                </span>
                                <span
                                  className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${chip}`}
                                >
                                  {chipLabel}
                                </span>
                              </div>
                            </td>
                            <td className="align-top px-3 py-3 sm:px-4">
                              <div
                                className={`max-w-md break-words rounded-lg px-2.5 py-2 text-[13px] leading-relaxed ring-1 ${
                                  kind === "removed"
                                    ? "bg-red-50/80 text-red-900 ring-red-100"
                                    : "bg-stone-50 text-stone-600 ring-stone-200/70"
                                }`}
                              >
                                {formatDiffValue(c.from)}
                              </div>
                            </td>
                            <td className="align-top px-3 py-3 sm:px-4">
                              <div
                                className={`max-w-md break-words rounded-lg px-2.5 py-2 text-[13px] leading-relaxed ring-1 ${
                                  kind === "added"
                                    ? "bg-emerald-50/80 text-emerald-900 ring-emerald-100"
                                    : kind === "changed"
                                      ? "bg-[#D4AF37]/10 text-stone-900 ring-[#D4AF37]/25"
                                      : "bg-stone-50 text-stone-600 ring-stone-200/70"
                                }`}
                              >
                                {formatDiffValue(c.to)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 px-4 py-3 sm:px-5">
              {(() => {
                const href = entityHref(
                  selected.entityType
                    ? String(selected.entityType)
                    : undefined,
                  selected.entityId ? String(selected.entityId) : null
                );
                if (!href) return null;
                const openBusy = busyHref === href;
                return (
                  <button
                    type="button"
                    disabled={openBusy}
                    onMouseEnter={() => warm(href)}
                    onFocus={() => warm(href)}
                    onClick={() => go(href)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                  >
                    {openBusy ? (
                      <ButtonSpinner />
                    ) : (
                      <ExternalLink className="h-4 w-4 text-stone-500" />
                    )}
                    Open record
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex cursor-pointer rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
