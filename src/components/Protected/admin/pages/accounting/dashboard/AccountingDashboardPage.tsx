"use client";

/**
 * Accounting Dashboard
 *
 * KPI structure (professional desk UX):
 * 1. Performance — period P&L snapshot → opens Profit & Loss report (route)
 * 2. Liquidity & working capital — Cash / AR / AP → Banking, Customers, Bills (desk tabs)
 * 3. Balance sheet extras — Inventory, Tax, Deposits, Gift cards → matching desk tabs
 * 4. Trend + exception lists + alerts
 *
 * Report deep-links use the App Router so the real report opens (not only the Reports hub).
 * Module list links open the accounting desk modal for instant switch.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Banknote,
  Boxes,
  CircleAlert,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import HqScopePolicyBanner from "@/components/Protected/admin/pages/hq/HqScopePolicyBanner";
import SafeResponsiveContainer from "@/components/Protected/admin/pages/components/dashboard/SafeResponsiveContainer";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { accountingDashboardDefaultRange } from "@/services/accounting";
import {
  useAccountingDashboardQuery,
  useAccountingInitialized,
  useAccountingLocationFilter,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  LocationPicker,
  MoneyCell,
} from "../shared";
import {
  accountingPanelFromHref,
  accountingReportIdFromHref,
  useAccountingDesk,
  useAccountingDeskUrlOwner,
} from "../accountingDesk";

type DashPayload = {
  kpis?: Record<string, string | null>;
  cashAccounts?: Array<{
    accountId: string;
    code: string;
    name: string;
    balance: string;
  }>;
  topOverdueCustomers?: Array<{
    partyKey: string;
    name: string;
    overdue: string;
    balance: string;
  }>;
  billsDueSoon?: Array<{
    id: string;
    number: string;
    supplierName: string;
    dueDate: string;
    amountDue: string;
  }>;
  alerts?: {
    postingExceptions?: number;
    pendingApprovals?: number;
    unreconciledBankLines?: number;
    suspenseBalance?: string;
  };
  trend?: Array<{
    month: string;
    revenue: string;
    expenses: string;
    profit: string;
  }>;
};

type DestKind = "report" | "desk" | "route";

type MetricCard = {
  key: string;
  label: string;
  value: string | null | undefined;
  href: string;
  opens: string;
  kind: DestKind;
  icon: LucideIcon;
  hint?: string;
  isPercent?: boolean;
  emphasize?: boolean;
};

function KpiSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-stone-100 bg-white px-4 py-5 ${className}`}
    >
      <div className="h-3 w-24 rounded bg-stone-100" />
      <div className="mt-4 h-8 w-32 rounded bg-stone-100" />
      <div className="mt-3 h-3 w-20 rounded bg-stone-100" />
    </div>
  );
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

function DashAction({
  href,
  busy,
  onNavigate,
  className,
  children,
}: {
  href: string;
  busy: boolean;
  onNavigate: (href: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onNavigate(href)}
      className={className}
    >
      {children}
      {busy ? <ButtonSpinner className="ml-1.5" /> : null}
    </button>
  );
}

function MetricTile({
  card,
  currency,
  busy,
  onNavigate,
  size = "md",
}: {
  card: MetricCard;
  currency: string;
  busy: boolean;
  onNavigate: (href: string) => void;
  size?: "lg" | "md";
}) {
  const Icon = card.icon;
  return (
    <DashAction
      href={card.href}
      busy={busy}
      onNavigate={onNavigate}
      className={`group flex h-full flex-col rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#D4AF37]/45 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/40 disabled:opacity-70 sm:p-5 ${
        card.emphasize
          ? "border-emerald-200/90 bg-gradient-to-br from-emerald-50/80 via-white to-white"
          : "border-stone-200/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          {card.label}
        </p>
        <span className="rounded-lg bg-stone-50 p-1.5 text-stone-400 ring-1 ring-stone-100 transition group-hover:bg-[#D4AF37]/10 group-hover:text-[#8a7318] group-hover:ring-[#D4AF37]/25">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p
        className={`mt-3 font-semibold tabular-nums tracking-tight text-stone-900 ${
          size === "lg" ? "text-2xl sm:text-3xl" : "text-xl"
        }`}
      >
        {card.isPercent ? (
          card.value != null ? (
            card.value
          ) : (
            <span className="text-stone-400">n/a</span>
          )
        ) : (
          <MoneyCell value={card.value} currency={currency} align="left" />
        )}
      </p>
      {card.hint ? (
        <p
          className={`mt-2 text-xs font-medium ${
            card.key === "grossMargin" && !card.value
              ? "text-stone-500"
              : "text-amber-800"
          }`}
        >
          {card.hint}
        </p>
      ) : (
        <span className="mt-auto pt-3" />
      )}
      <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-stone-400 transition group-hover:text-[#8a7318]">
        Opens {card.opens}
        <ArrowUpRight className="h-3 w-3" />
      </p>
    </DashAction>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/** Prefer a real detail route; reports open inside the desk modal. */
