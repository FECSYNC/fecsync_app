"use client";

/**
 * New supplier payment — full route or embedded overlay (instant from list).
 * Suppliers / banks / open bills stay warm + live; create invalidates AP lists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { add, minDec, parseMoneyInput, round2 } from "@/lib/accounting/money";
import {
  accountingKeys,
  useAccountingBillsQuery,
  useAccountingInitialized,
  useAccountingSuppliersQuery,
  useBankAccountsQuery,
  useCreateSupplierPaymentMutation,
} from "@/hooks/useAccounting";
import {
  AccountingGate,
  MoneyCell,
  MoneyInput,
  accountingErrorMessage,
  asItems,
  asRecord,
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
      title="Suppliers, banks, and open bills stay in quiet live sync"
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

export default function SupplierPaymentNewPage({
  embedded = false,
  active = true,
  onClose,
  onCreated,
}: {
  embedded?: boolean;
  active?: boolean;
  onClose?: () => void;
  onCreated?: (paymentId: string) => void;
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
  const createMutation = useCreateSupplierPaymentMutation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const isLive = !embedded || active;

  const [supplierId, setSupplierId] = useState(sp.get("supplierId") ?? "");
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIsoDate);
  const [method, setMethod] = useState<string>("bank_transfer");
  const [amount, setAmount] = useState("0.00");
  const [reference, setReference] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [allocBusy, setAllocBusy] = useState(false);
  const prefillBillId = sp.get("billId") ?? "";
  const prefillApplied = useRef(false);

  const enabled = canWrite && (isLive || embedded);
  const suppliersQuery = useAccountingSuppliersQuery(
    { active: "true" },
    enabled
  );
  const banksQuery = useBankAccountsQuery({}, enabled);
  const suppliers = asItems(suppliersQuery.data, ["suppliers", "items"]);
  const banks = banksQuery.data ?? [];

  const openBillsQuery = useAccountingBillsQuery(
    { supplierId: supplierId || undefined, status: "posted" },
    Boolean(supplierId) && enabled
  );
  const partialQuery = useAccountingBillsQuery(
    { supplierId: supplierId || undefined, status: "partially_paid" },
    Boolean(supplierId) && enabled
  );

  const openBills = useMemo(() => {
    const a = asItems(openBillsQuery.data);
    const b = asItems(partialQuery.data);
    const map = new Map<string, Record<string, unknown>>();
    for (const row of [...a, ...b]) map.set(String(row.id), row);
    const rows = [...map.values()].filter((x) =>
      parseMoneyInput(String(x.amountDue ?? "0")).greaterThan(0)
    );
    rows.sort((x, y) => {
      const dx = String(x.dueDate ?? x.billDate ?? "");
      const dy = String(y.dueDate ?? y.billDate ?? "");
      return dx.localeCompare(dy);
    });
    return rows;
  }, [openBillsQuery.data, partialQuery.data]);

  const billsLoading =
    Boolean(supplierId) &&
    (openBillsQuery.isLoading || partialQuery.isLoading) &&
    openBills.length === 0;

  useEffect(() => {
    if (!prefillBillId || prefillApplied.current || !openBills.length) return;
    const bill = openBills.find((b) => String(b.id) === prefillBillId);
    if (!bill) return;
    prefillApplied.current = true;
    const due = String(bill.amountDue ?? "0");
    setAlloc((prev) => ({ ...prev, [prefillBillId]: due }));
    setAmount(due);
  }, [prefillBillId, openBills]);

  const allocatedTotal = useMemo(
    () => add(...Object.values(alloc).map((v) => parseMoneyInput(v || "0"))),
    [alloc]
  );

  const amountMoney = useMemo(() => parseMoneyInput(amount || "0"), [amount]);
  const hasAllocations = useMemo(
    () =>
      Object.values(alloc).some((v) =>
        parseMoneyInput(v || "0").greaterThan(0)
      ),
    [alloc]
  );
  const allocMismatch = useMemo(() => {
    if (!hasAllocations) return false;
    return !allocatedTotal.eq(amountMoney);
  }, [allocatedTotal, amountMoney, hasAllocations]);

  const canCreate =
    canWrite &&
    Boolean(supplierId) &&
    Boolean(bankAccountId) &&
    amountMoney.greaterThan(0) &&
    hasAllocations &&
    !allocMismatch;

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
      queryKey: accountingKeys.bankAccounts(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.listBankAccounts()),
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
      !banksQuery.isFetching &&
      !openBillsQuery.isFetching &&
      !partialQuery.isFetching &&
      !settingsFetching
    ) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    suppliersQuery.isFetching,
    banksQuery.isFetching,
    openBillsQuery.isFetching,
    partialQuery.isFetching,
    settingsFetching,
  ]);

  const liveMode: "first" | "manual" | "idle" = manualRefresh
    ? "manual"
    : settingsPending && !settings
      ? "first"
      : suppliersQuery.isFetching ||
          banksQuery.isFetching ||
          openBillsQuery.isFetching ||
          partialQuery.isFetching ||
          settingsFetching
        ? "manual"
        : "idle";

  const formLocked = busy || createMutation.isPending || Boolean(busyHref);

  const goBack = useCallback(() => {
    if (embedded) {
      onClose?.();
      return;
    }
    const href = "/admin/accounting/supplier-payments";
    setBusyHref(href);
    router.push(href);
  }, [embedded, onClose, router]);

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([
      suppliersQuery.refetch(),
      banksQuery.refetch(),
      openBillsQuery.refetch(),
      partialQuery.refetch(),
      qc.invalidateQueries({ queryKey: accountingKeys.settings() }),
    ]);
  };

  const finish = (paymentId: string) => {
    if (onCreated) {
      onCreated(paymentId);
      return;
    }
    const href = `/admin/accounting/supplier-payments/${paymentId}`;
    setBusyHref(href);
    router.push(href);
  };

  const applyFullDue = (billId: string, due: string) => {
    setAlloc((prev) => {
      const next = { ...prev, [billId]: due };
      const total = add(
        ...Object.values(next).map((v) => parseMoneyInput(v || "0"))
      );
      if (!amountMoney.greaterThan(0) || amountMoney.eq(allocatedTotal)) {
        setAmount(round2(total).toFixed(2));
      }
      return next;
    });
  };

  const matchAmountToAllocated = () => {
    if (!hasAllocations) return;
    setAmount(round2(allocatedTotal).toFixed(2));
  };

  const autoAllocate = () => {
    if (!openBills.length) return;
    setAllocBusy(true);
    try {
      let remaining = amountMoney;
      if (!remaining.greaterThan(0)) {
        const allDue = add(
          ...openBills.map((b) =>
            parseMoneyInput(String(b.amountDue ?? "0"))
          )
        );
        remaining = allDue;
        setAmount(round2(allDue).toFixed(2));
      }
      const next: Record<string, string> = {};
      for (const b of openBills) {
        if (!remaining.greaterThan(0)) {
          next[String(b.id)] = "";
          continue;
        }
        const due = parseMoneyInput(String(b.amountDue ?? "0"));
        const take = minDec(remaining, due);
        next[String(b.id)] = round2(take).toFixed(2);
        remaining = remaining.sub(take);
      }
      setAlloc(next);
    } finally {
      window.setTimeout(() => setAllocBusy(false), 180);
    }
  };

  const save = async () => {
    if (!canWrite) return;
    if (!supplierId) {
      addToast("Select a supplier", "error");
      return;
    }
    if (!bankAccountId) {
      addToast("Select a bank account", "error");
      return;
    }
    if (!amountMoney.greaterThan(0)) {
      addToast("Enter a payment amount", "error");
      return;
    }
    const allocations = Object.entries(alloc)
      .filter(([, v]) => parseMoneyInput(v || "0").greaterThan(0))
      .map(([billId, amt]) => ({ billId, amount: amt }));
    if (!allocations.length) {
      addToast("Allocate the payment to at least one bill", "error");
      return;
    }
    if (allocMismatch) {
      addToast("Allocated total must equal the payment amount", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createMutation.mutateAsync({
        supplierId,
        bankAccountId,
        paymentDate,
        method,
        amount,
        reference: reference.trim() || null,
        allocations,
      });
      const payment = asRecord(asRecord(res).payment ?? res);
      addToast("Payment created", "success");
      finish(String(payment.id));
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={formLocked}
        onClick={goBack}
        className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
      >
        {busyHref === "/admin/accounting/supplier-payments" ? (
          <ButtonSpinner />
        ) : null}
        Cancel
      </button>
      <button
        type="button"
        disabled={!canCreate || formLocked}
        onClick={() => void save()}
        className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
      >
        {formLocked ? <ButtonSpinner /> : <Banknote className="h-4 w-4" />}
        {formLocked ? "Creating…" : "Create payment"}
      </button>
    </div>
  );

  const formBody = !canWrite ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      You need payables write permission to create supplier payments.
    </p>
  ) : (
    <div className={`mx-auto max-w-4xl space-y-5 ${embedded ? "pb-2" : "pb-24"}`}>
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
                {busyHref === "/admin/accounting/supplier-payments" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Payments
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  New payment
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Allocate a {currency} bank payment to open bills. Suppliers and
                banks stay live with the desk.
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
      ) : null}

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-[#D4AF37]" />
          <h2 className="text-sm font-semibold text-stone-900">
            Payment details
          </h2>
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
              onChange={(e) => {
                setSupplierId(e.target.value);
                setAlloc({});
                prefillApplied.current = true;
              }}
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
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-stone-700">
              Bank account <span className="text-red-600">*</span>
            </span>
            <select
              className={fieldClass}
              value={bankAccountId}
              disabled={
                formLocked || (banksQuery.isLoading && !banks.length)
              }
              onChange={(e) => setBankAccountId(e.target.value)}
            >
              <option value="">
                {banksQuery.isLoading && !banks.length
                  ? "Loading accounts…"
                  : "Select…"}
              </option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.accountLast4 ? ` ····${b.accountLast4}` : ""}
                  {b.currency ? ` (${b.currency})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Payment date
            </span>
            <input
              type="date"
              className={fieldClass}
              disabled={formLocked}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">Method</span>
            <select
              className={fieldClass}
              disabled={formLocked}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <div>
            <MoneyInput
              value={amount}
              currency={currency}
              onChange={setAmount}
              label="Amount"
              required
              disabled={formLocked}
            />
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Reference
            </span>
            <input
              className={fieldClass}
              disabled={formLocked}
              placeholder="Optional bank / cheque reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Allocate to bills
            </h2>
            <p className="text-xs text-stone-500">
              Posted and partially paid bills — oldest due first
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ring-1 ${
                allocMismatch
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : hasAllocations && allocatedTotal.eq(amountMoney)
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : "bg-stone-100 text-stone-600 ring-stone-200"
              }`}
            >
              {allocatedTotal.toFixed(2)} / {amount || "0.00"}
            </span>
            <button
              type="button"
              disabled={
                formLocked ||
                allocBusy ||
                !supplierId ||
                openBills.length === 0
              }
              onClick={autoAllocate}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-40"
            >
              {allocBusy ? (
                <ButtonSpinner />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-[#D4AF37]" />
              )}
              {allocBusy ? "Allocating…" : "Auto-allocate"}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-stone-100">
          {billsLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
              Loading open bills…
            </div>
          ) : !supplierId ? (
            <p className="px-4 py-10 text-center text-sm text-stone-500">
              Select a supplier to see open bills.
            </p>
          ) : openBills.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-stone-500">
              No open bills for this supplier.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {openBills.map((b) => {
                const id = String(b.id);
                const due = String(b.amountDue ?? "0");
                return (
                  <li
                    key={id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-900">
                        {String(b.number)}
                      </p>
                      <p className="text-xs text-stone-500">
                        Due{" "}
                        {b.dueDate
                          ? String(b.dueDate).slice(0, 10)
                          : "—"}{" "}
                        ·{" "}
                        <MoneyCell
                          value={due}
                          currency={
                            (b.currency as string | undefined) || currency
                          }
                          className="inline"
                        />{" "}
                        due
                      </p>
                      <button
                        type="button"
                        disabled={formLocked}
                        onClick={() => applyFullDue(id, due)}
                        className="mt-1 text-[11px] font-medium text-[#8a7318] hover:underline disabled:opacity-50"
                      >
                        Use full due
                      </button>
                    </div>
                    <MoneyInput
                      value={alloc[id] ?? ""}
                      currency={currency}
                      disabled={formLocked}
                      onChange={(v) =>
                        setAlloc((prev) => ({ ...prev, [id]: v }))
                      }
                      className="w-40"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {allocMismatch ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Allocated total must equal the payment amount.
            </p>
          ) : (
            <span className="text-xs text-stone-500">
              {hasAllocations
                ? "Allocation matches when the badge turns green."
                : "Allocate at least one bill to enable Create."}
            </span>
          )}
          {hasAllocations && allocMismatch ? (
            <button
              type="button"
              disabled={formLocked}
              onClick={matchAmountToAllocated}
              className="text-xs font-medium text-[#8a7318] hover:underline disabled:opacity-50"
            >
              Match amount to allocated
            </button>
          ) : null}
        </div>
      </section>

      {!embedded ? (
        <div className="sticky bottom-3 z-10 rounded-2xl border border-stone-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          {actions}
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return (
      <div
        role="dialog"
        aria-modal={isLive}
        aria-hidden={!isLive}
        aria-label="New supplier payment"
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
                  New payment
                </h2>
                <LivePulse mode={liveMode} />
              </div>
              <p className="text-xs text-stone-500">
                Allocate bank payment to open bills
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={manualRefresh || formLocked}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-60"
              >
                {manualRefresh ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-stone-500" />
                )}
                <span className="hidden sm:inline">
                  {manualRefresh ? "Refreshing…" : "Refresh"}
                </span>
              </button>
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
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <AccountingGate requireInitialized={false}>{formBody}</AccountingGate>
          </div>
          {canWrite ? (
            <footer className="shrink-0 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
              {actions}
            </footer>
          ) : null}
        </div>
      </div>
    );
  }

  return <AccountingGate>{formBody}</AccountingGate>;
}
