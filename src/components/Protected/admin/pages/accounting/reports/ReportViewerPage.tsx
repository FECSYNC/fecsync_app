"use client";

/**
 * Single report viewer — live period data with CSV / print actions.
 * Used inside the Reports desk modal (hub → viewer) and as a deep-link route.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingInitialized,
  useAccountingReportQuery,
  useAccountingReportsCatalogQuery,
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
    <div className="animate-pulse space-y-3 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-10 rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

export function ReportViewer({
  reportId,
  onBack,
}: {
  reportId: string;
  onBack: () => void;
}) {
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const catalog = useAccountingReportsCatalogQuery(true);
  const meta = asItems(asRecord(catalog.data).reports ?? catalog.data).find(
    (r) => String(r.id) === reportId
  );

  const initial = useMemo(() => defaultRange(), []);
  const [range, setRange] = useState(initial);
  const [asOf, setAsOf] = useState(initial.to);
  const [locationId, setLocationId] = useState("");
  const [compare, setCompare] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [backBusy, setBackBusy] = useState(false);

  const filters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      asOf,
      ...(locationId ? { locationId } : {}),
      ...(compare ? { compare: "1" } : {}),
    }),
    [range, asOf, locationId, compare]
  );

  const query = useAccountingReportQuery(reportId, filters, Boolean(reportId));
  const data = asRecord(query.data);
  const sections = asItems(data.sections);
  const rows = asItems(data.rows ?? data.lines ?? data.items);

  const hasBody =
    sections.length > 0 ||
    rows.length > 0 ||
    (data.totals != null && typeof data.totals === "object");

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

  useEffect(() => {
    if (!busyAction && !backBusy) return;
    const t = window.setTimeout(() => {
      setBusyAction(null);
      setBackBusy(false);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [busyAction, backBusy]);

  // Reset local filters when switching reports inside the desk.
  useEffect(() => {
    const next = defaultRange();
    setRange(next);
    setAsOf(next.to);
    setLocationId("");
    setCompare(false);
    setFilterBusy(false);
    setManualRefresh(false);
  }, [reportId]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || filterBusy
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void query.refetch();
  };

  const goBack = () => {
    setBackBusy(true);
    onBack();
    window.setTimeout(() => setBackBusy(false), 180);
  };

  const exportCsv = () => {
    setBusyAction("csv");
    const qs = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v != null && v !== "")
      ),
      format: "csv",
    } as Record<string, string>);
    window.open(
      `/api/admin/accounting/reports/${encodeURIComponent(reportId)}?${qs}`,
      "_blank"
    );
  };

  const printReport = () => {
    setBusyAction("print");
    window.print();
  };

  const title = String(meta?.title ?? data.title ?? reportId);

  return (
    <AccountingGate>
      <div className="space-y-5 print:space-y-3 print:p-0">
        <header className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm print:border-0 print:shadow-none">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.16),_transparent_55%),linear-gradient(180deg,#fff_0%,#fafaf9_100%)] print:hidden"
          />
          <div className="relative flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0">
              <button
                type="button"
                onClick={goBack}
                disabled={backBusy}
                className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#8a7318] hover:underline disabled:opacity-70 print:hidden"
              >
                {backBusy ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-4 w-4" />
                )}
                Reports
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  {title}
                </h1>
                <span className="print:hidden">
                  <LivePulse mode={liveMode} />
                </span>
              </div>
              <p className="mt-1.5 text-sm text-stone-600">{reportId}</p>
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-2 print:hidden">
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
                onClick={exportCsv}
                disabled={busyAction === "csv"}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
              >
                {busyAction === "csv" ? (
                  <ButtonSpinner />
                ) : (
                  <Download className="h-4 w-4 text-stone-500" />
                )}
                CSV
              </button>
              <button
                type="button"
                onClick={printReport}
                disabled={busyAction === "print"}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
              >
                {busyAction === "print" ? (
                  <ButtonSpinner />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                Print / PDF
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:px-5 print:hidden">
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
          <label className="block min-w-[10rem] text-sm">
            <span className="mb-1 block font-medium text-stone-700">As of</span>
            <input
              type="date"
              value={asOf}
              onChange={(e) => {
                setFilterBusy(true);
                setAsOf(e.target.value);
              }}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
            />
          </label>
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
          <label className="mb-2 inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => {
                setFilterBusy(true);
                setCompare(e.target.checked);
              }}
              className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
            />
            Compare prior period
          </label>
          {filterBusy ? (
            <span className="inline-flex items-center gap-1.5 pb-2 text-xs font-medium text-stone-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
              Updating…
            </span>
          ) : null}
        </div>

        {query.isError ? <AccountingErrorMessage error={query.error} /> : null}

        {blocking ? (
          <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
            <TableSkeleton />
          </div>
        ) : (
          <>
            {sections.length > 0
              ? sections.map((sec) => (
                  <section
                    key={String(sec.key ?? sec.title)}
                    className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm"
                  >
                    <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/80 px-4 py-3">
                      <h2 className="font-semibold text-stone-900">
                        {String(sec.title)}
                      </h2>
                      {sec.total != null ? (
                        <MoneyCell
                          value={sec.total as string}
                          currency={currency}
                        />
                      ) : null}
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
                                    {String(
                                      row.name ??
                                        row.label ??
                                        row.description ??
                                        ""
                                    )}
                                  </Link>
                                ) : (
                                  String(
                                    row.name ??
                                      row.label ??
                                      row.description ??
                                      row.publicId ??
                                      "—"
                                  )
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <MoneyCell
                                  value={
                                    (row.amount ??
                                      row.balance ??
                                      row.total) as string
                                  }
                                  currency={currency}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))
              : null}

            {sections.length === 0 && rows.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        {Object.keys(rows[0] ?? {})
                          .slice(0, 8)
                          .map((k) => (
                            <th
                              key={k}
                              className="px-4 py-2.5 font-semibold capitalize"
                            >
                              {k}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-t border-stone-100 transition hover:bg-stone-50/70"
                        >
                          {Object.keys(rows[0] ?? {})
                            .slice(0, 8)
                            .map((k) => (
                              <td key={k} className="px-4 py-2.5">
                                {typeof row[k] === "object"
                                  ? JSON.stringify(row[k])
                                  : String(row[k] ?? "")}
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {data.totals && typeof data.totals === "object" ? (
              <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                  Totals
                </h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {Object.entries(data.totals as Record<string, unknown>).map(
                    ([k, v]) => (
                      <li
                        key={k}
                        className="flex justify-between gap-3 border-t border-stone-50 pt-2 first:border-0 first:pt-0"
                      >
                        <span className="capitalize text-stone-700">
                          {k.replace(/([A-Z])/g, " $1")}
                        </span>
                        <MoneyCell value={v as string} currency={currency} />
                      </li>
                    )
                  )}
                </ul>
              </div>
            ) : null}

            {!hasBody && !query.isError ? (
              <div className="flex flex-col items-center rounded-2xl border border-stone-200/80 bg-white px-4 py-16 text-center shadow-sm">
                <p className="text-sm font-medium text-stone-800">
                  No rows for this period
                </p>
                <p className="mt-1 max-w-sm text-xs text-stone-500">
                  Adjust the date range or location, or wait for live posts to
                  land.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AccountingGate>
  );
}

/** Deep-link route: hand off into the desk modal when available. */
export default function ReportViewerPage() {
  const params = useParams();
  const reportId = String(params.report ?? "");
  const desk = useAccountingDesk();

  useEffect(() => {
    if (!reportId || !desk) return;
    desk.openReport(reportId);
  }, [reportId, desk]);

  const onBack = useCallback(() => {
    if (desk) {
      desk.clearReport();
      return;
    }
  }, [desk]);

  // Desk host also intercepts this path; keep a fallback viewer for safety.
  if (!reportId) return null;
  return <ReportViewer reportId={reportId} onBack={onBack} />;
}
