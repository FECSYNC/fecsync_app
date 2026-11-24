"use client";

/**
 * Accounting settings — recognition, approvals, reminders, posting sources.
 * Uses the shared settings query (desk-prefetched) for split-second open.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Save,
  Settings2,
} from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingInitialized,
  usePatchAccountingSettingsMutation,
} from "@/hooks/useAccounting";
import type { AccountingSettingsDto } from "@/services/accounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyInput,
  accountingErrorMessage,
} from "../shared";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-stone-500">{hint}</span>
      ) : null}
    </label>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200/80 bg-stone-50/50 px-3 py-3 transition hover:bg-stone-50 ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-stone-800">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>
        ) : null}
      </span>
    </label>
  );
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

function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-5"
        >
          <div className="h-5 w-40 rounded bg-stone-100" />
          <div className="h-10 rounded-xl bg-stone-50" />
          <div className="h-10 rounded-xl bg-stone-50" />
        </div>
      ))}
    </div>
  );
}

function patchPayload(form: Partial<AccountingSettingsDto>) {
  return {
    baseCurrency: form.baseCurrency,
    timezone: form.timezone,
    fiscalYearStartMonth: form.fiscalYearStartMonth,
    goLiveDate: form.goLiveDate
      ? String(form.goLiveDate).slice(0, 10)
      : undefined,
    bookingRevenueRecognition: form.bookingRevenueRecognition,
    membershipRecognition: form.membershipRecognition,
    requireApprovalForManualJournals: form.requireApprovalForManualJournals,
    manualJournalApprovalThreshold: form.manualJournalApprovalThreshold,
    expenseApprovalThreshold: form.expenseApprovalThreshold,
    billApprovalThreshold: form.billApprovalThreshold,
    supplierPaymentApprovalThreshold: form.supplierPaymentApprovalThreshold,
    allowSelfApproval: form.allowSelfApproval,
    receiptRequiredAbove: form.receiptRequiredAbove,
    defaultPaymentTermsDays: form.defaultPaymentTermsDays,
    invoiceReminderOffsets: form.invoiceReminderOffsets,
    billReminderDaysBefore: form.billReminderDaysBefore,
    postShopOrders: form.postShopOrders,
    postTailoringJobs: form.postTailoringJobs,
    giftCardBreakageOnExpiry: form.giftCardBreakageOnExpiry,
    allowNegativeStock: form.allowNegativeStock,
    statementFooter: form.statementFooter,
  };
}

function serializeForm(form: Partial<AccountingSettingsDto>) {
  return JSON.stringify(patchPayload(form));
}

const inputClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50";

export default function AccountingSettingsPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.AccountingManage);
  const {
    settings,
    isLoading,
    isFetching,
    isError,
    error,
    isFetched,
    refetch,
  } = useAccountingInitialized(true);
  const patchMutation = usePatchAccountingSettingsMutation();

  const [form, setForm] = useState<Partial<AccountingSettingsDto>>({});
  const [baseline, setBaseline] = useState("");
  const [manualRefresh, setManualRefresh] = useState(false);

  const dirty =
    baseline !== "" && serializeForm(form) !== baseline;

  useEffect(() => {
    if (!settings) return;
    if (dirty) return;
    setForm(settings);
    setBaseline(serializeForm(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirty-aware sync
  }, [settings]);

  useEffect(() => {
    if (!isFetching) setManualRefresh(false);
  }, [isFetching]);

  const blocking = isAdminQueryBlockingLoad(
    isLoading && !settings,
    Boolean(settings) || isFetched
  );

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || patchMutation.isPending
      ? "manual"
      : "idle";

  const set = <K extends keyof AccountingSettingsDto>(
    key: K,
    value: AccountingSettingsDto[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const monthLabel = useMemo(() => {
    const m = Number(form.fiscalYearStartMonth ?? 1);
    if (!Number.isFinite(m) || m < 1 || m > 12) return "";
    return new Date(2000, m - 1, 1).toLocaleString(undefined, {
      month: "long",
    });
  }, [form.fiscalYearStartMonth]);

  const onRefresh = () => {
    setManualRefresh(true);
    void refetch().then((res) => {
      const next =
        res.data && "settings" in res.data && res.data.settings
          ? res.data.settings
          : res.data && "enabled" in res.data
            ? (res.data as AccountingSettingsDto)
            : null;
      if (next) {
        setForm(next);
        setBaseline(serializeForm(next));
      }
    });
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canManage) {
      addToast("You do not have permission to save accounting settings", "error");
      return;
    }
    if (!dirty) return;
    try {
      const updated = await patchMutation.mutateAsync(patchPayload(form));
      setForm(updated);
      setBaseline(serializeForm(updated));
      addToast("Accounting settings saved", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
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
                  Accounting settings
                </h1>
                <LivePulse mode={liveMode} />
                {dirty ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                    Unsaved changes
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Recognition policies, approvals, reminders, and which sources
                post to the ledger — stays live across the accounting desk.
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
                disabled={!canManage || patchMutation.isPending || !dirty}
                onClick={() => void save()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
              >
                {patchMutation.isPending ? (
                  <ButtonSpinner />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {patchMutation.isPending ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        </header>

        {isError ? <AccountingErrorMessage error={error} /> : null}

        {blocking ? (
          <FormSkeleton />
        ) : settings ? (
          <form onSubmit={(e) => void save(e)} className="space-y-4 pb-24">
            <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-[#D4AF37]" />
                <h2 className="text-sm font-semibold text-stone-900">General</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Base currency"
                  hint="Three-letter ISO code. Locked by the server once journals are posted."
                >
                  <input
                    value={form.baseCurrency ?? ""}
                    disabled={!canManage}
                    onChange={(e) =>
                      set(
                        "baseCurrency",
                        e.target.value.toUpperCase().slice(0, 3)
                      )
                    }
                    className={`${inputClass} uppercase`}
                  />
                </Field>
                <Field
                  label="Timezone"
                  hint="IANA timezone for period dates. Locked once any journal entries exist."
                >
                  <input
                    value={form.timezone ?? ""}
                    disabled={!canManage}
                    onChange={(e) => set("timezone", e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Fiscal year start month"
                  hint={
                    monthLabel
                      ? `Starts in ${monthLabel}. Locked once periods or journals exist.`
                      : "1 = January … 12 = December"
                  }
                >
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={form.fiscalYearStartMonth ?? 1}
                    disabled={!canManage}
                    onChange={(e) =>
                      set("fiscalYearStartMonth", Number(e.target.value))
                    }
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Go-live date"
                  hint="Can only move forward when no earlier system postings exist."
                >
                  <input
                    type="date"
                    value={String(form.goLiveDate ?? "").slice(0, 10)}
                    disabled={!canManage}
                    onChange={(e) => set("goLiveDate", e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Default payment terms (days)">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={form.defaultPaymentTermsDays ?? 30}
                    disabled={!canManage}
                    onChange={(e) =>
                      set("defaultPaymentTermsDays", Number(e.target.value))
                    }
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Statement footer">
                <textarea
                  rows={3}
                  value={form.statementFooter ?? ""}
                  disabled={!canManage}
                  onChange={(e) =>
                    set("statementFooter", e.target.value || null)
                  }
                  className={inputClass}
                />
              </Field>
            </section>

            <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-stone-900">
                Revenue recognition
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Booking revenue"
                  hint="When ticket / booking sales hit the ledger"
                >
                  <select
                    value={form.bookingRevenueRecognition ?? "on_confirm"}
                    disabled={!canManage}
                    onChange={(e) =>
                      set(
                        "bookingRevenueRecognition",
                        e.target
                          .value as AccountingSettingsDto["bookingRevenueRecognition"]
                      )
                    }
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="on_confirm">On confirm</option>
                    <option value="on_visit">On visit / check-in</option>
                  </select>
                </Field>
                <Field
                  label="Membership revenue"
                  hint="When membership plans are recognized"
                >
                  <select
                    value={form.membershipRecognition ?? "on_payment"}
                    disabled={!canManage}
                    onChange={(e) =>
                      set(
                        "membershipRecognition",
                        e.target
                          .value as AccountingSettingsDto["membershipRecognition"]
                      )
                    }
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="on_payment">On payment</option>
                    <option value="over_term">Over term</option>
                  </select>
                </Field>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-stone-900">
                Approvals & thresholds
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Require approval for manual journals"
                  hint="Draft journals need a second set of eyes before posting"
                  checked={Boolean(form.requireApprovalForManualJournals)}
                  disabled={!canManage}
                  onChange={(v) =>
                    set("requireApprovalForManualJournals", v)
                  }
                />
                <Toggle
                  label="Allow self-approval"
                  hint="Same person can submit and approve"
                  checked={Boolean(form.allowSelfApproval)}
                  disabled={!canManage}
                  onChange={(v) => set("allowSelfApproval", v)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyInput
                  label="Manual journal approval threshold"
                  currency={form.baseCurrency ?? "USD"}
                  value={form.manualJournalApprovalThreshold ?? ""}
                  disabled={!canManage}
                  onChange={(v) =>
                    set("manualJournalApprovalThreshold", v || null)
                  }
                />
                <MoneyInput
                  label="Expense approval threshold"
                  currency={form.baseCurrency ?? "USD"}
                  value={form.expenseApprovalThreshold ?? ""}
                  disabled={!canManage}
                  onChange={(v) => set("expenseApprovalThreshold", v || null)}
                />
                <MoneyInput
                  label="Bill approval threshold"
                  currency={form.baseCurrency ?? "USD"}
                  value={form.billApprovalThreshold ?? ""}
                  disabled={!canManage}
                  onChange={(v) => set("billApprovalThreshold", v || null)}
                />
                <MoneyInput
                  label="Supplier payment approval threshold"
                  currency={form.baseCurrency ?? "USD"}
                  value={form.supplierPaymentApprovalThreshold ?? ""}
                  disabled={!canManage}
                  onChange={(v) =>
                    set("supplierPaymentApprovalThreshold", v || null)
                  }
                />
                <MoneyInput
                  label="Receipt required above"
                  currency={form.baseCurrency ?? "USD"}
                  value={form.receiptRequiredAbove ?? ""}
                  disabled={!canManage}
                  onChange={(v) => set("receiptRequiredAbove", v || null)}
                />
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-stone-900">Reminders</h2>
              <Field
                label="Invoice reminder offsets (days)"
                hint="Comma-separated. Negative = before due. Example: -3, 0, 7, 14, 30"
              >
                <input
                  value={(form.invoiceReminderOffsets ?? []).join(", ")}
                  disabled={!canManage}
                  onChange={(e) =>
                    set(
                      "invoiceReminderOffsets",
                      e.target.value
                        .split(",")
                        .map((x) => Number(x.trim()))
                        .filter((n) => Number.isFinite(n))
                    )
                  }
                  className={inputClass}
                />
              </Field>
              <Field
                label="Bill reminder days before"
                hint="Comma-separated days before supplier bill due dates"
              >
                <input
                  value={(form.billReminderDaysBefore ?? []).join(", ")}
                  disabled={!canManage}
                  onChange={(e) =>
                    set(
                      "billReminderDaysBefore",
                      e.target.value
                        .split(",")
                        .map((x) => Number(x.trim()))
                        .filter((n) => Number.isFinite(n) && n >= 0)
                    )
                  }
                  className={inputClass}
                />
              </Field>
            </section>

            <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-stone-900">
                Sources to post
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Post shop orders"
                  hint="Storefront / catalog orders auto-post when entitled"
                  checked={Boolean(form.postShopOrders)}
                  disabled={!canManage}
                  onChange={(v) => set("postShopOrders", v)}
                />
                <Toggle
                  label="Post tailoring jobs"
                  hint="Tailor studio jobs feed the ledger when enabled"
                  checked={Boolean(form.postTailoringJobs)}
                  disabled={!canManage}
                  onChange={(v) => set("postTailoringJobs", v)}
                />
                <Toggle
                  label="Gift card breakage on expiry"
                  hint="Recognize unused gift card balances when they expire"
                  checked={Boolean(form.giftCardBreakageOnExpiry)}
                  disabled={!canManage}
                  onChange={(v) => set("giftCardBreakageOnExpiry", v)}
                />
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-stone-900">Inventory</h2>
              <Toggle
                label="Allow negative stock"
                hint="Still flagged in valuation reports when on-hand goes below zero"
                checked={Boolean(form.allowNegativeStock)}
                disabled={!canManage}
                onChange={(v) => set("allowNegativeStock", v)}
              />
            </section>

            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white/95 p-4 shadow-lg backdrop-blur sm:px-5">
              <p className="text-xs text-stone-500">
                {dirty
                  ? "You have unsaved changes"
                  : "All changes saved"}
              </p>
              <button
                type="submit"
                disabled={!canManage || patchMutation.isPending || !dirty}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
              >
                {patchMutation.isPending ? (
                  <ButtonSpinner />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {patchMutation.isPending ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </AccountingGate>
  );
}
