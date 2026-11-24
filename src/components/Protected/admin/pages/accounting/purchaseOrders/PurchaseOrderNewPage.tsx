"use client";

/**
 * New purchase order — full route or embedded overlay (instant from list).
 * Suppliers / locations / tax stay warm + live; create invalidates AP lists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { D, mul, round2 } from "@/lib/accounting/money";
import {
  accountingKeys,
  useAccountingInitialized,
  useAccountingLookupsQuery,
  useAccountingProductsQuery,
  useAccountingSuppliersQuery,
  useAccountingTaxCodesQuery,
  useCreatePurchaseOrderMutation,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingGate,
  LocationPicker,
  MoneyCell,
  MoneyInput,
  TaxCodePicker,
  accountingErrorMessage,
  asItems,
  asRecord,
  todayIsoDate,
} from "../shared";

type Line = {
  key: string;
  description: string;
  qty: string;
  unitCost: string;
  taxCodeId: string;
  posProductId: string;
  shopProductId: string;
  ledgerAccountId: string;
};

function newLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: "",
    qty: "1",
    unitCost: "",
    taxCodeId: "",
    posProductId: "",
    shopProductId: "",
    ledgerAccountId: "",
  };
}

const fieldClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50";

function LivePulse({ mode }: { mode: "first" | "manual" | "idle" }) {
  const active = mode !== "idle";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
          : "bg-stone-50 text-stone-500 ring-1 ring-stone-200/80"
      }`}
      title="Suppliers, locations, and tax codes stay in quiet live sync"
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

function safeMoney(raw: string) {
  try {
    return D(raw || "0");
  } catch {
    return D(0);
  }
}

export default function PurchaseOrderNewPage({
  embedded = false,
  active = true,
  onClose,
  onCreated,
}: {
  embedded?: boolean;
  active?: boolean;
  onClose?: () => void;
  onCreated?: (poId: string) => void;
} = {}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingPayablesWrite);
  const {
    settings,
    isFetching: settingsFetching,
    isPending: settingsPending,
  } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const createMutation = useCreatePurchaseOrderMutation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const isLive = !embedded || active;

  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(todayIsoDate);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(false);

  const enabled = canWrite && (isLive || embedded);
  const suppliersQuery = useAccountingSuppliersQuery(
    { active: "true" },
    enabled
  );
  const lookups = useAccountingLookupsQuery(enabled);
  const taxCodes = useAccountingTaxCodesQuery({}, enabled);
  const productsQuery = useAccountingProductsQuery(
    { locationId: locationId || undefined },
    Boolean(locationId) && canWrite
  );

  const suppliers = asItems(suppliersQuery.data, ["suppliers", "items"]);
  const products = useMemo(
    () => asItems(productsQuery.data, ["products", "items"]),
    [productsQuery.data]
  );

  const taxRateById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of taxCodes.data ?? []) {
      map.set(t.id, String(t.rate ?? "0"));
    }
    return map;
  }, [taxCodes.data]);

  const totals = useMemo(() => {
    let subtotal = D(0);
    let tax = D(0);
    for (const line of lines) {
      if (!line.description.trim() && !line.unitCost) continue;
      try {
        const net = round2(mul(line.qty || "0", line.unitCost || "0"));
        subtotal = subtotal.add(net);
        const rate = line.taxCodeId
          ? taxRateById.get(line.taxCodeId) ?? "0"
          : "0";
        tax = tax.add(round2(mul(net, D(rate).div(100))));
      } catch {
        /* ignore partial */
      }
    }
    return {
      subtotal: round2(subtotal).toFixed(2),
      tax: round2(tax).toFixed(2),
      total: round2(subtotal.add(tax)).toFixed(2),
    };
  }, [lines, taxRateById]);

  const validLineCount = useMemo(
    () =>
      lines.filter(
        (l) =>
          l.description.trim() &&
          (l.posProductId ||
            l.shopProductId ||
            l.ledgerAccountId ||
            safeMoney(l.unitCost).greaterThan(0))
      ).length,
    [lines]
  );

  useEffect(() => {
    if (!canWrite) return;
    void qc.prefetchQuery({
      queryKey: accountingKeys.suppliers({ active: "true" }),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listAccountingSuppliers({ active: "true" })
        ),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.lookups(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.getAccountingLookups()),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.taxCodes({}),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listAccountingTaxCodes({})
        ),
    });
  }, [canWrite, qc]);

  useEffect(() => {
    if (!embedded || !active) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embedded, active, busy, onClose]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 8_000);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!manualRefresh) return;
    if (
      !suppliersQuery.isFetching &&
      !lookups.isFetching &&
      !taxCodes.isFetching &&
      !settingsFetching &&
      !productsQuery.isFetching
    ) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    suppliersQuery.isFetching,
    lookups.isFetching,
    taxCodes.isFetching,
    settingsFetching,
    productsQuery.isFetching,
  ]);

  const liveMode: "first" | "manual" | "idle" = manualRefresh
    ? "manual"
    : settingsPending && !settings
      ? "first"
      : suppliersQuery.isFetching ||
          lookups.isFetching ||
          taxCodes.isFetching ||
          settingsFetching
        ? "manual"
        : "idle";

  const formLocked = busy || createMutation.isPending || Boolean(busyHref);

  const goBack = useCallback(() => {
    if (embedded) {
      onClose?.();
      return;
    }
    const href = "/admin/accounting/purchase-orders";
    setBusyHref(href);
    router.push(href);
  }, [embedded, onClose, router]);

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([
      suppliersQuery.refetch(),
      lookups.refetch(),
      taxCodes.refetch(),
      qc.invalidateQueries({ queryKey: accountingKeys.settings() }),
      locationId ? productsQuery.refetch() : Promise.resolve(),
    ]);
  };

  const finish = (poId: string) => {
    if (onCreated) {
      onCreated(poId);
      return;
    }
    const href = `/admin/accounting/purchase-orders/${poId}`;
    setBusyHref(href);
    router.push(href);
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
  };

  const save = async () => {
    if (!canWrite) return;
    if (!supplierId) {
      addToast("Select a supplier", "error");
      return;
    }
    if (!locationId) {
      addToast("Select a location", "error");
      return;
    }
    if (validLineCount < 1) {
      addToast("Add at least one line with a description", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createMutation.mutateAsync({
        supplierId,
        locationId,
        orderDate,
        expectedDate: expectedDate || null,
        notes: notes.trim() || null,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description.trim(),
            qty: l.qty || "1",
            unitCost: l.unitCost || "0",
            taxCodeId: l.taxCodeId || null,
            posProductId: l.posProductId || null,
            shopProductId: l.shopProductId || null,
            ledgerAccountId: l.ledgerAccountId || null,
          })),
      });
      const po = asRecord(asRecord(res).purchaseOrder ?? res);
      addToast("Purchase order created", "success");
      finish(String(po.id));
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const formBody = !canWrite ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      You need payables write permission to create purchase orders.
    </p>
  ) : (
    <div className="mx-auto max-w-4xl space-y-5">
      {!embedded ? (
        <header className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.16),_transparent_55%),linear-gradient(180deg,#fff_0%,#fafaf9_100%)]"
          />
          <div className="relative flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0">
              <button
                type="button"
                disabled={formLocked}
                onClick={goBack}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#D4AF37] transition hover:text-[#b8922e] disabled:opacity-60"
              >
                {busyHref === "/admin/accounting/purchase-orders" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Purchase orders
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  New purchase order
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Order from a supplier in {currency}, then receive and convert to
                a bill. Suppliers and defaults stay live with AP.
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={manualRefresh || formLocked}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
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
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-stone-600">
              Order from a supplier, then receive and convert to a bill.
            </p>
            <LivePulse mode={liveMode} />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={manualRefresh || formLocked}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
          >
            {manualRefresh ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-stone-500" />
            )}
            {manualRefresh ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[#D4AF37]" />
          <h2 className="text-sm font-semibold text-stone-900">Order details</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-stone-700">
              Supplier <span className="text-red-600">*</span>
            </span>
            <select
              className={fieldClass}
              value={supplierId}
              disabled={
                formLocked ||
                (suppliersQuery.isLoading && !suppliers.length)
              }
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">
                {suppliersQuery.isLoading && !suppliers.length
                  ? "Loading suppliers…"
                  : "Select…"}
              </option>
              {suppliers.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {String(s.code ? `${s.code} — ${s.name}` : s.name)}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <LocationPicker
              value={locationId}
              onChange={setLocationId}
              allowCompanyWide={false}
              disabled={formLocked}
              syncHqPreference
            />
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Order date
            </span>
            <input
              type="date"
              className={fieldClass}
              disabled={formLocked}
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Expected date
            </span>
            <input
              type="date"
              className={fieldClass}
              disabled={formLocked}
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">Line items</h2>
            <p className="text-xs text-stone-500">
              Pick a product for the location, or a ledger account
            </p>
          </div>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
            {validLineCount} ready
          </span>
        </div>

        {!locationId ? (
          <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/60 px-4 py-6 text-center text-sm text-stone-500">
            Select a location to load products for line items.
          </p>
        ) : productsQuery.isFetching && products.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-stone-500">
            <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
            Loading products…
          </div>
        ) : null}

        {lines.map((line, idx) => (
          <div
            key={line.key}
            className="space-y-3 rounded-xl border border-stone-100 bg-stone-50/60 p-3 sm:p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Line {idx + 1}
              </p>
              <button
                type="button"
                disabled={formLocked || lines.length <= 1}
                onClick={() =>
                  setLines((rows) => rows.filter((r) => r.key !== line.key))
                }
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Description <span className="text-red-600">*</span>
              </span>
              <input
                className={fieldClass}
                disabled={formLocked}
                value={line.description}
                onChange={(e) =>
                  updateLine(line.key, { description: e.target.value })
                }
                placeholder="What are you ordering?"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Product or account
              </span>
              <select
                className={fieldClass}
                disabled={formLocked}
                value={
                  line.posProductId
                    ? `pos:${line.posProductId}`
                    : line.shopProductId
                      ? `shop:${line.shopProductId}`
                      : line.ledgerAccountId
                        ? `acct:${line.ledgerAccountId}`
                        : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  const base = {
                    posProductId: "",
                    shopProductId: "",
                    ledgerAccountId: "",
                  };
                  if (v.startsWith("pos:")) {
                    const id = v.slice(4);
                    const p = products.find(
                      (x) => String(x.id) === id && x.kind !== "shop"
                    );
                    updateLine(line.key, {
                      ...base,
                      posProductId: id,
                      description:
                        line.description || String(p?.name ?? ""),
                    });
                  } else if (v.startsWith("shop:")) {
                    const id = v.slice(5);
                    const p = products.find((x) => String(x.id) === id);
                    updateLine(line.key, {
                      ...base,
                      shopProductId: id,
                      description:
                        line.description || String(p?.name ?? ""),
                    });
                  } else if (v.startsWith("acct:")) {
                    updateLine(line.key, {
                      ...base,
                      ledgerAccountId: v.slice(5),
                    });
                  } else {
                    updateLine(line.key, base);
                  }
                }}
              >
                <option value="">Select…</option>
                {products.map((p) => {
                  const ref = p.posProductId || p.id;
                  const prefix =
                    p.source === "shop" || p.shopProductId ? "shop" : "pos";
                  const id = String(
                    p.posProductId || p.shopProductId || p.id
                  );
                  return (
                    <option key={`${prefix}:${id}`} value={`${prefix}:${id}`}>
                      {String(p.name ?? ref)}
                    </option>
                  );
                })}
                <option
                  value={
                    line.ledgerAccountId
                      ? `acct:${line.ledgerAccountId}`
                      : "acct:__pick"
                  }
                >
                  Use ledger account below…
                </option>
              </select>
            </label>
            {(line.ledgerAccountId ||
              (!line.posProductId && !line.shopProductId)) && (
              <AccountPicker
                value={line.ledgerAccountId}
                onChange={(ledgerAccountId) =>
                  updateLine(line.key, {
                    ledgerAccountId,
                    posProductId: "",
                    shopProductId: "",
                  })
                }
                label="Expense / asset account"
                disabled={formLocked}
                lazy
              />
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <MoneyInput
                value={line.qty}
                onChange={(qty) => updateLine(line.key, { qty })}
                label="Qty"
                disabled={formLocked}
              />
              <MoneyInput
                value={line.unitCost}
                currency={currency}
                onChange={(unitCost) => updateLine(line.key, { unitCost })}
                label="Unit cost"
                disabled={formLocked}
              />
              <TaxCodePicker
                value={line.taxCodeId}
                onChange={(taxCodeId) => updateLine(line.key, { taxCodeId })}
                disabled={formLocked}
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          disabled={formLocked}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-60"
          onClick={() => setLines((rows) => [...rows, newLine()])}
        >
          <Plus className="h-4 w-4 text-stone-500" />
          Add line
        </button>

        <div className="grid gap-2 rounded-xl border border-stone-100 bg-white px-4 py-3 text-sm sm:ml-auto sm:max-w-xs">
          <div className="flex justify-between text-stone-600">
            <span>Subtotal</span>
            <MoneyCell value={totals.subtotal} currency={currency} />
          </div>
          <div className="flex justify-between text-stone-600">
            <span>Tax</span>
            <MoneyCell value={totals.tax} currency={currency} />
          </div>
          <div className="flex justify-between border-t border-stone-100 pt-2 font-semibold text-stone-900">
            <span>Total</span>
            <MoneyCell value={totals.total} currency={currency} />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-semibold text-stone-900">Notes</h2>
        <textarea
          className={fieldClass}
          rows={2}
          disabled={formLocked}
          placeholder="Optional notes for receiving / AP"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-stone-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <button
          type="button"
          disabled={formLocked}
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
        >
          {busyHref === "/admin/accounting/purchase-orders" ? (
            <ButtonSpinner />
          ) : null}
          Cancel
        </button>
        <button
          type="button"
          disabled={
            !canWrite ||
            !supplierId ||
            !locationId ||
            validLineCount < 1 ||
            formLocked
          }
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
        >
          {formLocked ? (
            <ButtonSpinner />
          ) : (
            <ClipboardList className="h-4 w-4" />
          )}
          {formLocked ? "Creating…" : "Create PO"}
        </button>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div
        role="dialog"
        aria-modal={isLive}
        aria-hidden={!isLive}
        aria-label="New purchase order"
        className={
          isLive
            ? "fixed inset-y-0 left-0 right-0 z-[70] flex lg:left-64"
            : "hidden"
        }
      >
        {isLive ? (
          <button
            type="button"
            aria-label="Close overlay"
            tabIndex={-1}
            className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
            onClick={() => {
              if (!busy) onClose?.();
            }}
          />
        ) : null}
        <div className="relative m-0 flex w-full flex-col overflow-hidden bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-3 sm:rounded-2xl sm:border sm:border-stone-200">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-stone-900">
                  New purchase order
                </h2>
                <LivePulse mode={liveMode} />
              </div>
              <p className="text-xs text-stone-500">
                Creates a draft PO for a supplier
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              disabled={busy}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-60"
            >
              {busy ? <ButtonSpinner /> : <X className="h-4 w-4" />}
              Close
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <AccountingGate requireInitialized={false}>{formBody}</AccountingGate>
          </div>
        </div>
      </div>
    );
  }

  return <AccountingGate>{formBody}</AccountingGate>;
}