function shouldUseAppRoute(href: string) {
  // Customer / bill / invoice / journal detail paths
  if (/\/admin\/accounting\/(customers|bills|invoices|journals)\/[^/?]+/.test(href))
    return true;
  return false;
}

export default function AccountingDashboardPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const desk = useAccountingDesk();
  const ownsUrl = useAccountingDeskUrlOwner("dashboard");
  const loc = useAccountingLocationFilter(sp.get("locationId") ?? "");
  const { settings, initialized } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const defaults = useMemo(() => accountingDashboardDefaultRange(), []);

  const from = sp.get("from") || defaults.from;
  const to = sp.get("to") || defaults.to;
  const locationId = sp.get("locationId") ?? loc.locationId ?? "";

  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      if (!ownsUrl) return;
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      setFilterBusy(true);
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, sp, ownsUrl]
  );

  const filters = useMemo(
    () => ({
      from,
      to,
      locationId: locationId || loc.effectiveLocationId || null,
    }),
    [from, to, locationId, loc.effectiveLocationId]
  );

  const dash = useAccountingDashboardQuery(filters, initialized === true);
  const data = dash.data as DashPayload | undefined;
  const k = data?.kpis ?? {};

  useEffect(() => {
    if (!dash.isFetching) {
      setFilterBusy(false);
      setManualRefresh(false);
    }
  }, [dash.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  const navigateAccounting = useCallback(
    (href: string) => {
      setBusyHref(href);
      const reportId = accountingReportIdFromHref(href);
      if (reportId && desk) {
        desk.openReport(reportId);
        window.setTimeout(() => setBusyHref(null), 180);
        return;
      }
      if (href.includes("/admin/accounting/ledger") && desk) {
        try {
          const u = new URL(href, "http://local.invalid");
          const accountId = u.searchParams.get("accountId") ?? undefined;
          const systemKey = u.searchParams.get("systemKey") ?? undefined;
          desk.openLedger(
            accountId || systemKey ? { accountId, systemKey } : null
          );
        } catch {
          desk.openLedger(null);
        }
        window.setTimeout(() => setBusyHref(null), 180);
        return;
      }
      if (shouldUseAppRoute(href)) {
        // Don't closePanel() first — it syncs the list URL and races this push.
        router.push(href);
        return;
      }
      const panel = accountingPanelFromHref(href);
      if (desk && panel) {
        desk.openPanel(panel);
        window.setTimeout(() => setBusyHref(null), 180);
        return;
      }
      router.push(href);
    },
    [desk, router]
  );

  const onRefresh = useCallback(() => {
    setManualRefresh(true);
    void dash.refetch();
  }, [dash]);

  const performance: MetricCard[] = useMemo(() => {
    const hasRevenue = Number(k.revenue ?? 0) !== 0;
    const marginLabel =
      k.grossMarginPercent != null
        ? `${Number(k.grossMarginPercent).toFixed(1)}%`
        : null;
    return [
      {
        key: "revenue",
        label: "Revenue",
        value: k.revenue,
        href: "/admin/accounting/reports/profit-and-loss",
        opens: "Profit & loss",
        kind: "report",
        icon: TrendingUp,
      },
      {
        key: "expenses",
        label: "Expenses",
        value: k.expenses,
        href: "/admin/accounting/reports/profit-and-loss",
        opens: "Profit & loss",
        kind: "report",
        icon: TrendingDown,
      },
      {
        key: "netProfit",
        label: "Net profit",
        value: k.netProfit,
        href: "/admin/accounting/reports/profit-and-loss",
        opens: "Profit & loss",
        kind: "report",
        icon: Scale,
        emphasize: true,
      },
      {
        key: "grossMargin",
        label: "Gross margin",
        value: marginLabel,
        href: "/admin/accounting/reports/profit-and-loss",
        opens: "Profit & loss",
        kind: "report",
        icon: TrendingUp,
        isPercent: true,
        hint: marginLabel
          ? undefined
          : hasRevenue
            ? "Margin unavailable"
            : "No revenue in this range",
      },
    ];
  }, [k.revenue, k.expenses, k.netProfit, k.grossMarginPercent]);

  const workingCapital: MetricCard[] = useMemo(
    () => [
      {
        key: "cash",
        label: "Cash & bank",
        value: k.cashAndBank,
        href: "/admin/accounting/banking",
        opens: "Banking",
        kind: "desk",
        icon: Wallet,
      },
      {
        key: "ar",
        label: "Receivables",
        value: k.receivables,
        hint: k.receivablesOverdue
          ? `Overdue ${k.receivablesOverdue}`
          : undefined,
        href: "/admin/accounting/customers",
        opens: "Customers",
        kind: "desk",
        icon: Banknote,
      },
      {
        key: "ap",
        label: "Payables",
        value: k.payables,
        hint: k.payablesDueIn7Days
          ? `Due in 7 days ${k.payablesDueIn7Days}`
          : undefined,
        href: "/admin/accounting/bills",
        opens: "Bills",
        kind: "desk",
        icon: Banknote,
      },
    ],
    [k.cashAndBank, k.receivables, k.receivablesOverdue, k.payables, k.payablesDueIn7Days]
  );

  const balanceSheet: MetricCard[] = useMemo(
    () => [
      {
        key: "inventory",
        label: "Inventory value",
        value: k.inventoryValue,
        href: "/admin/accounting/inventory",
        opens: "Inventory",
        kind: "desk",
        icon: Boxes,
      },
      {
        key: "tax",
        label: "Tax payable",
        value: k.taxPayable,
        href: "/admin/accounting/tax",
        opens: "Tax",
        kind: "desk",
        icon: Scale,
      },
      {
        key: "deposits",
        label: "Customer deposits",
        value: k.customerDeposits,
        href: "/admin/accounting/customers",
        opens: "Customers",
        kind: "desk",
        icon: Wallet,
      },
      {
        key: "gift",
        label: "Gift card liability",
        value: k.giftCardLiability,
        href: "/admin/accounting/ledger",
        opens: "General ledger",
        kind: "desk",
        icon: Banknote,
      },
    ],
    [k.inventoryValue, k.taxPayable, k.customerDeposits, k.giftCardLiability]
  );

  const quickReports = [
    {
      label: "Profit & loss",
      href: "/admin/accounting/reports/profit-and-loss",
    },
    {
      label: "Balance sheet",
      href: "/admin/accounting/reports/balance-sheet",
    },
    {
      label: "AR aging",
      href: "/admin/accounting/reports/ar-aging",
    },
    {
      label: "AP aging",
      href: "/admin/accounting/reports/ap-aging",
    },
    {
      label: "Expenses by category",
      href: "/admin/accounting/reports/expenses-by-category",
    },
    {
      label: "Inventory valuation",
      href: "/admin/accounting/reports/inventory-valuation",
    },
  ];

  const trend = (data?.trend ?? []).map((t) => ({
    month: t.month,
    revenue: Number(t.revenue),
    expenses: Number(t.expenses),
    profit: Number(t.profit),
  }));

  const alerts = data?.alerts;
  const suspense = Number(alerts?.suspenseBalance ?? 0);
  const blocking = isAdminQueryBlockingLoad(dash.isLoading, Boolean(data));
  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh
      ? "manual"
      : "idle";
  const pnlHref = "/admin/accounting/reports/profit-and-loss";

  return (
    <AccountingGate requireInitialized={false}>
      <div className="space-y-6">
        <header className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.16),_transparent_55%),linear-gradient(180deg,#fff_0%,#fafaf9_100%)]"
          />
          <div className="relative flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Dashboard
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Period snapshot and working-capital health. Each card opens the
                matching report or workspace — not a dead end.
          </p>
        </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={manualRefresh || blocking}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
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

        {initialized === false ? (
          <div className="rounded-2xl border border-[#D4AF37]/35 bg-[#D4AF37]/5 p-5">
            <h2 className="text-base font-semibold text-stone-900">
              Finish Accounting setup
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Create your chart of accounts, tax codes, and periods so sales and
              expenses can post to the ledger.
            </p>
            <DashAction
              href="/admin/accounting/setup"
              busy={busyHref === "/admin/accounting/setup"}
              onNavigate={navigateAccounting}
              className="mt-3 inline-flex items-center rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030] disabled:opacity-70"
            >
              Start setup
            </DashAction>
          </div>
        ) : null}

        <HqScopePolicyBanner
          locationScoped={loc.locationScoped}
          locationName={loc.scopedLocationName}
        />

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-4">
          <DateRangePicker
            from={from}
            to={to}
            onChange={({ from: f, to: t }) => setParams({ from: f, to: t })}
              disabled={filterBusy && dash.isFetching}
          />
          <LocationPicker
            value={locationId}
            onChange={(id) => {
              loc.setLocationId(id);
              setParams({ locationId: id });
            }}
            syncHqPreference
            className="min-w-[12rem]"
          />
            {filterBusy && dash.isFetching ? (
              <span className="inline-flex items-center gap-1.5 pb-1 text-xs font-medium text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                Applying filters…
              </span>
            ) : null}
          </div>
        </div>

        {dash.isError ? <AccountingErrorMessage error={dash.error} /> : null}

        <div className="space-y-8">
          {/* 1 — Performance (P&L) */}
          <section>
            <SectionHeader
              title="This period"
              subtitle="Income statement snapshot for the selected dates"
              action={
                <DashAction
                  href={pnlHref}
                  busy={busyHref === pnlHref}
                  onNavigate={navigateAccounting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 hover:text-[#6b5a12] disabled:opacity-70"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Open profit & loss
                </DashAction>
              }
            />
            {blocking ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiSkeleton />
                <KpiSkeleton />
                <KpiSkeleton />
                <KpiSkeleton />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {performance.map((card) => (
                  <MetricTile
                    key={card.key}
                    card={card}
                    currency={currency}
                    busy={busyHref === card.href}
                    onNavigate={navigateAccounting}
                    size="lg"
                  />
                ))}
          </div>
            )}
          </section>

          {/* 2 — Liquidity & working capital */}
          <section>
            <SectionHeader
              title="Liquidity & working capital"
              subtitle="Cash position and what customers / suppliers owe"
            />
            {blocking ? (
              <div className="grid gap-3 md:grid-cols-3">
                <KpiSkeleton />
                <KpiSkeleton />
                <KpiSkeleton />
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {workingCapital.map((card) => (
                  <MetricTile
                    key={card.key}
                    card={card}
                    currency={currency}
                    busy={busyHref === card.href}
                    onNavigate={navigateAccounting}
                  />
                ))}
              </div>
            )}
          </section>

          {/* 3 — Balance sheet extras */}
          <section>
            <SectionHeader
              title="Other balances"
              subtitle="Inventory, tax, and liability accounts"
            />
            {blocking ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiSkeleton />
                <KpiSkeleton />
                <KpiSkeleton />
                <KpiSkeleton />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {balanceSheet.map((card) => (
                  <MetricTile
                    key={card.key}
                    card={card}
                    currency={currency}
                    busy={busyHref === card.href}
                    onNavigate={navigateAccounting}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Quick reports — named destinations, not duplicate KPI copy */}
          <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
            <SectionHeader
              title="Quick reports"
              subtitle="Jump straight into a full report for this company"
            />
            <div className="flex flex-wrap gap-2">
              {quickReports.map((r) => (
                <DashAction
                  key={r.href}
                  href={r.href}
                  busy={busyHref === r.href}
                  onNavigate={navigateAccounting}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:border-[#D4AF37]/50 hover:bg-white disabled:opacity-70"
                >
                  {r.label}
                  <ArrowUpRight className="h-3.5 w-3.5 text-stone-400" />
                </DashAction>
              ))}
        </div>
          </section>

          <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-stone-900">
                  12-month trend
          </h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  Revenue, expenses, and profit by month
                </p>
              </div>
              {manualRefresh ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
              ) : null}
            </div>
          <div className="mt-4 h-72 w-full">
              {blocking ? (
                <div className="flex h-full items-center justify-center rounded-xl bg-stone-50">
                  <Loader2 className="h-8 w-8 animate-spin text-[#D4AF37]" />
                </div>
              ) : (
            <SafeResponsiveContainer>
              <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f4" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#D4AF37"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="expenses"
                      stroke="#78716c"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={false}
                    />
              </LineChart>
            </SafeResponsiveContainer>
              )}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
              Cash & bank accounts
            </h2>
                <DashAction
                  href="/admin/accounting/banking"
                  busy={busyHref === "/admin/accounting/banking"}
                  onNavigate={navigateAccounting}
                  className="text-xs font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                >
                  Banking
                </DashAction>
              </div>
              <ul className="divide-y divide-stone-50">
              {(data?.cashAccounts ?? []).length === 0 ? (
                  <li className="px-4 py-6 text-sm text-stone-500">
                    No cash balances.
                  </li>
                ) : (
                  (data?.cashAccounts ?? []).map((a) => {
                    const href = `/admin/accounting/ledger?accountId=${a.accountId}`;
                    return (
                      <li key={a.accountId}>
                        <DashAction
                          href={href}
                          busy={busyHref === href}
                          onNavigate={navigateAccounting}
                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-stone-50 disabled:opacity-70"
                        >
                          <span className="text-stone-900">
                      {a.code} {a.name}
                          </span>
                    <MoneyCell value={a.balance} currency={currency} />
                        </DashAction>
                  </li>
                    );
                  })
              )}
            </ul>
          </section>

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
              Top overdue customers
            </h2>
                <DashAction
                  href="/admin/accounting/customers"
                  busy={busyHref === "/admin/accounting/customers"}
                  onNavigate={navigateAccounting}
                  className="text-xs font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                >
                  Customers
                </DashAction>
              </div>
              <ul className="divide-y divide-stone-50">
              {(data?.topOverdueCustomers ?? []).length === 0 ? (
                  <li className="px-4 py-6 text-sm text-stone-500">
                    Nobody overdue.
                  </li>
                ) : (
                  (data?.topOverdueCustomers ?? []).map((c) => {
                    const href = `/admin/accounting/customers/${encodeURIComponent(c.partyKey)}`;
                    return (
                      <li key={c.partyKey}>
                        <DashAction
                          href={href}
                          busy={busyHref === href}
                          onNavigate={navigateAccounting}
                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-stone-50 disabled:opacity-70"
                        >
                          <span className="text-stone-900">{c.name}</span>
                          <MoneyCell
                            value={c.overdue}
                            currency={currency}
                            className="text-red-700"
                          />
                        </DashAction>
                      </li>
                    );
                  })
              )}
            </ul>
          </section>

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
              Bills due soon
            </h2>
                <DashAction
                  href="/admin/accounting/bills"
                  busy={busyHref === "/admin/accounting/bills"}
                  onNavigate={navigateAccounting}
                  className="text-xs font-medium text-[#8a7318] hover:underline disabled:opacity-70"
                >
                  Bills
                </DashAction>
              </div>
              <ul className="divide-y divide-stone-50">
              {(data?.billsDueSoon ?? []).length === 0 ? (
                  <li className="px-4 py-6 text-sm text-stone-500">
                    No bills due in 7 days.
                  </li>
                ) : (
                  (data?.billsDueSoon ?? []).map((b) => {
                    const href = `/admin/accounting/bills/${b.id}`;
                    return (
                      <li key={b.id}>
                        <DashAction
                          href={href}
                          busy={busyHref === href}
                          onNavigate={navigateAccounting}
                          className="w-full px-4 py-3 text-left text-sm hover:bg-stone-50 disabled:opacity-70"
                        >
                    <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-stone-900">
                        {b.number}
                            </span>
                      <MoneyCell value={b.amountDue} currency={currency} />
                    </div>
                          <p className="text-xs text-stone-500">
                            {b.supplierName} · due{" "}
                            {String(b.dueDate).slice(0, 10)}
                    </p>
                        </DashAction>
                  </li>
                    );
                  })
              )}
            </ul>
          </section>
        </div>

          <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <CircleAlert className="h-4 w-4 text-amber-600" />
              <div>
                <h2 className="text-sm font-semibold text-stone-900">Alerts</h2>
                <p className="text-xs text-stone-500">
                  Exceptions that need a workspace follow-up
                </p>
              </div>
            </div>
          <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  {
                    href: "/admin/accounting/posting-queue",
                    label: `Posting exceptions: ${alerts?.postingExceptions ?? 0}`,
                    warn: (alerts?.postingExceptions ?? 0) > 0,
                  },
                  {
                    href: "/admin/accounting/approvals",
                    label: `Pending approvals: ${alerts?.pendingApprovals ?? 0}`,
                    warn: (alerts?.pendingApprovals ?? 0) > 0,
                  },
                  {
                    href: "/admin/accounting/banking",
                    label: `Unreconciled lines: ${alerts?.unreconciledBankLines ?? 0}`,
                    warn: (alerts?.unreconciledBankLines ?? 0) > 0,
                  },
                  {
                    href: "/admin/accounting/ledger?systemKey=suspense",
                    label: "Suspense balance",
                    warn: suspense !== 0,
                    money: alerts?.suspenseBalance,
                  },
                  {
                    href: "/admin/accounting/periods",
                    label: "Periods",
                    warn: false,
                  },
                ] as const
              ).map((a) => (
                <DashAction
                  key={a.href}
                  href={a.href}
                  busy={busyHref === a.href}
                  onNavigate={navigateAccounting}
                  className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition hover:border-[#D4AF37] disabled:opacity-70 ${
                    a.warn
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-stone-200 bg-white text-stone-700"
                  }`}
                >
                  {a.label}
                  {"money" in a && a.money != null ? (
                    <>
                      : <MoneyCell value={a.money} currency={currency} />
                    </>
                  ) : null}
                </DashAction>
              ))}
          </div>
        </section>
        </div>

        <span className="sr-only">
          <Link href="/admin/accounting/setup">Setup</Link>
        </span>
      </div>
    </AccountingGate>
  );
}
