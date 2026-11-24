"use client";

/**
 * Tax desk — output / input / net payable for the selected period.
 * Default month-to-date filters match desk prefetch for split-second open.
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileBarChart2,
  Landmark,
  Loader2,
  RefreshCw,
  Settings2,
  Tags,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingInitialized,
  useAccountingReportQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  LocationPicker,
  MoneyCell,
  asItems,
  asRecord,
  todayIsoDate,
} from "../shared";
import { useAccountingDesk } from "../accountingDesk";

/** Lazy so Tax page opens fast; only compiles when the sheet opens. */
const TaxSettingsPage = lazy(
  () =>
    import("@/components/Protected/admin/pages/tax-settings/TaxSettingsPage")
);

function defaultRange() {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10),
    to: todayIsoDate(),
  };
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
    <div className="animate-pulse space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-stone-100" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 rounded-2xl bg-stone-100" />
      ))}
    </div>
  );
}

export default function AccountingTaxPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead =
    can(P.AccountingReportsRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canTaxSettings = can(P.TaxManage);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const [range, setRange] = useState(defaultRange);
  const [locationId, setLocationId] = useState("");
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyAction, setBusyAction] = useState<
    null | "tax-codes" | "tax-settings" | "full-report"
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);

  /** Keys match desk prefetch when location is company-wide and range is MTD. */
  const filters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      ...(locationId ? { locationId } : {}),
    }),
    [range, locationId]
  );

  const query = useAccountingReportQuery("tax-summary", filters, canRead);
  const data = asRecord(query.data);
  const sections = asItems(data.sections);
  const totals = asRecord(data.totals);
  const exempt = asItems(
    sections.find((s) => String(s.key) === "exempt")?.rows
  );
  const detailSections = sections.filter((s) => String(s.key) !== "exempt");

  const hasBody =
    detailSections.length > 0 ||
    exempt.length > 0 ||
    totals.output != null ||
    totals.input != null ||
    totals.netPayable != null;

  const blocking = isAdminQueryBlockingLoad(
    query.isLoading,
    hasBody || query.isFetched
  );

  useEffect(() => {
    if (!query.isFetching) {
      setManualRefresh(false);
      setFilterBusy(false);
    }
  }, [query.isFetching]);

  // Clear spinner once the desk actually landed on the target panel.
  useEffect(() => {
    if (!busyAction) return;
    if (busyAction === "tax-codes" && desk?.panel === "tax-codes") {
      setBusyAction(null);
      return;
    }
    if (busyAction === "full-report" && desk?.panel === "reports" && desk.reportId === "tax-summary") {
      setBusyAction(null);
      return;
    }
    const t = window.setTimeout(() => setBusyAction(null), 2200);
    return () => window.clearTimeout(t);
  }, [busyAction, desk?.panel, desk?.reportId]);

  useEffect(() => {
    if (!canRead) return;
    if (process.env.NODE_ENV === "development") return;
    desk?.warmPanel("tax-codes");
  }, [canRead, desk]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || filterBusy
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void query.refetch();
  };

  const warmTaxCodes = useCallback(() => {
    try {
      desk?.warmPanel("tax-codes");
      prefetchAdminRoute(qc, "/admin/accounting/tax-codes", can, user);
      router.prefetch("/admin/accounting/tax-codes");
    } catch {
      /* never block open */
    }
  }, [desk, qc, can, user, router]);

  const openTaxCodes = useCallback(() => {
    setBusyAction("tax-codes");
    warmTaxCodes();
    if (desk) {
      desk.openPanel("tax-codes");
      return;
    }
    router.push("/admin/accounting/tax-codes");
  }, [desk, router, warmTaxCodes]);

  const openTaxSettings = useCallback(() => {
    setBusyAction("tax-settings");
    setSettingsMounted(true);
    setSettingsOpen(true);
    // Prefetch data while the sheet animates in.
    try {
      prefetchAdminRoute(qc, "/admin/tax-settings", can, user);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => setBusyAction(null), 200);
  }, [qc, can, user]);

  const openFullReport = useCallback(() => {
    setBusyAction("full-report");
    try {
      prefetchAdminRoute(
        qc,
        "/admin/accounting/reports/tax-summary",
        can,
        user
      );
    } catch {
      /* ignore */
    }
    if (desk) {
      desk.openReport("tax-summary");
      return;
    }
    router.push("/admin/accounting/reports/tax-summary");
  }, [desk, router, qc, can, user]);

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
                  Tax
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Output, input, and net payable for the selected period — stays
                live as invoices, bills, and bookings post.
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
              <button
                type="button"
                disabled={busyAction === "tax-codes"}
                onClick={openTaxCodes}
                onMouseEnter={warmTaxCodes}
                onFocus={warmTaxCodes}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
              >
                {busyAction === "tax-codes" ? (
                  <ButtonSpinner />
                ) : (
                  <Tags className="h-4 w-4 text-stone-500" />
                )}
                {busyAction === "tax-codes" ? "Opening…" : "Tax codes"}
              </button>
              {canTaxSettings ? (
                <button
                  type="button"
                  disabled={busyAction === "tax-settings" || settingsOpen}
                  onClick={openTaxSettings}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                >
                  {busyAction === "tax-settings" ? (
                    <ButtonSpinner />
                  ) : (
                    <Settings2 className="h-4 w-4 text-stone-500" />
                  )}
                  {busyAction === "tax-settings"
                    ? "Opening…"
                    : "Checkout tax settings"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busyAction === "full-report"}
                onClick={openFullReport}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
              >
                {busyAction === "full-report" ? (
                  <ButtonSpinner />
                ) : (
                  <FileBarChart2 className="h-4 w-4" />
                )}
                {busyAction === "full-report" ? "Opening…" : "Full report"}
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:px-5">
          <div className="min-w-[16rem] flex-1">
            <DateRangePicker
              from={range.from}
              to={range.to}
              onChange={(next) => {
                setFilterBusy(true);
                setRange(next);
              }}
            />
          </div>
          <LocationPicker
            value={locationId}
            onChange={(id) => {
              setFilterBusy(true);
              setLocationId(id);
            }}
            allowCompanyWide
            syncHqPreference
            className="min-w-[12rem] flex-1 sm:max-w-xs"
          />
          {filterBusy ? (
            <span className="inline-flex items-center gap-1.5 pb-2 text-xs font-medium text-stone-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
              Updating…
            </span>
          ) : null}
        </div>

        {query.isError ? <AccountingErrorMessage error={query.error} /> : null}

        {blocking ? (
          <TableSkeleton />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Output tax
                </p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-stone-900">
                  <MoneyCell
                    value={totals.output as string}
                    currency={currency}
                    align="left"
                  />
                </p>
                <p className="mt-1 text-xs text-stone-500">Collected</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Input tax
                </p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-stone-900">
                  <MoneyCell
                    value={totals.input as string}
                    currency={currency}
                    align="left"
                  />
                </p>
                <p className="mt-1 text-xs text-stone-500">Recoverable</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Net payable
                </p>
                <p
                  className={`mt-2 text-xl font-semibold tabular-nums ${
                    Number(totals.netPayable ?? 0) < 0
                      ? "text-emerald-800"
                      : "text-stone-900"
                  }`}
                >
                  <MoneyCell
                    value={totals.netPayable as string}
                    currency={currency}
                    align="left"
                  />
                </p>
                <p className="mt-1 text-xs text-stone-500">Output − input</p>
              </div>
            </div>

            {detailSections.length === 0 && !query.isError ? (
              <div className="flex flex-col items-center rounded-2xl border border-stone-200/80 bg-white px-4 py-14 text-center shadow-sm">
                <Landmark className="h-9 w-9 text-stone-300" />
                <p className="mt-3 text-sm font-medium text-stone-800">
                  No tax activity in this period
                </p>
                <p className="mt-1 max-w-sm text-xs text-stone-500">
                  Posted invoices, bills, and taxable sales will appear here as
                  they land.
                </p>
              </div>
            ) : null}

            {detailSections.map((sec) => (
              <section
                key={String(sec.key)}
                className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/80 px-4 py-3">
                  <h2 className="font-semibold text-stone-900">
                    {String(sec.title)}
                  </h2>
                  <MoneyCell
                    value={sec.total as string}
                    currency={currency}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <tbody>
                      {asItems(sec.rows).map((row, i) => (
                        <tr
                          key={i}
                          className="border-t border-stone-50 transition hover:bg-stone-50/70"
                        >
                          <td className="px-4 py-2.5">
                            {row.accountId ? (
                              <Link
                                href={`/admin/accounting/ledger?accountId=${String(row.accountId)}`}
                                className="font-medium text-[#8a7318] hover:underline"
                              >
                                {String(row.code ?? "")}{" "}
                                {String(row.name ?? "")}
                              </Link>
                            ) : (
                              <span className="text-stone-800">
                                {String(row.name ?? "—")}
                              </span>
                            )}
                            {row.rate != null && row.rate !== "" ? (
                              <span className="ml-2 text-xs text-stone-500">
                                {Number(row.rate).toFixed(2)}%
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={row.amount as string}
                              currency={currency}
                            />
                          </td>
                        </tr>
                      ))}
                      {asItems(sec.rows).length === 0 ? (
                        <tr>
                          <td
                            colSpan={2}
                            className="px-4 py-6 text-center text-sm text-stone-500"
                          >
                            No lines in this section.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="border-b border-stone-100 bg-stone-50/80 px-4 py-3 font-semibold text-stone-900">
                Tax-exempt bookings
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Booking</th>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">Reason</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {exempt.map((b) => (
                      <tr
                        key={String(b.bookingId ?? b.publicId)}
                        className="border-t border-stone-100 transition hover:bg-stone-50/70"
                      >
                        <td className="px-4 py-2.5 font-medium text-stone-900">
                          {String(b.publicId ?? b.bookingId)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-stone-700">
                          {String(b.date ?? "").slice(0, 10)}
                        </td>
                        <td className="px-4 py-2.5 text-stone-600">
                          {String(b.reason ?? "—")}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <MoneyCell
                            value={b.total as string}
                            currency={currency}
                          />
                        </td>
                      </tr>
                    ))}
                    {!exempt.length ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-8 text-center text-sm text-stone-500"
                        >
                          No exempt bookings in range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {settingsMounted ? (
        <div
          className={`fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4 ${
            settingsOpen ? "" : "pointer-events-none"
          }`}
          aria-hidden={!settingsOpen}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close checkout tax settings"
            className={`absolute inset-0 bg-stone-900/40 transition-opacity ${
              settingsOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setSettingsOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Checkout tax settings"
            className={`relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-stone-200 bg-[#faf9f7] shadow-2xl transition-all sm:rounded-2xl ${
              settingsOpen
                ? "translate-y-0 opacity-100"
                : "translate-y-4 opacity-0"
            }`}
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-stone-900">
                  Checkout tax settings
                </h2>
                <p className="text-xs text-stone-500">
                  Storefront rate and label used at checkout.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {settingsOpen ? (
                <Suspense
                  fallback={
                    <div className="flex min-h-[40vh] items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-[#D4AF37]" />
                    </div>
                  }
                >
                  <TaxSettingsPage />
                </Suspense>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
