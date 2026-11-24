"use client";

/**
 * New bill — full route or embedded overlay (instant from Bills list).
 * Suppliers / locations / tax stay warm + live; create invalidates AP lists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  FileText,
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
  useAccountingBillsQuery,
  useAccountingInitialized,
  useAccountingLookupsQuery,
  useAccountingSuppliersQuery,
  useAccountingTaxCodesQuery,
  useCreateBillMutation,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingGate,
  AttachmentUploader,
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
  ledgerAccountId: string;
};

function newLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: "",
    qty: "1",
    unitCost: "",
    taxCodeId: "",
    ledgerAccountId: "",
  };
}

function addDaysIso(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

export default function BillNewPage({
  embedded = false,
  active = true,
  onClose,
  onCreated,
}: {
  embedded?: boolean;
  active?: boolean;
  onClose?: () => void;
  onCreated?: (billId: string) => void;
} = {}) {
  const router = useRouter();
  const sp = useSearchParams();
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
  const createMutation = useCreateBillMutation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const isLive = !embedded || active;

  const [supplierId, setSupplierId] = useState(sp.get("supplierId") ?? "");
  const [locationId, setLocationId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [billDate, setBillDate] = useState(todayIsoDate);
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState(
    sp.get("purchaseOrderId") ?? ""
  );
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
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
  const suppliers = asItems(suppliersQuery.data, ["suppliers", "items"]);

  const dupCheck = useAccountingBillsQuery(
    {
      supplierId: supplierId || undefined,
      q: supplierInvoiceNumber.trim() || undefined,
    },
    Boolean(supplierId && supplierInvoiceNumber.trim())
  );
  const dupWarning = useMemo(() => {
    const rows = asItems(dupCheck.data);
    return rows.some(
      (b) =>
        String(b.supplierId) === supplierId &&
        String(b.supplierInvoiceNumber ?? "").toLowerCase() ===
          supplierInvoiceNumber.trim().toLowerCase()
    );
  }, [dupCheck.data, supplierId, supplierInvoiceNumber]);

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
    () => lines.filter((l) => l.description.trim()).length,
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
    void qc.prefetchQuery({
      queryKey: accountingKeys.accounts(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.listAccountingAccounts()),
    });
  }, [canWrite, qc]);

  useEffect(() => {
    if (dueTouched) return;
    const days = settings?.defaultPaymentTermsDays;
    if (days == null || !billDate) return;
    const next = addDaysIso(billDate, Math.trunc(Number(days)));
    if (next) setDueDate(next);
  }, [billDate, settings?.defaultPaymentTermsDays, dueTouched]);

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
      !settingsFetching
    ) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    suppliersQuery.isFetching,
    lookups.isFetching,
    taxCodes.isFetching,
    settingsFetching,
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
    const href = "/admin/accounting/bills";
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
      qc.invalidateQueries({ queryKey: accountingKeys.accounts() }),
    ]);
  };

  const finish = (billId: string) => {
    if (onCreated) {
      onCreated(billId);
      return;
    }
    const href = `/admin/accounting/bills/${billId}`;
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
    if (validLineCount < 1) {
      addToast("Add at least one line with a description", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createMutation.mutateAsync({
        supplierId,
        locationId: locationId || null,
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || null,
        billDate,
        dueDate: dueDate || null,
        purchaseOrderId: purchaseOrderId || null,
        notes: notes.trim() || null,
        attachments: attachments.map((url) => ({ url })),
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description.trim(),
            qty: l.qty || "1",
            unitCost: l.unitCost || "0",
            taxCodeId: l.taxCodeId || null,
            ledgerAccountId: l.ledgerAccountId || null,
          })),
      });
      const bill = asRecord(asRecord(res).bill ?? res);
      addToast("Bill created", "success");
      finish(String(bill.id));
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const formBody = !canWrite ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      You need payables write permission to create bills.
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
                {busyHref === "/admin/accounting/bills" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Bills
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  New bill
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Record a supplier invoice in {currency} for AP posting and
                payment. Suppliers and tax stay live with the desk.
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
              Record a supplier invoice for AP posting and payment.
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
          <FileText className="h-4 w-4 text-[#D4AF37]" />
          <h2 className="text-sm font-semibold text-stone-900">Bill details</h2>
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
              allowCompanyWide
              disabled={formLocked}
              syncHqPreference
            />
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Supplier invoice #
            </span>
            <input
              className={fieldClass}
              disabled={formLocked}
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Purchase order ID
            </span>
            <input
              className={fieldClass}
              disabled={formLocked}
              placeholder="Optional link to a PO"
              value={purchaseOrderId}
              onChange={(e) => setPurchaseOrderId(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Bill date
            </span>
            <input
              type="date"
              className={fieldClass}
              disabled={formLocked}
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Due date
            </span>
            <input
              type="date"
              className={fieldClass}
              disabled={formLocked}
              value={dueDate}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
            />
            {!dueTouched && settings?.defaultPaymentTermsDays != null ? (
              <span className="mt-1 block text-[11px] text-stone-500">
                Auto-filled from {settings.defaultPaymentTermsDays}-day payment
                terms — edit anytime.
              </span>
            ) : null}
          </label>
        </div>

        {dupWarning ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A bill with this supplier invoice number already exists.
          </p>
        ) : null}
        {dupCheck.isFetching && supplierInvoiceNumber.trim() ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-stone-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
            Checking for duplicates…
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">Line items</h2>
            <p className="text-xs text-stone-500">
              Expense or asset account per line
            </p>
          </div>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
            {validLineCount} ready
          </span>
        </div>

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
                placeholder="What was purchased?"
              />
            </label>
            <AccountPicker
              value={line.ledgerAccountId}
              onChange={(ledgerAccountId) =>
                updateLine(line.key, { ledgerAccountId })
              }
              label="Account"
              disabled={formLocked}
              lazy
            />
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

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-semibold text-stone-900">
          Attachments & notes
        </h2>
        <AttachmentUploader
          urls={attachments}
          onChange={setAttachments}
          disabled={formLocked}
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">Notes</span>
          <textarea
            className={fieldClass}
            rows={2}
            disabled={formLocked}
            placeholder="Optional notes for AP"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-stone-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <button
          type="button"
          disabled={formLocked}
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
        >
          {busyHref === "/admin/accounting/bills" ? <ButtonSpinner /> : null}
          Cancel
        </button>
        <button
          type="button"
          disabled={
            !canWrite || !supplierId || validLineCount < 1 || formLocked
          }
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
        >
          {formLocked ? <ButtonSpinner /> : <FileText className="h-4 w-4" />}
          {formLocked ? "Creating…" : "Create bill"}
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
        aria-label="New bill"
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
                  New bill
                </h2>
                <LivePulse mode={liveMode} />
              </div>
              <p className="text-xs text-stone-500">
                Creates a supplier invoice for AP
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
