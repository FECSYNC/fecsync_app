"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import { planAllowsModule } from "@/lib/subscriptionPlans";
import { sessionIsDemoPlan } from "@/lib/demoPlanLock";
import {
  useAccountingInitialized,
} from "@/hooks/useAccounting";
import AccountingErrorMessage from "./AccountingErrorMessage";

export default function AccountingGate({
  children,
  requireInitialized = true,
  allowSetupPage = false,
}: {
  children: React.ReactNode;
  requireInitialized?: boolean;
  /** When true, skip the “go to setup” redirect CTA (setup page itself). */
  allowSetupPage?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const demo = sessionIsDemoPlan(user);
  const softHold = user?.billingSoftHold === true;
  const planOk = planAllowsModule(user?.subscriptionPlan, "accounting");
  const { initialized, isLoading, isError, error, settings } =
    useAccountingInitialized(planOk && !demo && !softHold);
  const [slowLoad, setSlowLoad] = useState(false);

  useEffect(() => {
    if (!(isLoading && !settings && requireInitialized)) {
      setSlowLoad(false);
      return;
    }
    const t = window.setTimeout(() => setSlowLoad(true), 8000);
    return () => window.clearTimeout(t);
  }, [isLoading, settings, requireInitialized]);

  if (softHold) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Billing hold</h2>
        <p className="mt-2 text-sm text-gray-600">
          Your company subscription is past due. Accounting mutations are locked
          until you renew. You can still open Billing to restore access.
        </p>
        <Link
          href="/admin/billing"
          className="mt-4 inline-flex rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030]"
        >
          Open Billing
        </Link>
      </div>
    );
  }

  if (demo) {
    return (
      <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Demo plan lock</h2>
        <p className="mt-2 text-sm text-gray-600">
          Accounting is available on Growth and Enterprise. Upgrade to unlock
          the general ledger and auto-posting.
        </p>
        <Link
          href="/admin/billing"
          className="mt-4 inline-flex rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030]"
        >
          Open Billing
        </Link>
      </div>
    );
  }

  if (!planOk) {
    return (
      <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Accounting needs Growth or Enterprise
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Your current package does not include Accounting. Upgrade in Billing
          to set up the ledger.
        </p>
        <Link
          href="/admin/billing"
          className="mt-4 inline-flex rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030]"
        >
          Upgrade plan
        </Link>
      </div>
    );
  }

  if (isLoading && !settings && requireInitialized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
        {slowLoad ? (
          <p className="max-w-sm text-sm text-stone-600">
            Still connecting to Accounting… If this hangs, the database may be
            unreachable or Turbopack is compiling — wait, or restart{" "}
            <span className="font-medium">yarn dev</span>.
          </p>
        ) : (
          <p className="text-sm text-stone-500">Opening Accounting…</p>
        )}
      </div>
    );
  }

  if (isError) {
    return <AccountingErrorMessage error={error} />;
  }

  if (requireInitialized && !initialized && !allowSetupPage) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          Set up Accounting
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Create your chart of accounts, tax codes, periods, and opening
          balances before posting sales and expenses.
        </p>
        <Link
          href="/admin/accounting/setup"
          className="mt-4 inline-flex rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030]"
        >
          Start setup
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
