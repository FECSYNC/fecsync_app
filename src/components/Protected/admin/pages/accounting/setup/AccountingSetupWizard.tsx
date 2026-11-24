"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingInitialized,
  useAccountingSetupPreviewQuery,
  useRunAccountingSetupMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  accountingErrorMessage,
} from "../shared";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Step = 0 | 1 | 2 | 3 | 4;

export default function AccountingSetupWizard() {
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.AccountingManage);
  const { initialized, settings } = useAccountingInitialized(canManage);
  const previewQuery = useAccountingSetupPreviewQuery(canManage && !initialized);
  const setupMutation = useRunAccountingSetupMutation();

  const [step, setStep] = useState<Step>(0);
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);
  const [timezone, setTimezone] = useState("UTC");
  const [goLiveDate, setGoLiveDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [importHistory, setImportHistory] = useState(false);

  useEffect(() => {
    if (initialized) {
      router.replace("/admin/accounting/settings");
    }
  }, [initialized, router]);

  useEffect(() => {
    const p = previewQuery.data as {
      defaults?: {
        baseCurrency?: string;
        timezone?: string;
        fiscalYearStartMonth?: number;
        goLiveDate?: string;
      };
    } | undefined;
    if (!p?.defaults) return;
    if (p.defaults.baseCurrency) setBaseCurrency(p.defaults.baseCurrency);
    if (p.defaults.timezone) setTimezone(p.defaults.timezone);
    if (p.defaults.fiscalYearStartMonth) {
      setFiscalYearStartMonth(p.defaults.fiscalYearStartMonth);
    }
    if (p.defaults.goLiveDate) {
      setGoLiveDate(String(p.defaults.goLiveDate).slice(0, 10));
    }
  }, [previewQuery.data]);

  const historyCounts = useMemo(() => {
    const p = previewQuery.data as {
      historyCounts?: Record<string, number>;
      dryRun?: { enqueued?: Record<string, number> };
    } | undefined;
    return p?.historyCounts ?? p?.dryRun?.enqueued ?? {};
  }, [previewQuery.data]);

  const chartPreview = useMemo(() => {
    const p = previewQuery.data as {
      chartTemplate?: { code: string; name: string; type: string }[];
      accountsPreview?: { code: string; name: string; type: string }[];
    } | undefined;
    return p?.chartTemplate ?? p?.accountsPreview ?? [];
  }, [previewQuery.data]);

  const runSetup = async () => {
    if (!canManage) {
      addToast("You do not have permission to set up accounting", "error");
      return;
    }
    try {
      await setupMutation.mutateAsync({
        baseCurrency: baseCurrency.trim().toUpperCase(),
        fiscalYearStartMonth,
        goLiveDate,
        timezone: timezone.trim() || undefined,
        template: "fec_default",
        importHistory,
      });
      addToast("Accounting is ready", "success");
      router.replace("/admin/accounting/settings");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  if (initialized && settings) {
    return (
      <div className="text-sm text-gray-600">Redirecting to settings…</div>
    );
  }

  return (
    <AccountingGate requireInitialized={false} allowSetupPage>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounting setup</h1>
          <p className="mt-2 text-sm text-gray-600">
            Choose currency, fiscal year, timezone, and go-live. We seed the FEC
            chart, tax codes, bank accounts, and periods in one step.
          </p>
        </div>

        <ol className="flex flex-wrap gap-2 text-xs font-medium">
          {["Currency & year", "Timezone & go-live", "Chart preview", "Import history", "Review"].map(
            (name, i) => (
              <li
                key={name}
                className={`rounded-full px-3 py-1 ${
                  step === i
                    ? "bg-[#D4AF37] text-white"
                    : i < step
                      ? "bg-[#D4AF37]/15 text-[#8a7010]"
                      : "bg-gray-100 text-gray-500"
                }`}
              >
                {i + 1}. {name}
              </li>
            )
          )}
        </ol>

        {previewQuery.isError ? (
          <AccountingErrorMessage error={previewQuery.error} />
        ) : null}

        <div className="rounded-2xl border border-gray-100 bg-white p-6 space-y-5">
          {step === 0 ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Base currency (ISO 4217)
                </span>
                <input
                  value={baseCurrency}
                  maxLength={3}
                  onChange={(e) =>
                    setBaseCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 uppercase outline-none focus:border-[#D4AF37]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Fiscal year starts
                </span>
                <select
                  value={fiscalYearStartMonth}
                  onChange={(e) => setFiscalYearStartMonth(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-[#D4AF37]"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Accounting timezone
                </span>
                <input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Africa/Lagos"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-[#D4AF37]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Go-live date
                </span>
                <input
                  type="date"
                  value={goLiveDate}
                  onChange={(e) => setGoLiveDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-[#D4AF37]"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  System postings start on this date. Opening balances are dated
                  the day before.
                </span>
              </label>
            </>
          ) : null}

          {step === 2 ? (
            <div>
              <h2 className="font-semibold text-gray-900">FEC default chart</h2>
              <p className="mt-1 text-sm text-gray-600">
                You can edit codes and names after setup under Chart of accounts.
              </p>
              <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(chartPreview.length
                      ? chartPreview
                      : [{ code: "…", name: "Loading template…", type: "" }]
                    ).slice(0, 80).map((a, i) => (
                      <tr key={`${a.code}-${i}`} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 font-mono text-xs">{a.code}</td>
                        <td className="px-3 py-1.5">{a.name}</td>
                        <td className="px-3 py-1.5 capitalize text-gray-500">{a.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <label className="flex items-start gap-3 rounded-xl border border-gray-100 p-4">
                <input
                  type="checkbox"
                  checked={importHistory}
                  onChange={(e) => setImportHistory(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-gray-900">
                    Import history from go-live
                  </span>
                  <span className="mt-1 block text-sm text-gray-600">
                    Enqueue past bookings, POS, memberships, marketplace, shop,
                    tailoring, gift cards, and tills. Idempotent — safe to re-run
                    later from the CLI.
                  </span>
                </span>
              </label>
              <ul className="grid grid-cols-2 gap-2 text-sm text-gray-700 sm:grid-cols-3">
                {Object.entries(historyCounts).length === 0 ? (
                  <li className="text-gray-500">No preview counts yet.</li>
                ) : (
                  Object.entries(historyCounts).map(([k, v]) => (
                    <li key={k} className="rounded-lg bg-gray-50 px-3 py-2">
                      <span className="font-medium">{k}</span>: {v}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-2 text-sm text-gray-700">
              <p>
                <span className="font-medium">Currency:</span> {baseCurrency}
              </p>
              <p>
                <span className="font-medium">Fiscal year start:</span>{" "}
                {MONTHS[fiscalYearStartMonth - 1]}
              </p>
              <p>
                <span className="font-medium">Timezone:</span> {timezone}
              </p>
              <p>
                <span className="font-medium">Go-live:</span> {goLiveDate}
              </p>
              <p>
                <span className="font-medium">Import history:</span>{" "}
                {importHistory ? "Yes" : "No"}
              </p>
              {!canManage ? (
                <p className="text-red-600">
                  You need accounting:manage to finish setup.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-between gap-3 pt-2">
            <button
              type="button"
              disabled={step === 0 || setupMutation.isPending}
              onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-40"
            >
              Back
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s < 4 ? ((s + 1) as Step) : s))}
                className="rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030]"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={!canManage || setupMutation.isPending}
                onClick={() => void runSetup()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030] disabled:opacity-50"
              >
                {setupMutation.isPending ? <ButtonSpinner /> : null}
                Run setup
              </button>
            )}
          </div>
        </div>
      </div>
    </AccountingGate>
  );
}
