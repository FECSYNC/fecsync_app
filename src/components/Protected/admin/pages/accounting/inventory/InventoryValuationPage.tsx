"use client";

/**
 * Inventory valuation — on-hand qty, average cost, and value by product.
 * Empty filters match desk prefetch for instant open; live poll keeps
 * adjustments / costs / PO receive / sales in sync with movements + dashboard.
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
  History,
  Loader2,
  Package,
  RefreshCw,
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
  useInventoryAdjustmentMutation,
  useInventoryValuationQuery,
  usePatchInventoryCostsMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  LocationPicker,
  MoneyCell,
  MoneyInput,
  accountingErrorMessage,
  asItems,
  asRecord,
  todayIsoDate,
} from "../shared";
import {
  accountingPanelFromHref,
  useAccountingDesk,
  type AccountingDeskPanel,
} from "../accountingDesk";

type InventoryRow = {
  productRef?: { posProductId?: string; shopProductId?: string };
  posProductId?: string;
  shopProductId?: string;
  name?: string;
  productName?: string;
  sku?: string | null;
  kind?: string;
  locationId?: string | null;
  qty?: string | number;
  onHand?: string | number;
  onHandNow?: string | number;
  avgCost?: string | number | null;
  unitCost?: string | number | null;
  value?: string | number | null;
  flagged?: boolean;
  reorderLevel?: number | null;
  lastMovementAt?: string | null;
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

function rowKey(row: InventoryRow, index: number) {
  const ref = row.productRef;
  return String(
    ref?.posProductId ??
      ref?.shopProductId ??
      row.posProductId ??
      row.shopProductId ??
      `${row.name ?? "row"}-${row.locationId ?? ""}-${index}`
  );
}

function productRefOf(row: InventoryRow) {
  if (row.productRef?.posProductId) {
    return { posProductId: String(row.productRef.posProductId) };
  }
  if (row.productRef?.shopProductId) {
    return { shopProductId: String(row.productRef.shopProductId) };
  }
  if (row.posProductId) return { posProductId: String(row.posProductId) };
  if (row.shopProductId) return { shopProductId: String(row.shopProductId) };
  return null;
}

function flagLabels(row: InventoryRow) {
  const qty = Number(row.qty ?? row.onHand ?? 0);
  const avg = row.avgCost ?? row.unitCost;
  const missingCost = avg == null || avg === "" || Number(avg) === 0;
  const negative = qty < 0;
  const labels: string[] = [];
  if (missingCost) labels.push("Cost missing");
  if (negative) labels.push("Negative stock");
  else if (row.flagged && !missingCost) labels.push("Flagged");
  return { labels, missingCost, negative, qty, avg };
}

export default function InventoryValuationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const desk = useAccountingDesk();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead =
    can(P.AccountingInventoryRead) ||
    can(P.AccountingRead) ||
    can(P.AccountingManage);
  const canWrite =
    can(P.AccountingInventoryWrite) || can(P.AccountingManage);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  /** Empty default matches desk prefetch for split-second open. */
  const [asOf, setAsOf] = useState("");
  const [locationId, setLocationId] = useState("");
  const [filterBusy, setFilterBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [costTarget, setCostTarget] = useState<InventoryRow | null>(null);
  const [costValue, setCostValue] = useState("0.00");
  const [costReason, setCostReason] = useState("Cost update");
  const [adjTarget, setAdjTarget] = useState<InventoryRow | null>(null);
  const [adjQty, setAdjQty] = useState("0");
  const [adjCost, setAdjCost] = useState("0.00");
  const [adjReason, setAdjReason] = useState("Stock adjustment");
  const [adjLocationId, setAdjLocationId] = useState("");

  const filters = useMemo(
    () => ({
      ...(asOf ? { asOf } : {}),
      ...(locationId ? { locationId } : {}),
    }),
    [asOf, locationId]
  );

  const query = useInventoryValuationQuery(filters, canRead);
  const setCost = usePatchInventoryCostsMutation();
  const adjust = useInventoryAdjustmentMutation();

  const data = asRecord(query.data);
  const rows = useMemo(
    () => asItems<InventoryRow>(query.data, ["rows", "items", "products"]),
    [query.data]
  );

  const flaggedCount = useMemo(
    () => rows.filter((r) => flagLabels(r).labels.length > 0).length,
    [rows]
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
    desk?.warmPanel("inventory-movements");
  }, [canRead, desk]);

  useEffect(() => {
    if (!costTarget && !adjTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (setCost.isPending || adjust.isPending) return;
      setCostTarget(null);
      setAdjTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [costTarget, adjTarget, setCost.isPending, adjust.isPending]);

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

  const openCost = (row: InventoryRow) => {
    const key = rowKey(row, 0);
    setBusyAction(`cost-${key}`);
    setCostTarget(row);
    setCostValue(String(row.avgCost ?? row.unitCost ?? "0.00"));
    setCostReason("Cost update");
    window.setTimeout(() => setBusyAction(null), 200);
  };

  const openAdjust = (row: InventoryRow) => {
    const key = rowKey(row, 0);
    setBusyAction(`adj-${key}`);
    setAdjTarget(row);
    setAdjQty("0");
    setAdjCost(String(row.avgCost ?? row.unitCost ?? "0.00"));
    setAdjReason("Stock adjustment");
    setAdjLocationId(locationId || String(row.locationId ?? ""));
    window.setTimeout(() => setBusyAction(null), 200);
  };

  const saveCost = async () => {
    if (!costTarget) return;
    const ref = productRefOf(costTarget);
    if (!ref) {
      addToast("Missing product reference", "error");
      return;
    }
    try {
      await setCost.mutateAsync({
        items: [{ productRef: ref, unitCost: costValue, reason: costReason }],
      });
      addToast("Cost updated", "success");
      setCostTarget(null);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const postAdjust = async () => {
    if (!adjTarget) return;
    const ref = productRefOf(adjTarget);
    const loc = adjLocationId || locationId || String(adjTarget.locationId ?? "");
    if (!ref) {
      addToast("Missing product reference", "error");
      return;
    }
    if (!loc) {
      addToast("Choose a location for the adjustment", "error");
      return;
    }
    try {
      await adjust.mutateAsync({
        locationId: loc,
        productRef: ref,
        qtyDelta: adjQty,
        unitCost: adjCost,
        reason: adjReason,
      });
      addToast("Adjustment posted", "success");
      setAdjTarget(null);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const movementsHref = "/admin/accounting/inventory/movements";
  const dateValue = asOf || todayIsoDate();

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
                  Inventory valuation
                </h1>
                <LivePulse mode={liveMode} />
                {rows.length > 0 ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {rows.length} products
                  </span>
                ) : null}
                {flaggedCount > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-amber-800 ring-1 ring-amber-200">
                    {flaggedCount} flagged
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                On-hand value by product and location — stays live as
                adjustments, cost updates, receipts, and sales land.
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
                onClick={() => go(movementsHref)}
                onMouseEnter={() => warm(movementsHref)}
                onFocus={() => warm(movementsHref)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
              >
                {busyHref === movementsHref ? (
                  <ButtonSpinner />
                ) : (
                  <History className="h-4 w-4 text-stone-500" />
                )}
                Movements
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:px-5">
          <label className="block min-w-[10rem] text-sm">
            <span className="mb-1 block font-medium text-stone-700">As of</span>
            <input
              type="date"
              value={dateValue}
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
          {filterBusy ? (
            <span className="inline-flex items-center gap-1.5 pb-2 text-xs font-medium text-stone-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
              Updating…
            </span>
          ) : null}
        </div>

        {!blocking && query.isFetched ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Stock value
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-stone-900">
                <MoneyCell
                  value={data.totalValue as string}
                  currency={currency}
                  align="left"
                />
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Ledger inventory
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-stone-900">
                <MoneyCell
                  value={data.ledgerValue as string}
                  currency={currency}
                  align="left"
                />
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Difference
              </p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${
                  Number(data.difference ?? 0) !== 0
                    ? "text-amber-800"
                    : "text-stone-900"
                }`}
              >
                <MoneyCell
                  value={data.difference as string}
                  currency={currency}
                  align="left"
                />
              </p>
            </div>
          </div>
        ) : null}

        {query.isError ? <AccountingErrorMessage error={query.error} /> : null}

        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          {blocking ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <Package className="h-9 w-9 text-stone-300" />
              <p className="mt-3 text-sm font-medium text-stone-800">
                No inventory on hand
              </p>
              <p className="mt-1 max-w-sm text-xs text-stone-500">
                Receive stock, post adjustments, or sell products to build
                valuation rows here.
              </p>
              <button
                type="button"
                disabled={busyHref === movementsHref}
                onClick={() => go(movementsHref)}
                onMouseEnter={() => warm(movementsHref)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-70"
              >
                {busyHref === movementsHref ? (
                  <ButtonSpinner />
                ) : (
                  <History className="h-4 w-4 text-stone-500" />
                )}
                View movements
              </button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-stone-100 md:hidden">
                {rows.map((r, i) => {
                  const key = rowKey(r, i);
                  const { labels, missingCost, negative, qty, avg } =
                    flagLabels(r);
                  return (
                    <div
                      key={key}
                      className={`flex flex-col gap-2 px-4 py-4 ${
                        negative
                          ? "bg-red-50/70"
                          : missingCost
                            ? "bg-amber-50/60"
                            : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-stone-900">
                            {String(r.name ?? r.productName ?? "—")}
                          </p>
                          {r.sku ? (
                            <p className="mt-0.5 truncate text-xs text-stone-500">
                              SKU {r.sku}
                            </p>
                          ) : null}
                        </div>
                        <MoneyCell value={r.value as string} currency={currency} />
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-stone-600">
                        <span>
                          Qty{" "}
                          <span className="font-semibold tabular-nums text-stone-900">
                            {String(qty)}
                          </span>
                        </span>
                        <span>
                          Avg{" "}
                          <MoneyCell value={avg as string} currency={currency} />
                        </span>
                      </div>
                      {labels.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {labels.map((label) => (
                            <span
                              key={label}
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {canWrite ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={busyAction === `cost-${key}` || setCost.isPending}
                            onClick={() => openCost(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-[#8a7318] hover:bg-stone-50 disabled:opacity-70"
                          >
                            {busyAction === `cost-${key}` ? (
                              <ButtonSpinner />
                            ) : null}
                            Set cost
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === `adj-${key}` || adjust.isPending}
                            onClick={() => openAdjust(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-[#8a7318] hover:bg-stone-50 disabled:opacity-70"
                          >
                            {busyAction === `adj-${key}` ? (
                              <ButtonSpinner />
                            ) : null}
                            Adjust
                          </button>
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
                      <th className="px-4 py-2.5 font-semibold">Product</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Avg cost
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Value
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Flags</th>
                      {canWrite ? (
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const key = rowKey(r, i);
                      const { labels, missingCost, negative, qty, avg } =
                        flagLabels(r);
                      return (
                        <tr
                          key={key}
                          className={`border-t border-stone-100 transition hover:bg-stone-50/70 ${
                            negative
                              ? "bg-red-50/70"
                              : missingCost
                                ? "bg-amber-50/50"
                                : ""
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-stone-900">
                              {String(r.name ?? r.productName ?? "—")}
                            </div>
                            {r.sku ? (
                              <div className="text-[11px] text-stone-500">
                                SKU {r.sku}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-stone-800">
                            {String(qty)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell value={avg as string} currency={currency} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MoneyCell
                              value={r.value as string}
                              currency={currency}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            {labels.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {labels.map((label) => (
                                  <span
                                    key={label}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-stone-400">—</span>
                            )}
                          </td>
                          {canWrite ? (
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    busyAction === `cost-${key}` ||
                                    setCost.isPending
                                  }
                                  onClick={() => openCost(r)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                                >
                                  {busyAction === `cost-${key}` ? (
                                    <ButtonSpinner />
                                  ) : null}
                                  Set cost
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    busyAction === `adj-${key}` ||
                                    adjust.isPending
                                  }
                                  onClick={() => openAdjust(r)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8a7318] hover:underline disabled:opacity-70"
                                >
                                  {busyAction === `adj-${key}` ? (
                                    <ButtonSpinner />
                                  ) : null}
                                  Adjust
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {costTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inv-cost-title"
        >
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-xl">
            <h2
              id="inv-cost-title"
              className="text-lg font-semibold text-stone-900"
            >
              Set cost
            </h2>
            <p className="text-sm text-stone-600">
              {String(costTarget.name ?? costTarget.productName ?? "Product")}
            </p>
            <MoneyInput
              value={costValue}
              onChange={setCostValue}
              label="Unit cost"
              currency={currency}
              disabled={setCost.isPending}
            />
            <input
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              value={costReason}
              onChange={(e) => setCostReason(e.target.value)}
              placeholder="Reason"
              disabled={setCost.isPending}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="rounded-xl px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
                disabled={setCost.isPending}
                onClick={() => setCostTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={setCost.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                onClick={() => void saveCost()}
              >
                {setCost.isPending ? <ButtonSpinner /> : null}
                {setCost.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adjTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inv-adj-title"
        >
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-xl">
            <h2
              id="inv-adj-title"
              className="text-lg font-semibold text-stone-900"
            >
              Stock adjustment
            </h2>
            <p className="text-sm text-stone-600">
              {String(adjTarget.name ?? adjTarget.productName ?? "Product")}
            </p>
            <LocationPicker
              value={adjLocationId}
              onChange={setAdjLocationId}
              allowCompanyWide={false}
              disabled={adjust.isPending}
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Qty delta (+/−)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={adjQty}
                disabled={adjust.isPending}
                onChange={(e) =>
                  setAdjQty(e.target.value.replace(/[^0-9.-]/g, ""))
                }
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
              />
            </label>
            <MoneyInput
              value={adjCost}
              onChange={setAdjCost}
              label="Unit cost (for increases)"
              currency={currency}
              disabled={adjust.isPending}
            />
            <input
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Reason"
              disabled={adjust.isPending}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="rounded-xl px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
                disabled={adjust.isPending}
                onClick={() => setAdjTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={adjust.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
                onClick={() => void postAdjust()}
              >
                {adjust.isPending ? <ButtonSpinner /> : null}
                {adjust.isPending ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
