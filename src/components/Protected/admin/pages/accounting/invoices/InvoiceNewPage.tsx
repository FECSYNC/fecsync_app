"use client";

/**
 * New manual invoice / credit note — instant open via desk prefetch
 * (settings, lookups, accounts, tax codes, customers). Live COA + tax
 * stay warm; create invalidates invoices + customer AR.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { D, mul, round2 } from "@/lib/accounting/money";
import {
  accountingKeys,
  useAccountingAccountsQuery,
  useAccountingCustomerQuery,
  useAccountingInitialized,
  useAccountingLookupsQuery,
  useAccountingTaxCodesQuery,
  useCreateInvoiceMutation,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingGate,
  LocationPicker,
  MoneyCell,
  MoneyInput,
  PartyPicker,
  TaxCodePicker,
  accountingErrorMessage,
  todayIsoDate,
} from "../shared";

type Line = {
  key: string;
  description: string;
  ledgerAccountId: string;
  qty: string;
  unitPrice: string;
  taxCodeId: string;
};

function newLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: "",
    ledgerAccountId: "",
    qty: "1",
    unitPrice: "",
    taxCodeId: "",
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

function LivePulse({ mode }: { mode: "first" | "manual" | "idle" }) {
  const active = mode !== "idle";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
          : "bg-stone-50 text-stone-500 ring-1 ring-stone-200/80"
      }`}
      title="Customers, accounts, and tax codes stay in quiet live sync"
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

const fieldClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50";

export default function InvoiceNewPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingReceivablesWrite);
  const { settings, isFetching: settingsFetching, isPending: settingsPending } =
    useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const createM = useCreateInvoiceMutation();

  const [kind, setKind] = useState<"manual" | "credit_note">("manual");
  const [partyKey, setPartyKey] = useState(sp.get("partyKey") ?? "");
  const [locationId, setLocationId] = useState("");
  const [issueDate, setIssueDate] = useState(todayIsoDate);
  const [dueAt, setDueAt] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [termsSeeded, setTermsSeeded] = useState(false);
  const [memo, setMemo] = useState("");
  const [appliesToInvoiceId, setAppliesToInvoiceId] = useState(
    sp.get("appliesToInvoiceId") ?? ""
  );
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [saveMode, setSaveMode] = useState<"draft" | null>(null);

  const lookups = useAccountingLookupsQuery(canWrite);
  const accounts = useAccountingAccountsQuery({}, canWrite);
  const taxCodes = useAccountingTaxCodesQuery({}, canWrite);
  const customerQ = useAccountingCustomerQuery(partyKey, Boolean(partyKey));

  // Keep form deps warm + live so pickers open instantly.
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
    setPaymentTermsDays(String(days));
    setTermsSeeded(true);
  }, [settings?.defaultPaymentTermsDays, termsSeeded]);

  useEffect(() => {
    if (dueTouched) return;
    const days = Number(paymentTermsDays);
    if (!issueDate || !Number.isFinite(days) || days < 0) return;
    const next = addDaysIso(issueDate, Math.trunc(days));
    if (next) setDueAt(next);
  }, [issueDate, paymentTermsDays, dueTouched]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 8_000);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!manualRefresh) return;
    if (
      !lookups.isFetching &&
      !accounts.isFetching &&
      !taxCodes.isFetching &&
      !settingsFetching
    ) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    lookups.isFetching,
    accounts.isFetching,
    taxCodes.isFetching,
    settingsFetching,
  ]);

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
      if (!line.description.trim() && !line.unitPrice && !line.ledgerAccountId) {
        continue;
      }
      try {
        const lineNet = round2(mul(line.qty || "0", line.unitPrice || "0"));
        subtotal = subtotal.add(lineNet);
        const rate = line.taxCodeId
          ? taxRateById.get(line.taxCodeId) ?? "0"
          : "0";
        tax = tax.add(round2(mul(lineNet, D(rate).div(100))));
      } catch {
        /* ignore partial input */
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
      lines.filter((l) => l.description.trim() && l.ledgerAccountId).length,
    [lines]
  );

  const customerLabel = useMemo(() => {
    const raw = customerQ.data as
      | { name?: string; customer?: { name?: string } }
      | undefined;
    return raw?.customer?.name ?? raw?.name ?? null;
  }, [customerQ.data]);

  const liveMode: "first" | "manual" | "idle" = manualRefresh
    ? "manual"
    : settingsPending && !settings
      ? "first"
      : lookups.isFetching ||
          accounts.isFetching ||
          taxCodes.isFetching ||
          settingsFetching
        ? "manual"
        : "idle";

  const saving = createM.isPending || saveMode === "draft";
  const formLocked = saving || Boolean(busyHref);

  const goBack = useCallback(() => {
    const href = "/admin/accounting/invoices";
    setBusyHref(href);
    router.push(href);
  }, [router]);

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([
      lookups.refetch(),
      accounts.refetch(),
      taxCodes.refetch(),
      qc.invalidateQueries({ queryKey: accountingKeys.settings() }),
      partyKey
        ? qc.invalidateQueries({ queryKey: accountingKeys.customer(partyKey) })
        : Promise.resolve(),
    ]);
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
  };

  const save = async () => {
    if (!canWrite) {
      addToast("Missing receivables write permission", "error");
      return;
    }
    if (!partyKey) {
      addToast("Select a customer", "error");
      return;
    }
    if (!locationId) {
      addToast("Select a location", "error");
      return;
    }
    if (!issueDate) {
      addToast("Issue date is required", "error");
      return;
    }
    if (validLineCount < 1) {
      addToast("Add at least one line with description and revenue account", "error");
      return;
    }
    if (kind === "credit_note" && !appliesToInvoiceId.trim()) {
      addToast("Credit notes need the invoice they apply to", "error");
      return;
    }

    setSaveMode("draft");
    try {
      const res = (await createM.mutateAsync({
        kind,
        partyKey,
        locationId,
        issueDate,
        dueAt: dueAt || null,
        paymentTermsDays: Number(paymentTermsDays) || undefined,
        memo: memo.trim() || null,
        appliesToInvoiceId:
          kind === "credit_note" ? appliesToInvoiceId.trim() : null,
        lines: lines
          .filter((l) => l.description.trim() && l.ledgerAccountId)
          .map((l) => ({
            description: l.description.trim(),
            ledgerAccountId: l.ledgerAccountId,
            qty: l.qty || "1",
            unitPrice: l.unitPrice || "0",
            taxCodeId: l.taxCodeId || null,
          })),
      })) as { invoice?: { id: string }; id?: string };
      const id = res.invoice?.id ?? res.id;
      addToast(
        kind === "credit_note"
          ? "Credit note draft created"
          : "Invoice draft created",
        "success"
      );
      if (id) {
        const href = `/admin/accounting/invoices/${id}`;
        setBusyHref(href);
        router.push(href);
      } else {
        goBack();
      }
    } catch (e) {
      addToast(accountingErrorMessage(e), "error");
    } finally {
      setSaveMode(null);
    }
  };

  if (!canWrite) {
    return (
      <AccountingGate>
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          You cannot create invoices.
        </p>
      </AccountingGate>
    );
  }

  const title =
    kind === "credit_note" ? "New credit note" : "New invoice";

  return (
    <AccountingGate>
      <div className="mx-auto max-w-4xl space-y-5">
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
                {busyHref === "/admin/accounting/invoices" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Invoices
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  {title}
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Draft a manual invoice or credit note in {currency}. Customers,
                revenue accounts, and tax codes stay live with the rest of AR.
              </p>
              {partyKey && customerLabel ? (
                <p className="mt-2 text-xs font-medium text-stone-500">
                  Customer · {customerLabel}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              <Link
                href="/admin/accounting/customers"
                onClick={() => setBusyHref("/admin/accounting/customers")}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50"
              >
                {busyHref === "/admin/accounting/customers" ? (
                  <ButtonSpinner />
                ) : null}
                Customers
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <FilePlus2 className="h-4 w-4 text-[#D4AF37]" />
            <h2 className="text-sm font-semibold text-stone-900">Details</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-stone-700">Kind</span>
              <select
                value={kind}
                disabled={formLocked}
                onChange={(e) =>
                  setKind(e.target.value as "manual" | "credit_note")
                }
                className={fieldClass}
              >
                <option value="manual">Manual invoice</option>
                <option value="credit_note">Credit note</option>
              </select>
            </label>
            <LocationPicker
              value={locationId}
              onChange={setLocationId}
              allowCompanyWide={false}
              disabled={formLocked}
              syncHqPreference
            />
            <div className="sm:col-span-2">
              <PartyPicker
                value={partyKey}
                onChange={(k) => setPartyKey(k)}
                kinds={["customer"]}
                label="Customer"
                disabled={formLocked}
              />
            </div>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Issue date
              </span>
              <input
                type="date"
                value={issueDate}
                disabled={formLocked}
                onChange={(e) => setIssueDate(e.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Due date
              </span>
              <input
                type="date"
                value={dueAt}
                disabled={formLocked}
                onChange={(e) => {
                  setDueTouched(true);
                  setDueAt(e.target.value);
                }}
                className={fieldClass}
              />
              {!dueTouched ? (
                <p className="mt-1 text-[11px] text-stone-500">
                  Auto-filled from payment terms — edit anytime.
                </p>
              ) : null}
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-stone-700">
                Payment terms (days)
              </span>
              <input
                type="number"
                min={0}
                value={paymentTermsDays}
                disabled={formLocked}
                onChange={(e) => {
                  setDueTouched(false);
                  setPaymentTermsDays(e.target.value);
                }}
                className={fieldClass}
              />
            </label>
            {kind === "credit_note" ? (
              <label className="text-sm">
                <span className="mb-1 block font-medium text-stone-700">
                  Applies to invoice id
                </span>
                <input
                  value={appliesToInvoiceId}
                  disabled={formLocked}
                  onChange={(e) => setAppliesToInvoiceId(e.target.value)}
                  placeholder="Invoice id"
                  className={fieldClass}
                />
              </label>
            ) : null}
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-700">Memo</span>
              <input
                value={memo}
                disabled={formLocked}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Optional note on the invoice"
                className={fieldClass}
              />
            </label>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-stone-900">Line items</h2>
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
              <input
                value={line.description}
                disabled={formLocked}
                onChange={(e) =>
                  updateLine(line.key, { description: e.target.value })
                }
                placeholder="Description"
                className={fieldClass}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <AccountPicker
                  value={line.ledgerAccountId}
                  types={["revenue"]}
                  onChange={(id) =>
                    updateLine(line.key, { ledgerAccountId: id })
                  }
                  label="Revenue account"
                  disabled={formLocked}
                  locationId={locationId || undefined}
                />
                <TaxCodePicker
                  value={line.taxCodeId}
                  onChange={(id) => updateLine(line.key, { taxCodeId: id })}
                  label="Tax code"
                  disabled={formLocked}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-stone-700">
                    Qty
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.qty}
                    disabled={formLocked}
                    onChange={(e) =>
                      updateLine(line.key, {
                        qty: e.target.value.replace(/[^0-9.]/g, ""),
                      })
                    }
                    className={fieldClass}
                  />
                </label>
                <MoneyInput
                  label="Unit price"
                  value={line.unitPrice}
                  currency={currency}
                  disabled={formLocked}
                  onChange={(unitPrice) =>
                    updateLine(line.key, { unitPrice })
                  }
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            disabled={formLocked}
            onClick={() => setLines((rows) => [...rows, newLine()])}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
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

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-stone-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <button
            type="button"
            disabled={formLocked}
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
          >
            {busyHref === "/admin/accounting/invoices" ? (
              <ButtonSpinner />
            ) : null}
            Cancel
          </button>
          <button
            type="button"
            disabled={formLocked || validLineCount < 1 || !partyKey || !locationId}
            onClick={() => void save()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60"
          >
            {saving ? <ButtonSpinner /> : <FilePlus2 className="h-4 w-4" />}
            {saving ? "Saving draft…" : "Save draft"}
          </button>
        </div>
      </div>
    </AccountingGate>
  );
}
