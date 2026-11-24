"use client";

/**
 * New supplier — full route or embedded overlay (instant from Suppliers).
 * Lookups / tax / accounts stay warm + live; create invalidates AP lists.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  accountingKeys,
  useAccountingInitialized,
  useAccountingLookupsQuery,
  useAccountingTaxCodesQuery,
  useCreateSupplierMutation,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  LocationPicker,
  TaxCodePicker,
  accountingErrorMessage,
  asRecord,
} from "../shared";

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
      title="Locations, tax codes, and accounts stay in quiet live sync"
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

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>
      ) : null}
    </label>
  );
}

export default function SupplierNewPage({
  embedded = false,
  /** When pre-mounted for instant open, false keeps the overlay dormant. */
  active = true,
  onClose,
  onCreated,
}: {
  embedded?: boolean;
  active?: boolean;
  onClose?: () => void;
  onCreated?: (supplierId: string) => void;
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
  const createMutation = useCreateSupplierMutation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [termsSeeded, setTermsSeeded] = useState(false);
  const isLive = !embedded || active;

  const lookups = useAccountingLookupsQuery(canWrite && (isLive || embedded));
  const taxCodes = useAccountingTaxCodesQuery(
    {},
    canWrite && (isLive || embedded)
  );

  const [form, setForm] = useState({
    name: "",
    legalName: "",
    email: "",
    phone: "",
    addressLine1: "",
    city: "",
    country: "",
    postalCode: "",
    taxId: "",
    paymentTermsDays: "",
    currency: "",
    defaultExpenseAccountId: "",
    defaultTaxCodeId: "",
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    notes: "",
    locationId: "",
  });

  // Keep form deps warm so pickers paint from cache.
  useEffect(() => {
    if (!canWrite) return;
    void qc.prefetchQuery({
      queryKey: accountingKeys.settings(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.getAccountingSettings()),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.lookups(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.getAccountingLookups()),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.accounts(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.listAccountingAccounts()),
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
    if (termsSeeded) return;
    const days = settings?.defaultPaymentTermsDays;
    if (days == null) return;
    setForm((prev) =>
      prev.paymentTermsDays
        ? prev
        : { ...prev, paymentTermsDays: String(days) }
    );
    setTermsSeeded(true);
  }, [settings?.defaultPaymentTermsDays, termsSeeded]);

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
    if (!lookups.isFetching && !taxCodes.isFetching && !settingsFetching) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    lookups.isFetching,
    taxCodes.isFetching,
    settingsFetching,
  ]);

  const liveMode: "first" | "manual" | "idle" = manualRefresh
    ? "manual"
    : settingsPending && !settings
      ? "first"
      : lookups.isFetching || taxCodes.isFetching || settingsFetching
        ? "manual"
        : "idle";

  const formLocked = busy || createMutation.isPending || Boolean(busyHref);

  const patch = (partial: Partial<typeof form>) =>
    setForm((prev) => ({ ...prev, ...partial }));

  const goBack = useCallback(() => {
    if (embedded) {
      onClose?.();
      return;
    }
    const href = "/admin/accounting/suppliers";
    setBusyHref(href);
    router.push(href);
  }, [embedded, onClose, router]);

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([
      lookups.refetch(),
      taxCodes.refetch(),
      qc.invalidateQueries({ queryKey: accountingKeys.settings() }),
      qc.invalidateQueries({ queryKey: accountingKeys.accounts() }),
    ]);
  };

  const finish = (supplierId: string) => {
    if (onCreated) {
      onCreated(supplierId);
      return;
    }
    const href = `/admin/accounting/suppliers/${supplierId}`;
    setBusyHref(href);
    router.push(href);
  };

  const save = async () => {
    if (!canWrite) return;
    if (!form.name.trim()) {
      addToast("Supplier name is required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createMutation.mutateAsync({
        name: form.name.trim(),
        legalName: form.legalName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        postalCode: form.postalCode.trim() || null,
        taxId: form.taxId.trim() || null,
        paymentTermsDays: form.paymentTermsDays
          ? Number(form.paymentTermsDays)
          : null,
        currency: form.currency.trim() || null,
        defaultExpenseAccountId: form.defaultExpenseAccountId || null,
        defaultTaxCodeId: form.defaultTaxCodeId || null,
        bankName: form.bankName.trim() || null,
        bankAccountName: form.bankAccountName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
        notes: form.notes.trim() || null,
        locationId: form.locationId || null,
      });
      const supplier = asRecord(asRecord(res).supplier ?? res);
      addToast("Supplier created", "success");
      finish(String(supplier.id));
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const baseCurrency = settings?.baseCurrency ?? "USD";

  const formBody = !canWrite ? (
    <AccountingErrorMessage
      error={new Error("You need payables write permission")}
    />
  ) : (
    <div className="mx-auto max-w-3xl space-y-5">
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
                {busyHref === "/admin/accounting/suppliers" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Suppliers
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  New supplier
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Add a payables vendor for bills, POs, and payments. Locations
                and defaults stay live with the rest of AP.
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
              Add a payables vendor for bills, POs, and payments.
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
          <Building2 className="h-4 w-4 text-[#D4AF37]" />
          <h2 className="text-sm font-semibold text-stone-900">Identity</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Display name"
              autoFocus={isLive}
            />
          </Field>
          <Field label="Legal name">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.legalName}
              onChange={(e) => patch({ legalName: e.target.value })}
              placeholder="Registered legal name"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={fieldClass}
              disabled={formLocked}
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
              placeholder="ap@vendor.com"
            />
          </Field>
          <Field label="Phone">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              placeholder="+1…"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-semibold text-stone-900">Address</h2>
        <Field label="Street address">
          <input
            className={fieldClass}
            disabled={formLocked}
            value={form.addressLine1}
            onChange={(e) => patch({ addressLine1: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.city}
              onChange={(e) => patch({ city: e.target.value })}
            />
          </Field>
          <Field label="Country">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.country}
              onChange={(e) => patch({ country: e.target.value })}
            />
          </Field>
          <Field label="Postal code">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.postalCode}
              onChange={(e) => patch({ postalCode: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-semibold text-stone-900">
          Terms & defaults
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tax ID">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.taxId}
              onChange={(e) => patch({ taxId: e.target.value })}
            />
          </Field>
          <Field
            label="Payment terms (days)"
            hint="Seeded from company defaults when available"
          >
            <input
              type="number"
              min={0}
              className={fieldClass}
              disabled={formLocked}
              value={form.paymentTermsDays}
              onChange={(e) => patch({ paymentTermsDays: e.target.value })}
            />
          </Field>
          <Field label="Currency" hint={`Blank uses ${baseCurrency}`}>
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.currency}
              onChange={(e) =>
                patch({ currency: e.target.value.toUpperCase() })
              }
              maxLength={3}
              placeholder={baseCurrency}
            />
          </Field>
        </div>
        <LocationPicker
          value={form.locationId}
          onChange={(locationId) => patch({ locationId })}
          allowCompanyWide
          disabled={formLocked}
          syncHqPreference
        />
        <AccountPicker
          value={form.defaultExpenseAccountId}
          onChange={(defaultExpenseAccountId) =>
            patch({ defaultExpenseAccountId })
          }
          label="Default expense / asset account"
          disabled={formLocked}
          lazy
        />
        <TaxCodePicker
          value={form.defaultTaxCodeId}
          onChange={(defaultTaxCodeId) => patch({ defaultTaxCodeId })}
          disabled={formLocked}
        />
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-semibold text-stone-900">Bank details</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Bank name">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.bankName}
              onChange={(e) => patch({ bankName: e.target.value })}
            />
          </Field>
          <Field label="Account name">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.bankAccountName}
              onChange={(e) => patch({ bankAccountName: e.target.value })}
            />
          </Field>
          <Field label="Account number">
            <input
              className={fieldClass}
              disabled={formLocked}
              value={form.bankAccountNumber}
              onChange={(e) => patch({ bankAccountNumber: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            className={fieldClass}
            rows={3}
            disabled={formLocked}
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Internal notes for AP"
          />
        </Field>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-stone-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <button
          type="button"
          disabled={formLocked}
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
        >
          {busyHref === "/admin/accounting/suppliers" ? (
            <ButtonSpinner />
          ) : null}
          Cancel
        </button>
        <button
          type="button"
          disabled={!canWrite || !form.name.trim() || formLocked}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
        >
          {formLocked ? <ButtonSpinner /> : <Building2 className="h-4 w-4" />}
          {formLocked ? "Creating…" : "Create supplier"}
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
        aria-label="New supplier"
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
                  New supplier
                </h2>
                <LivePulse mode={liveMode} />
              </div>
              <p className="text-xs text-stone-500">
                Creates a payables vendor record
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
