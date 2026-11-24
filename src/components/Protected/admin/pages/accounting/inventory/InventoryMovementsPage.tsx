"use client";

/**
 * Inventory movements — history of receipts, sales, adjustments, revaluations.
 * Empty default filters match desk prefetch; live poll stays aligned with valuation.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  History,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  useAccountingInitialized,
  useInventoryMovementsQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  LocationPicker,
  MoneyCell,
  asItems,
  todayIsoDate,
} from "../shared";
import {
  accountingPanelFromHref,
  useAccountingDesk,
  type AccountingDeskPanel,
} from "../accountingDesk";

type MovementRow = {
  id?: string;
  createdAt?: string;
  productName?: string;
  posProductId?: string;
  shopProductId?: string;
  kind?: string;
  qty?: string | number;
  unitCost?: string | null;
  totalCost?: string | null;
  reason?: string | null;
};

const KIND_OPTIONS = [
  "purchase_receipt",
  "sale",
  "adjustment_in",
  "adjustment_out",
  "revaluation",
  "wastage",
  "transfer",
] as const;

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

export default function InventoryMovementsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead =
    can(P.AccountingInventoryRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const [productRef, setProductRef] = useState("");
  const [kind, setKind] = useState("");
  const [locationId, setLocationId] = useState("");
  /** Empty range matches desk prefetch `{}` for instant open. */
  const [range, setRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);

  const filters = useMemo(() => {
    const next: Record<string, string> = {};
    if (productRef.trim()) next.productRef = productRef.trim();
    if (kind) next.kind = kind;
    if (locationId) next.locationId = locationId;
    if (range.from) next.from = range.from;
    if (range.to) next.to = range.to;
    return next;
  }, [productRef, kind, locationId, range.from, range.to]);

  const query = useInventoryMovementsQuery(filters, canRead);
  const rows = useMemo(
    () => asItems<MovementRow>(query.data, ["items", "movements", "rows"]),
    [query.data]
  );

  const blocking = isAdminQueryBlockingLoad(
    query.isLoading,
    rows.length > 0 || query.isFetched
  );

  useEffect(() => {
    if (!query.isFetching) {
      setManualRefresh(false);
      setFilterBusy(false);
    }
  }, [query.isFetching]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 1400);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!canRead) return;
    if (process.env.NODE_ENV === "development") return;
    desk?.warmPanel("inventory");
  }, [canRead, desk]);

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || filterBusy
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void query.refetch();
  };

  const warm = useCallback(
    (href: string) => {
      prefetchAdminRoute(qc, href, can, user);
      router.prefetch(href);
      const panel = accountingPanelFromHref(href);
      if (panel) desk?.warmPanel(panel);
    },
    [qc, can, user, router, desk]
  );

  const go = useCallback(
    (href: string) => {
      setBusyHref(href);
      warm(href);
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

  const inventoryHref = "/admin/accounting/inventory";
  const displayRange = {
    from: range.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    to: range.to || todayIsoDate(),
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
                  Inventory movements
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} rows
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Receipts, sales, adjustments, and revaluations — stays live with
                valuation and cost changes.
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
                disabled={Boolean(busyHref)}
                onClick={() => go(inventoryHref)}
                onMouseEnter={() => warm(inventoryHref)}
                onFocus={() => warm(inventoryHref)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
              >
                {busyHref === inventoryHref ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-4 w-4 text-stone-500" />
                )}
                Valuation
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:px-5">
          <label className="block min-w-[12rem] flex-1 text-sm sm:max-w-xs">
            <span className="mb-1 block font-medium text-stone-700">
              Product ref
            </span>
            <input
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              placeholder="pos:… / shop:…"
              value={productRef}
              onChange={(e) => {
                setFilterBusy(true);
                setProductRef(e.target.value);
              }}
            />
          </label>
          <label className="block min-w-[10rem] text-sm">
            <span className="mb-1 block font-medium text-stone-700">Kind</span>
            <select
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              value={kind}
              onChange={(e) => {
                setFilterBusy(true);
                setKind(e.target.value);
              }}
            >
              <option value="">All kinds</option>
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </select>
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
          <div className="min-w-[16rem] flex-1">
            <DateRangePicker
              from={displayRange.from}
              to={displayRange.to}
              onChange={(next) => {
                setFilterBusy(true);
                setRange(next);
              }}
            />
          </div>
          {filterBusy ? (
            <span className="inline-flex items-center gap-1.5 pb-2 text-xs font-medium text-stone-500">
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
              <History className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No movements yet
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Stock receipts, sales, and adjustments will appear here in
                realtime.
              </p>
              <button
                type="button"
                disabled={busyHref === inventoryHref}
                onClick={() => go(inventoryHref)}
                onMouseEnter={() => warm(inventoryHref)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-70"
              >
                {busyHref === inventoryHref ? (
                  <ButtonSpinner />
                ) : (
                  <Package className="h-4 w-4 text-stone-500" />
                )}
                Back to valuation
              </button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((m) => (
                  <div
                    key={String(m.id)}
                    className="flex flex-col gap-2 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-900">
                          {String(
                            m.productName ??
                              m.posProductId ??
                              m.shopProductId ??
                              "—"
                          )}
                        </p>
                        <p className="mt-0.5 text-xs capitalize text-stone-500">
                          {String(m.kind ?? "").replace(/_/g, " ") || "—"}
                        </p>
                      </div>
                      <MoneyCell
                        value={m.totalCost as string}
                        currency={currency}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-stone-600">
                      <span className="tabular-nums">
                        {String(m.createdAt ?? "")
                          .slice(0, 19)
                          .replace("T", " ") || "—"}
                      </span>
                      <span>
                        Qty{" "}
                        <span className="font-semibold tabular-nums text-stone-900">
                          {String(m.qty ?? "0")}
                        </span>
                      </span>
                    </div>
                    {m.reason ? (
                      <p className="text-xs text-stone-500">{m.reason}</p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50/80 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">When</th>
                      <th className="px-4 py-2.5 font-semibold">Product</th>
                      <th className="px-4 py-2.5 font-semibold">Kind</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Unit cost
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Total
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr
                        key={String(m.id)}
                        className="border-t border-stone-100 transition hover:bg-stone-50/70"
                      >
                        <td className="px-4 py-2.5 tabular-nums text-stone-700">
                          {String(m.createdAt ?? "")
                            .slice(0, 19)
                            .replace("T", " ") || "—"}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-stone-900">
                          {String(
                            m.productName ??
                              m.posProductId ??
                              m.shopProductId ??
                              "—"
                          )}
                        </td>
                        <td className="px-4 py-2.5 capitalize text-stone-700">
                          {String(m.kind ?? "").replace(/_/g, " ") || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {String(m.qty ?? "0")}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <MoneyCell
                            value={m.unitCost as string}
                            currency={currency}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <MoneyCell
                            value={m.totalCost as string}
                            currency={currency}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-stone-600">
                          {String(m.reason ?? "—")}
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
    </AccountingGate>
  );
}
