"use client";

/**
 * New expense — full route or embedded overlay (instant from Expenses list).
 * Categories / banks / suppliers / tax stay warm + live; create syncs lists + approvals.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Receipt,
  RefreshCw,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { D, parseMoneyInput } from "@/lib/accounting/money";
import {
  accountingKeys,
  useAccountingInitialized,
  useAccountingSuppliersQuery,
  useBankAccountsQuery,
  useCreateExpenseMutation,
  useExpenseCategoriesQuery,
} from "@/hooks/useAccounting";
import {
  AccountingGate,
  AttachmentUploader,
  LocationPicker,
  MoneyInput,
  TaxCodePicker,
  accountingErrorMessage,
  asItems,
  asRecord,
  todayIsoDate,
} from "../shared";

const PAYMENT_MODES = [
  {
    id: "paid_now",
    label: "Paid now",
    hint: "Already paid from a company bank or cash account",
  },
  {
    id: "reimbursable",
    label: "Reimbursable",
    hint: "You paid personally — approve then reimburse",
  },
  {
    id: "on_account",
    label: "On account",
    hint: "Creates a supplier bill for AP",
  },
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
      title="Categories, banks, suppliers, and tax stay in quiet live sync"
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

export default function ExpenseNewPage({
  embedded = false,
  active = true,
  onClose,
  onCreated,
}: {
  embedded?: boolean;
  active?: boolean;
  onClose?: () => void;
  onCreated?: (expenseId: string) => void;
} = {}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canSubmit = can(P.AccountingExpensesSubmit);
  const {
    settings,
    isFetching: settingsFetching,
    isPending: settingsPending,
  } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const createMutation = useCreateExpenseMutation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const isLive = !embedded || active;

  const [expenseDate, setExpenseDate] = useState(todayIsoDate);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [paymentMode, setPaymentMode] = useState<string>("paid_now");
  const [bankAccountId, setBankAccountId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [receipts, setReceipts] = useState<string[]>([]);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(false);

  const enabled = canSubmit && (isLive || embedded);
  const catsQuery = useExpenseCategoriesQuery({}, enabled);
  const banksQuery = useBankAccountsQuery({}, enabled);
  const suppliersQuery = useAccountingSuppliersQuery(
    { active: "true" },
    enabled && paymentMode === "on_account"
  );
  const cats = asItems(catsQuery.data, ["categories", "items"]);
  const banks = banksQuery.data ?? [];
  const suppliers = asItems(suppliersQuery.data, ["suppliers", "items"]);

  const amountMoney = useMemo(
    () => parseMoneyInput(amount || "0"),
    [amount]
  );

  const modeMeta = PAYMENT_MODES.find((m) => m.id === paymentMode);

  const receiptThreshold = settings?.receiptRequiredAbove ?? null;
  const needsReceiptHint = useMemo(() => {
    if (receiptThreshold == null || receiptThreshold === "") return false;
    try {
      return amountMoney.greaterThanOrEqualTo(D(String(receiptThreshold)));
    } catch {
      return false;
    }
  }, [amountMoney, receiptThreshold]);

  const canSave =
    canSubmit &&
    Boolean(categoryId) &&
    description.trim().length > 0 &&
    amountMoney.greaterThan(0) &&
    (paymentMode !== "paid_now" || Boolean(bankAccountId)) &&
    (paymentMode !== "on_account" || Boolean(supplierId));

  useEffect(() => {
    if (!canSubmit) return;
    void qc.prefetchQuery({
      queryKey: accountingKeys.expenseCategories({}),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listExpenseCategories({})
        ),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.bankAccounts(),
      queryFn: () =>
        import("@/services/accounting").then((m) => m.listBankAccounts()),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.taxCodes({}),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listAccountingTaxCodes({})
        ),
    });
    void qc.prefetchQuery({
      queryKey: accountingKeys.suppliers({ active: "true" }),
      queryFn: () =>
        import("@/services/accounting").then((m) =>
          m.listAccountingSuppliers({ active: "true" })
        ),
    });
  }, [canSubmit, qc]);

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
      !catsQuery.isFetching &&
      !banksQuery.isFetching &&
      !suppliersQuery.isFetching &&
      !settingsFetching
    ) {
      setManualRefresh(false);
    }
  }, [
    manualRefresh,
    catsQuery.isFetching,
    banksQuery.isFetching,
    suppliersQuery.isFetching,
    settingsFetching,
  ]);

  const liveMode: "first" | "manual" | "idle" = manualRefresh
    ? "manual"
    : settingsPending && !settings
      ? "first"
      : catsQuery.isFetching ||
          banksQuery.isFetching ||
          suppliersQuery.isFetching ||
          settingsFetching
        ? "manual"
        : "idle";

  const formLocked =
    Boolean(busy) || createMutation.isPending || Boolean(busyHref);

  const goBack = useCallback(() => {
    if (embedded) {
      onClose?.();
      return;
    }
    const href = "/admin/accounting/expenses";
    setBusyHref(href);
    router.push(href);
  }, [embedded, onClose, router]);

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([
      catsQuery.refetch(),
      banksQuery.refetch(),
      suppliersQuery.refetch(),
      qc.invalidateQueries({ queryKey: accountingKeys.settings() }),
      qc.invalidateQueries({ queryKey: accountingKeys.taxCodes({}) }),
    ]);
  };

  const finish = (expenseId: string) => {
    if (onCreated) {
      onCreated(expenseId);
      return;
    }
    const href = `/admin/accounting/expenses/${expenseId}`;
    setBusyHref(href);
    router.push(href);
  };

  const setMode = (next: string) => {
    setPaymentMode(next);
    if (next !== "paid_now") setBankAccountId("");
    if (next !== "on_account") setSupplierId("");
  };

  const save = async (submit: boolean) => {
    if (!canSubmit) return;
    if (!categoryId) {
      addToast("Select a category", "error");
      return;
    }
    if (!description.trim()) {
      addToast("Enter a description", "error");
      return;
    }
    if (!amountMoney.greaterThan(0)) {
      addToast("Enter an amount", "error");
      return;
    }
    if (paymentMode === "paid_now" && !bankAccountId) {
      addToast("Select the bank account it was paid from", "error");
      return;
    }
    if (paymentMode === "on_account" && !supplierId) {
      addToast("Select a supplier for on-account spend", "error");
      return;
    }
    if (submit && needsReceiptHint && receipts.length === 0) {
      addToast("A receipt is required for this amount", "error");
      return;
    }
    setBusy(submit ? "submit" : "draft");
    try {
      const res = await createMutation.mutateAsync({
        expenseDate,
        categoryId,
        description: description.trim(),
        amount,
        taxCodeId: taxCodeId || null,
        paymentMode,
        bankAccountId:
          paymentMode === "paid_now" ? bankAccountId || null : null,
        supplierId: paymentMode === "on_account" ? supplierId || null : null,
        locationId: locationId || null,
        payeeName: payeeName.trim() || null,
        receiptUrls: receipts,
        submit,
      });
      const expense = asRecord(asRecord(res).expense ?? res);
      addToast(submit ? "Expense submitted" : "Expense saved", "success");
      finish(String(expense.id));
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusy(null);
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
        {busyHref === "/admin/accounting/expenses" ? <ButtonSpinner /> : null}
        Cancel
      </button>
      <button
        type="button"
        disabled={!canSave || formLocked}
        onClick={() => void save(false)}
        className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
      >
        {busy === "draft" ? <ButtonSpinner /> : null}
        {busy === "draft" ? "Saving…" : "Save draft"}
      </button>
      <button
        type="button"
        disabled={!canSave || formLocked}
        onClick={() => void save(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
      >
        {busy === "submit" ? <ButtonSpinner /> : <Receipt className="h-4 w-4" />}
        {busy === "submit" ? "Submitting…" : "Submit"}
      </button>
    </div>
  );

  const formBody = !canSubmit ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      You need expense submit permission to create expenses.
    </p>
  ) : (
    <div
      className={`mx-auto max-w-3xl space-y-5 ${embedded ? "pb-2" : "pb-24"}`}
    >
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
                {busyHref === "/admin/accounting/expenses" ? (
                  <ButtonSpinner />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                Expenses
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  New expense
                </h1>
                <LivePulse mode={liveMode} />
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Capture a {currency} claim with receipt — categories, banks, and
                suppliers stay live with the desk.
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
          <Receipt className="h-4 w-4 text-[#D4AF37]" />
          <h2 className="text-sm font-semibold text-stone-900">
            Expense details
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Expense date
            </span>
            <input
              type="date"
              className={fieldClass}
              disabled={formLocked}
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Category <span className="text-red-600">*</span>
            </span>
            <select
              className={fieldClass}
              value={categoryId}
              disabled={formLocked || (catsQuery.isLoading && !cats.length)}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">
                {catsQuery.isLoading && !cats.length
                  ? "Loading categories…"
                  : "Select…"}
              </option>
              {cats.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-stone-700">
              Description <span className="text-red-600">*</span>
            </span>
            <input
              className={fieldClass}
              disabled={formLocked}
              placeholder="What was this for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <MoneyInput
            value={amount}
            currency={currency}
            onChange={setAmount}
            label="Amount"
            required
            disabled={formLocked}
          />
          <TaxCodePicker
            value={taxCodeId}
            onChange={setTaxCodeId}
            disabled={formLocked}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">How was it paid?</h2>
          <p className="text-xs text-stone-500">
            {modeMeta?.hint ?? "Choose the payment path for this claim"}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {PAYMENT_MODES.map((m) => {
            const selected = paymentMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={formLocked}
                onClick={() => setMode(m.id)}
                className={`rounded-xl border px-3 py-3 text-left transition disabled:opacity-60 ${
                  selected
                    ? "border-[#D4AF37] bg-[rgba(212,175,55,0.12)] ring-1 ring-[#D4AF37]/40"
                    : "border-stone-200 bg-white hover:bg-stone-50"
                }`}
              >
                <p className="text-sm font-semibold text-stone-900">{m.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-stone-500">
                  {m.hint}
                </p>
              </button>
            );
          })}
        </div>

        {paymentMode === "paid_now" ? (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">
              Paid from <span className="text-red-600">*</span>
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
        ) : null}

        {paymentMode === "on_account" ? (
          <label className="block text-sm">
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
        ) : null}

        {paymentMode === "reimbursable" ? (
          <p className="rounded-xl border border-stone-100 bg-stone-50/80 px-3 py-2 text-xs text-stone-600">
            Reimbursement is filed for you. After approval, finance pays it from
            a bank account on the expense detail.
          </p>
        ) : null}

        <div>
          <LocationPicker
            value={locationId}
            onChange={setLocationId}
            allowCompanyWide
            disabled={formLocked}
            syncHqPreference
          />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">
            Payee name
          </span>
          <input
            className={fieldClass}
            disabled={formLocked}
            placeholder="Optional merchant or person"
            value={payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
          />
        </label>
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">Receipts</h2>
            <p className="text-xs text-stone-500">
              Attach photos or PDFs — camera works on mobile
            </p>
          </div>
          {needsReceiptHint ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
              Receipt required to submit
            </span>
          ) : null}
        </div>
        <AttachmentUploader
          urls={receipts}
          onChange={setReceipts}
          maxFiles={5}
          disabled={formLocked}
        />
        {needsReceiptHint && receipts.length === 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Company policy requires a receipt at or above this amount before
            submit. You can still save a draft.
          </p>
        ) : null}
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
        aria-label="New expense"
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
                  New expense
                </h2>
                <LivePulse mode={liveMode} />
              </div>
              <p className="text-xs text-stone-500">
                Capture a claim with receipt
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
                disabled={Boolean(busy)}
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
          {canSubmit ? (
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
