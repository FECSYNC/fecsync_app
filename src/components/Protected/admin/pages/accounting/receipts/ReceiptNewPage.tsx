"use client";

/**
 * Record receipt — full route or embedded overlay (instant from Receipts).
 * Banks / locations / open invoices stay warm + live; post invalidates
 * receipts, invoices, customer AR, and money surfaces.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  D,
  fromMinor,
  parseMoneyInput,
  round2,
  toMinor,
} from "@/lib/accounting/money";
import {
  accountingKeys,
  useAccountingCustomerQuery,
  useAccountingInitialized,
  useAccountingInvoicesQuery,
  useAccountingLookupsQuery,
  useBankAccountsQuery,
  useCreateReceiptMutation,
} from "@/hooks/useAccounting";
import {
  AccountingGate,
  LocationPicker,
  MoneyCell,
  MoneyInput,
  PartyPicker,
  accountingErrorMessage,
  todayIsoDate,
} from "../shared";

const METHODS = [
  "bank_transfer",
  "cash",
  "card",
  "cheque",
  "mobile_money",
  "other",
] as const;

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
      title="Banks, locations, and open invoices stay in quiet live sync"
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

function safeMoney(raw: string): ReturnType<typeof D> {
  try {
    return parseMoneyInput(raw || "0", "amount");
  } catch {
    return D(0);
  }
}

export default function ReceiptNewPage({
  embedded = false,
  onClose,
  onCreated,
  initialPartyKey,
}: {
  /** Rendered as an overlay over the receipts list (no route change). */
  embedded?: boolean;
  onClose?: () => void;
  onCreated?: (receiptId: string) => void;
  initialPartyKey?: string;
} = {}) {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingReceivablesWrite);
  const {
    settings,
    isFetching: settingsFetching,
    isPending: settingsPending,
  } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const createM = useCreateReceiptMutation();
  const closeRef = useRef<HTMLButtonElement>(null);

  const seededParty = initialPartyKey || sp.get("partyKey") || "";

  const [partyKey, setPartyKey] = useState(seededParty);
  const [method, setMethod] =
    useState<(typeof METHODS)[number]>("bank_transfer");
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayIsoDate);
  const [reference, setReference] = useState("");
  const [locationId, setLocationId] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [allocBusy, setAllocBusy] = useState(false);

  const lookups = useAccountingLookupsQuery(canWrite);
  const banks = useBankAccountsQuery({}, canWrite);
  const customerQ = useAccountingCustomerQuery(partyKey, Boolean(partyKey));
  const openInvoices = useAccountingInvoicesQuery(
    {
      partyKey: partyKey || undefined,
      kind: "manual",
      status: "sent",
    },
    Boolean(partyKey) && canWrite
  );
  const overdueInvoices = useAccountingInvoicesQuery(
    {
      partyKey: partyKey || undefined,
      kind: "manual",
      status: "overdue",
    },
    Boolean(partyKey) && canWrite
  );

  const openRows = useMemo(() => {
    const a =
      ((openInvoices.data as { items?: Array<Record<string, unknown>> })
        ?.items ?? []) as Array<{
        id: string;
        number: string;
        amountDue: string;
        dueAt?: string | null;
        issueDate?: string | null;
      }>;
    const b =
      ((overdueInvoices.data as { items?: Array<Record<string, unknown>> })
        ?.items ?? []) as typeof a;
    const map = new Map<string, (typeof a)[number]>();
    for (const row of [...a, ...b]) map.set(row.id, row);
    return [...map.values()].sort((x, y) =>
      String(x.dueAt ?? x.issueDate ?? "").localeCompare(
        String(y.dueAt ?? y.issueDate ?? "")
      )
    );
  }, [openInvoices.data, overdueInvoices.data]);

  const invoicesFetching =
    Boolean(partyKey) &&
    (openInvoices.isFetching || overdueInvoices.isFetching);

  const allocationSummary = useMemo(() => {
    let applied = D(0);
    for (const v of Object.values(alloc)) {
      applied = applied.add(safeMoney(v));
    }
    const total = safeMoney(amount);
    const unapplied = round2(total.sub(applied));
    return {
      applied: round2(applied).toFixed(2),
      unapplied: unapplied.toFixed(2),
      overAllocated: unapplied.isNegative(),
      total: round2(total).toFixed(2),
    };
  }, [alloc, amount]);

  const customerLabel = useMemo(() => {
    const raw = customerQ.data as
      | { name?: string; customer?: { name?: string } }
      | undefined;
    return raw?.customer?.name ?? raw?.name ?? null;
  }, [customerQ.data]);

  // Keep form deps warm so pickers paint instantly.
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
      queryKey: accountingKeys.bankAccounts(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.listBankAccounts()),
    });
  }, [canWrite, qc]);

  useEffect(() => {
    if (!bankAccountId && (banks.data ?? []).length) {
      const def = (banks.data ?? []).find((b) => b.isDefault) ?? banks.data![0];
      if (def) setBankAccountId(def.id);
    }
  }, [banks.data, bankAccountId]);

  useEffect(() => {
    if (!embedded) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embedded, busy, onClose]);

  useEffect(() => {
    if (!busyHref) return;
    const t = window.setTimeout(() => setBusyHref(null), 8_000);
    return () => window.clearTimeout(t);
  }, [busyHref]);

  useEffect(() => {
    if (!manualRefresh) return;
    if (
      !banks.isFetching &&
      !lookups.isFetching &&
      !settingsFetching &&
      !openInvoices.isFetching &&
      !overdueInvoices.isFetching
    ) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    banks.isFetching,
    lookups.isFetching,
    settingsFetching,
    openInvoices.isFetching,
    overdueInvoices.isFetching,
  ]);

  const liveMode: "first" | "manual" | "idle" = manualRefresh
    ? "manual"
    : settingsPending && !settings
      ? "first"
      : banks.isFetching ||
          lookups.isFetching ||
          settingsFetching ||
          invoicesFetching
        ? "manual"
        : "idle";

  const formLocked = busy || createM.isPending || Boolean(busyHref);

  const goBack = useCallback(() => {
    if (embedded) {
      onClose?.();
      return;
    }
    const href = "/admin/accounting/receipts";
    setBusyHref(href);
    router.push(href);
  }, [embedded, onClose, router]);

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([
      banks.refetch(),
      lookups.refetch(),
      qc.invalidateQueries({ queryKey: accountingKeys.settings() }),
      partyKey
        ? Promise.all([
            openInvoices.refetch(),
            overdueInvoices.refetch(),
            qc.invalidateQueries({
              queryKey: accountingKeys.customer(partyKey),
            }),
          ])
        : Promise.resolve(),
    ]);
  };

  const autoAllocate = () => {
    setAllocBusy(true);
    try {
      let remaining = toMinor(safeMoney(amount));
      if (remaining <= 0) {
        addToast("Enter an amount before auto-allocating", "error");
        return;
      }
      const next: Record<string, string> = {};
      for (const inv of openRows) {
        if (remaining <= 0) break;
        const due = toMinor(D(inv.amountDue));
        if (due <= 0) continue;
        const take = Math.min(remaining, due);
        next[inv.id] = fromMinor(take).toFixed(2);
        remaining -= take;
      }
      setAlloc(next);
    } finally {
      window.setTimeout(() => setAllocBusy(false), 180);
    }
  };

  const finish = (receiptId: string) => {
    if (onCreated) {
      onCreated(receiptId);
      return;
    }
    const href = `/admin/accounting/receipts?receiptId=${receiptId}`;
    setBusyHref(href);
    router.push(href);
  };

  const save = async () => {
    if (!canWrite) return;
    if (!partyKey) {
      addToast("Select a customer", "error");
      return;
    }
    if (!bankAccountId) {
      addToast("Select a bank account", "error");
      return;
    }
    if (safeMoney(amount).lessThanOrEqualTo(0)) {
      addToast("Enter a receipt amount", "error");
      return;
    }
    if (allocationSummary.overAllocated) {
      addToast("Allocations exceed the receipt amount", "error");
      return;
    }

    const allocations = Object.entries(alloc)
      .filter(([, v]) => safeMoney(v).greaterThan(0))
      .map(([invoiceId, amt]) => ({ invoiceId, amount: amt }));

    setBusy(true);
    try {
      const res = (await createM.mutateAsync({
        partyKey,
        method,
        bankAccountId,
        amount,
        receiptDate,
        reference: reference.trim() || null,
        locationId: locationId || null,
        allocations,
      })) as { id?: string; receipt?: { id: string } };
      const id = res.receipt?.id ?? res.id;
      addToast("Receipt recorded", "success");
      if (id) {
        finish(id);
      } else if (onCreated) {
        onCreated("");
      } else {
        goBack();
      }
    } catch (e) {
      addToast(accountingErrorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const form = !canWrite ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      You cannot record receipts.
    </p>
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
                {busyHref === "/admin/accounting/receipts" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Receipts
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Record receipt
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Apply a customer payment to open manual invoices in {currency}.
                Banks and AR stay live with the rest of the desk.
              </p>
              {partyKey && customerLabel ? (
                <p className="mt-2 text-xs font-medium text-stone-500">
                  Customer · {customerLabel}
                </p>
              ) : null}
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
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-stone-600">
                Apply a customer payment to open manual invoices in {currency}.
              </p>
              <LivePulse mode={liveMode} />
            </div>
            {partyKey && customerLabel ? (
              <p className="mt-1 text-xs font-medium text-stone-500">
                Customer · {customerLabel}
              </p>
            ) : null}
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

      <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-[#D4AF37]" />
          <h2 className="text-sm font-semibold text-stone-900">Payment</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PartyPicker
              value={partyKey}
              onChange={(k) => {
                setPartyKey(k);
                setAlloc({});
              }}
              kinds={["customer"]}
              label="Customer"
              disabled={formLocked}
            />
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">Method</span>
            <select
              value={method}
              disabled={formLocked}
              onChange={(e) =>
                setMethod(e.target.value as (typeof METHODS)[number])
              }
              className={fieldClass}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Bank account
            </span>
            <select
              value={bankAccountId}
              disabled={formLocked || (banks.isLoading && !banks.data?.length)}
              onChange={(e) => setBankAccountId(e.target.value)}
              className={fieldClass}
            >
              <option value="">
                {banks.isLoading && !banks.data?.length
                  ? "Loading accounts…"
                  : "Select…"}
              </option>
              {(banks.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <MoneyInput
            label="Amount"
            value={amount}
            currency={currency}
            disabled={formLocked}
            onChange={setAmount}
          />
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Receipt date
            </span>
            <input
              type="date"
              value={receiptDate}
              disabled={formLocked}
              onChange={(e) => setReceiptDate(e.target.value)}
              className={fieldClass}
            />
          </label>
          <LocationPicker
            value={locationId}
            onChange={setLocationId}
            disabled={formLocked}
            syncHqPreference
          />
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-stone-700">
              Reference
            </span>
            <input
              value={reference}
              disabled={formLocked}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque #, transfer id, or note"
              className={fieldClass}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Allocate to invoices
            </h2>
            <p className="text-xs text-stone-500">
              Open sent and overdue manual invoices for this customer
            </p>
          </div>
          <button
            type="button"
            disabled={
              formLocked ||
              allocBusy ||
              openRows.length === 0 ||
              safeMoney(amount).lessThanOrEqualTo(0)
            }
            onClick={autoAllocate}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-40"
          >
            {allocBusy ? (
              <ButtonSpinner />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-[#D4AF37]" />
            )}
            {allocBusy ? "Allocating…" : "Auto-allocate oldest first"}
          </button>
        </div>

        {!partyKey ? (
          <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/60 px-4 py-8 text-center text-sm text-stone-500">
            Select a customer to load open invoices.
          </p>
        ) : invoicesFetching && openRows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500">
            <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
            Loading open invoices…
          </div>
        ) : openRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/60 px-4 py-8 text-center text-sm text-stone-500">
            No open manual invoices for this customer. The full amount will stay
            unapplied.
          </p>
        ) : (
          <ul className="space-y-2">
            {openRows.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/50 px-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-stone-900">{inv.number}</p>
                  <p className="text-xs text-stone-500">
                    Due {inv.dueAt ? String(inv.dueAt).slice(0, 10) : "—"} ·{" "}
                    <MoneyCell
                      value={inv.amountDue}
                      currency={currency}
                      className="inline"
                    />{" "}
                    due
                  </p>
                </div>
                <MoneyInput
                  value={alloc[inv.id] ?? ""}
                  currency={currency}
                  disabled={formLocked}
                  onChange={(v) =>
                    setAlloc((prev) => ({ ...prev, [inv.id]: v }))
                  }
                  className="w-40"
                />
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 rounded-xl border border-stone-100 bg-white px-4 py-3 text-sm sm:ml-auto sm:max-w-xs">
          <div className="flex justify-between text-stone-600">
            <span>Receipt</span>
            <MoneyCell value={allocationSummary.total} currency={currency} />
          </div>
          <div className="flex justify-between text-stone-600">
            <span>Applied</span>
            <MoneyCell value={allocationSummary.applied} currency={currency} />
          </div>
          <div
            className={`flex justify-between border-t border-stone-100 pt-2 font-semibold ${
              allocationSummary.overAllocated
                ? "text-red-700"
                : "text-stone-900"
            }`}
          >
            <span>Unapplied</span>
            <MoneyCell
              value={allocationSummary.unapplied}
              currency={currency}
            />
          </div>
        </div>
        <p className="text-xs text-stone-500">
          Any remainder stays unapplied on the receipt and can be allocated
          later.
        </p>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-stone-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <button
          type="button"
          disabled={formLocked}
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
        >
          {busyHref === "/admin/accounting/receipts" ? (
            <ButtonSpinner />
          ) : null}
          Cancel
        </button>
        <button
          type="button"
          disabled={
            formLocked ||
            !partyKey ||
            !bankAccountId ||
            safeMoney(amount).lessThanOrEqualTo(0) ||
            allocationSummary.overAllocated
          }
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60"
        >
          {formLocked ? <ButtonSpinner /> : <Banknote className="h-4 w-4" />}
          {formLocked ? "Posting…" : "Post receipt"}
        </button>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Record receipt"
        className="fixed inset-y-0 left-0 right-0 z-[70] flex lg:left-64"
      >
        <button
          type="button"
          aria-label="Close overlay"
          tabIndex={-1}
          className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
          onClick={() => {
            if (!busy) onClose?.();
          }}
        />
        <div className="relative m-0 flex w-full flex-col overflow-hidden bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-3 sm:rounded-2xl sm:border sm:border-stone-200">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-stone-900">
                  Record receipt
                </h2>
                <LivePulse mode={liveMode} />
              </div>
              <p className="text-xs text-stone-500">
                Posts a customer payment into AR
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              disabled={busy}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <AccountingGate requireInitialized={false}>{form}</AccountingGate>
          </div>
        </div>
      </div>
    );
  }

  return <AccountingGate>{form}</AccountingGate>;
}
