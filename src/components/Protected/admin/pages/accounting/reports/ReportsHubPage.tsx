"use client";

/**
 * Reports hub — catalog of financial, AR/AP, sales, tax, inventory, and control reports.
 * Catalog key matches desk prefetch for instant open; hover warms each report viewer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  Boxes,
  ClipboardList,
  FileBarChart2,
  Landmark,
  Loader2,
  Receipt,
  RefreshCw,
  Scale,
  Search,
  Shield,
  ShoppingBag,
  Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  accountingKeys,
  useAccountingReportsCatalogQuery,
} from "@/hooks/useAccounting";
import { getAccountingReport } from "@/services/accounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  asItems,
  asRecord,
  todayIsoDate,
} from "../shared";
import { useAccountingDesk } from "../accountingDesk";
import { ReportViewer } from "./ReportViewerPage";

type ReportMeta = {
  id: string;
  title: string;
  group: string;
  requiresAudit?: boolean;
};

const GROUP_ORDER = [
  "Financial statements",
  "Receivables",
  "Payables",
  "Sales",
  "Expenses",
  "Tax",
  "Inventory",
  "Banking",
  "Control",
] as const;

const GROUP_META: Record<
  string,
  { blurb: string; Icon: ComponentType<{ className?: string }> }
> = {
  "Financial statements": {
    blurb: "P&L, balance sheet, cash flow, and ledger views.",
    Icon: FileBarChart2,
  },
  Receivables: {
    blurb: "Aging and customer balances.",
    Icon: Users,
  },
  Payables: {
    blurb: "Aging and supplier balances.",
    Icon: Scale,
  },
  Sales: {
    blurb: "Location, product, channel, and tender splits.",
    Icon: ShoppingBag,
  },
  Expenses: {
    blurb: "Spend by category and supplier.",
    Icon: Receipt,
  },
  Tax: {
    blurb: "Collected and payable tax summaries.",
    Icon: Landmark,
  },
  Inventory: {
    blurb: "Valuation, movements, and margin.",
    Icon: Boxes,
  },
  Banking: {
    blurb: "Reconciliation status and statement checks.",
    Icon: Banknote,
  },
  Control: {
    blurb: "Subledger integrity and audit trail.",
    Icon: Shield,
  },
};

function defaultReportFilters() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = todayIsoDate();
  return { from, to, asOf: to };
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

function CatalogSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      {Array.from({ length: 3 }).map((_, g) => (
        <div key={g} className="space-y-3">
          <div className="h-4 w-40 rounded bg-stone-100" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((__, i) => (
              <div key={i} className="h-24 rounded-2xl bg-stone-100" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ReportsHubPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead =
    can(P.AccountingReportsRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canAudit =
    can(P.AccountingAuditRead) || can(P.AccountingManage);

  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Fallback when desk API is unavailable (rare standalone mount). */
  const [localReportId, setLocalReportId] = useState<string | null>(null);

  const activeReportId = desk?.reportId ?? localReportId;

  // Bookmark / share: `/admin/accounting/reports?report=profit-and-loss`
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URLSearchParams(window.location.search).get("report");
    if (!fromUrl) return;
    if (desk?.reportId === fromUrl || localReportId === fromUrl) return;
    if (desk) {
      desk.openReport(fromUrl);
      return;
    }
    setLocalReportId(fromUrl);
  }, [desk, desk?.reportId, localReportId]);

  const catalog = useAccountingReportsCatalogQuery(canRead);
  const reports = useMemo(
    () =>
      asItems<ReportMeta>(asRecord(catalog.data).reports ?? catalog.data).map(
        (r) => ({
          id: String(r.id),
          title: String(r.title ?? r.id),
          group: String(r.group ?? "Control"),
          requiresAudit: Boolean(r.requiresAudit),
        })
      ),
    [catalog.data]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q)
    );
  }, [reports, query]);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: filtered.filter((r) => r.group === group),
        ...GROUP_META[group],
      })).filter((g) => g.items.length > 0),
    [filtered]
  );

  const blocking = isAdminQueryBlockingLoad(
    catalog.isLoading,
    reports.length > 0 || catalog.isFetched
  );

  useEffect(() => {
    if (!catalog.isFetching) setManualRefresh(false);
  }, [catalog.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1600);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!canRead || reports.length === 0) return;
    if (process.env.NODE_ENV === "development") return;
    const defaults = defaultReportFilters();
    const priority = [
      "profit-and-loss",
      "balance-sheet",
      "ar-aging",
      "ap-aging",
    ];
    for (const id of priority) {
      if (!reports.some((r) => r.id === id)) continue;
      void qc.prefetchQuery({
        queryKey: accountingKeys.report(id, defaults),
        queryFn: () => getAccountingReport(id, defaults),
      });
    }
  }, [canRead, reports, qc]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void catalog.refetch();
  };

  const warm = useCallback(
    (href: string, reportId?: string) => {
      prefetchAdminRoute(qc, href, can, user);
      router.prefetch(href);
      if (reportId) {
        const defaults = defaultReportFilters();
        void qc.prefetchQuery({
          queryKey: accountingKeys.report(reportId, defaults),
          queryFn: () => getAccountingReport(reportId, defaults),
        });
      }
    },
    [qc, can, user, router]
  );

  const go = useCallback(
    (href: string, reportId: string) => {
      setBusyHref(href);
      warm(href, reportId);
      if (desk) {
        desk.openReport(reportId);
        window.setTimeout(() => setBusyHref(null), 180);
        return;
      }
      setLocalReportId(reportId);
      window.setTimeout(() => setBusyHref(null), 180);
    },
    [desk, warm]
  );

  const clearActiveReport = useCallback(() => {
    if (desk) {
      desk.clearReport();
      return;
    }
    setLocalReportId(null);
  }, [desk]);

  if (activeReportId) {
    return (
      <ReportViewer reportId={activeReportId} onBack={clearActiveReport} />
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
                  Reports
                </h1>
                <LivePulse mode={liveMode} />
                {reports.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {reports.length} reports
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Financial statements, aging, sales, tax, inventory, and control
                — numbers stay live as journals, payments, and stock move.
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={manualRefresh || blocking}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
            >
              {manualRefresh ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
              ) : (
                <RefreshCw className="h-4 w-4 text-stone-500" />
              )}
              {manualRefresh ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports by name or group…"
            className="w-full rounded-2xl border border-stone-200/80 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
          />
        </div>

        {catalog.isError ? (
          <AccountingErrorMessage error={catalog.error} />
        ) : null}

        {blocking ? (
          <CatalogSkeleton />
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-stone-200/80 bg-white px-4 py-16 text-center shadow-sm">
            <ClipboardList className="h-9 w-9 text-stone-300" />
            <p className="mt-3 text-sm font-medium text-stone-800">
              {query.trim() ? "No reports match that search" : "No reports available"}
            </p>
            <p className="mt-1 max-w-sm text-xs text-stone-500">
              {query.trim()
                ? "Try another name, id, or group."
                : "Your plan or permissions may not include reporting yet."}
            </p>
            {query.trim() ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-4 rounded-xl border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Clear search
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map((g) => {
              const Icon = g.Icon ?? FileBarChart2;
              return (
                <section key={g.group} className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#8a7318]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                          {g.group}
                        </h2>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600">
                          {g.items.length}
                        </span>
                      </div>
                      {g.blurb ? (
                        <p className="mt-1 text-xs text-stone-500">{g.blurb}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((r) => {
                      const href = `/admin/accounting/reports/${r.id}`;
                      const locked = Boolean(r.requiresAudit) && !canAudit;
                      const busy = busyHref === href;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          disabled={locked || Boolean(busyHref)}
                          onClick={() => go(href, r.id)}
                          onMouseEnter={() => {
                            if (!locked) warm(href, r.id);
                          }}
                          onFocus={() => {
                            if (!locked) warm(href, r.id);
                          }}
                          className="group relative flex flex-col rounded-2xl border border-stone-200/80 bg-white p-4 text-left shadow-sm transition hover:border-[#D4AF37]/70 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-stone-900 group-hover:text-[#8a7318]">
                                {r.title}
                              </p>
                              <p className="mt-1 truncate text-xs text-stone-500">
                                {r.id}
                              </p>
                            </div>
                            {busy ? (
                              <ButtonSpinner className="text-[#D4AF37]" />
                            ) : (
                              <ArrowRight className="h-4 w-4 shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-[#D4AF37]" />
                            )}
                          </div>
                          {r.requiresAudit ? (
                            <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200">
                              <Shield className="h-3 w-3" />
                              {locked ? "Audit permission required" : "Audit"}
                            </span>
                          ) : (
                            <span className="mt-3 text-[11px] font-medium text-stone-400">
                              Opens with live period filters
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </AccountingGate>
  );
}
