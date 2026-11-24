"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";
import { getMe } from "@/services/auth";
import { useAuthStore } from "@/store/authStore";
import { clearUserQueries } from "@/utils/clearUserQueries";
import { invalidateOrgSaasQueries } from "@/utils/invalidateOrgSaasQueries";
import { isPlatformAdminActor } from "@/lib/auth/permissions";
import {
  downloadCompanyWorkspaceExport,
  requestCompanyWorkspaceOffboard,
  saveWorkspaceExportFile,
} from "@/services/companyWorkspace";
import { getAdminCompanyProfileWithLifecycle } from "@/services/companyProfile";
import BillingGraceCountdown from "@/components/billing/BillingGraceCountdown";
import BillingDurationSelect from "@/components/billing/BillingDurationSelect";
import {
  resolveBillingDurationMonthsInterest,
  type BillingDurationMonths,
} from "@/lib/subscriptionPlans";

/**
 * Waiting room after self-serve company registration.
 * Paid Checkout auto-activates the workspace (no FECSYNC Approve click).
 * Polls /me so payment / ops unlock propagates without a full reload.
 * Soft billing hold: export / soft-offboard still available (DB may stay active).
 */
function CompanyPendingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const storedOrgStatus = useAuthStore((s) => s.user?.orgStatus ?? null);
  const storedOrgName = useAuthStore((s) => s.user?.organizationName ?? null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [orgStatus, setOrgStatus] = useState<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(
    user?.subscriptionStatus ?? null
  );
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(
    user?.subscriptionPlan ?? null
  );
  const [billingSoftHold, setBillingSoftHold] = useState(false);
  const [billingGraceEndsAt, setBillingGraceEndsAt] = useState<string | null>(
    null
  );
  const [exportBusy, setExportBusy] = useState(false);
  const [offboardBusy, setOffboardBusy] = useState(false);
  const [offboardRequestedAt, setOffboardRequestedAt] = useState<string | null>(
    null
  );
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Your company workspace is awaiting payment or FECSYNC approval."
  );
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [interestPlan, setInterestPlan] = useState<string | null>(
    user?.requestedPlan ?? user?.subscriptionPlan ?? null
  );
  const [durationMonths, setDurationMonths] = useState<BillingDurationMonths>(
    resolveBillingDurationMonthsInterest({
      requestedDurationMonths: user?.requestedDurationMonths,
      subscriptionInterval: user?.subscriptionInterval,
    })
  );
  const [durationTouched, setDurationTouched] = useState(false);

  useEffect(() => {
    const payError = searchParams.get("payError")?.trim();
    if (!payError) return;
    setCheckoutError(payError);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("payError");
    const qs = params.toString();
    router.replace(qs ? `/company-pending?${qs}` : "/company-pending", {
      scroll: false,
    });
  }, [searchParams, router]);

  const canLifecycle =
    isPlatformAdminActor(user) &&
    user?.accountSuspended !== true &&
    (billingSoftHold === true ||
      (orgStatus === "suspended" && subscriptionStatus === "expired"));

  const applyStatus = useCallback(
    (
      status: string | null | undefined,
      name: string | null | undefined,
      softHold?: boolean,
      subStatus?: string | null,
      graceEndsAt?: string | null,
      plan?: string | null
    ) => {
      setOrgStatus(status ?? null);
      setBillingSoftHold(softHold === true);
      setBillingGraceEndsAt(
        softHold === true && graceEndsAt ? graceEndsAt : null
      );
      if (subStatus !== undefined) {
        setSubscriptionStatus(subStatus ?? null);
      }
      if (plan !== undefined) {
        setSubscriptionPlan(plan ?? null);
      }
      if (name) setCompanyName(name);
      if (status === "active" && softHold !== true) {
        invalidateOrgSaasQueries(queryClient);
        router.replace("/admin");
        return true;
      }
      const demoExpired =
        status === "suspended" &&
        subStatus === "expired" &&
        (plan ?? subscriptionPlan)?.toLowerCase() === "demo";
      if (status === "suspended" || softHold === true) {
        setMessage(
          softHold
            ? "Your package period ended — you have a renewal grace window. Renew below before the countdown finishes to keep full access. After grace, the workspace moves to Demo (your records stay intact). You can still export or request soft offboard."
              : demoExpired
              ? "Your Demo trial (one month) ended without an upgrade. Contact the FECSYNC team to reactivate Demo — then open Billing to upgrade to Starter, Growth, or Enterprise. Your company records are kept."
              : subStatus === "expired"
                ? "Your subscription ended and the workspace was suspended automatically. Renew below — successful payment reactivates access without a manual Approve."
                : "Your account has been suspended. Contact the developers or IT team for further help on how to unlock the suspension. Your company records are kept and will appear as before once the suspension is removed."
        );
      } else {
        const interested =
          (plan ?? subscriptionPlan)?.trim().toLowerCase() === "enterprise";
        setMessage(
          interested
            ? "Your Enterprise activation is still pending and under review by FECSYNC. Contact customer care (admin@fecsync.com) for activation help, or wait for sales / Approve. Once entitled, company admins unlock Enterprise HQ."
            : "Your company activation is still pending and under review. Finish Stripe Checkout if payment is outstanding, or contact customer care (admin@fecsync.com) for activation help. You cannot register a second company with this account."
        );
      }
      return false;
    },
    [queryClient, router, subscriptionPlan]
  );

  const startOnboardingCheckout = useCallback(async () => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/auth/company-onboarding-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ durationMonths }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        data?: { url?: string; alreadyActive?: boolean };
      };
      if (!res.ok) {
        const errMsg =
          json.error || json.message || "Could not start Checkout";
        if (
          errMsg.toLowerCase().includes("already active") ||
          errMsg.toLowerCase().includes("sign in to open")
        ) {
          const slug = user?.organizationSlug?.trim();
          window.location.replace(
            `${slug ? `/signin/${encodeURIComponent(slug)}` : "/signin"}?billing=company_paid&returnTo=%2Fadmin`
          );
          return;
        }
        throw new Error(errMsg);
      }
      if (json.data?.alreadyActive) {
        router.replace("/admin");
        return;
      }
      const url = json.data?.url;
      if (!url || !url.startsWith("http")) {
        throw new Error("Checkout URL missing");
      }
      window.location.href = url;
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Could not start Checkout"
      );
      setCheckoutBusy(false);
    }
  }, [checkoutBusy, durationMonths, router, user?.organizationSlug]);

  const refreshStatus = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setChecking(true);
      try {
        const { user } = await getMe({ force: true });
        setUser(user);
        setInterestPlan(
          user.requestedPlan ?? user.subscriptionPlan ?? null
        );
        if (!durationTouched) {
          setDurationMonths(
            resolveBillingDurationMonthsInterest({
              requestedDurationMonths: user.requestedDurationMonths,
              subscriptionInterval: user.subscriptionInterval,
            })
          );
        }
        applyStatus(
          user.orgStatus,
          user.organizationName ?? user.companyDisplayName,
          user.billingSoftHold === true,
          user.subscriptionStatus ?? null,
          user.billingGraceEndsAt ?? null,
          user.subscriptionPlan ?? null
        );
      } catch {
        // Keep session soft-hold if /me fails — do not hide lifecycle UI.
        applyStatus(
          storedOrgStatus,
          storedOrgName,
          user?.billingSoftHold === true,
          user?.subscriptionStatus ?? null,
          user?.billingGraceEndsAt ?? null,
          user?.subscriptionPlan ?? null
        );
      } finally {
        if (!opts?.quiet) setChecking(false);
      }
    },
    [
      applyStatus,
      durationTouched,
      setUser,
      storedOrgName,
      storedOrgStatus,
      user?.billingSoftHold,
      user?.subscriptionStatus,
      user?.billingGraceEndsAt,
      user?.subscriptionPlan,
    ]
  );

  useEffect(() => {
    // First paint: honor login/session soft-hold before /me returns.
    if (user?.billingSoftHold === true || user?.orgStatus === "suspended") {
      applyStatus(
        user.orgStatus,
        user.organizationName ?? user.companyDisplayName,
        user.billingSoftHold === true,
        user.subscriptionStatus ?? null,
        user.billingGraceEndsAt ?? null,
        user.subscriptionPlan ?? null
      );
    }
  }, [user, applyStatus]);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => {
      void refreshStatus({ quiet: true });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  // When grace countdown hits zero, refresh immediately so Demo demotion applies.
  useEffect(() => {
    if (!billingSoftHold || !billingGraceEndsAt) return;
    const end = new Date(billingGraceEndsAt).getTime();
    if (Number.isNaN(end)) return;
    const ms = end - Date.now();
    if (ms <= 0) {
      void refreshStatus({ quiet: true });
      return;
    }
    const id = window.setTimeout(() => {
      void refreshStatus({ quiet: true });
    }, Math.min(ms + 500, 2_147_000_000));
    return () => window.clearTimeout(id);
  }, [billingSoftHold, billingGraceEndsAt, refreshStatus]);

  useEffect(() => {
    if (!canLifecycle) {
      setOffboardRequestedAt(null);
      return;
    }
    let cancelled = false;
    void getAdminCompanyProfileWithLifecycle()
      .then((bundled) => {
        if (cancelled) return;
        setOffboardRequestedAt(
          bundled.workspaceLifecycle?.offboardRequestedAt ?? null
        );
      })
      .catch(() => {
        /* soft-hold GET may still fail for hard-suspended; export buttons handle errors */
      });
    return () => {
      cancelled = true;
    };
  }, [canLifecycle]);

  const handleExport = async () => {
    if (exportBusy || offboardBusy) return;
    setLifecycleError(null);
    setExportBusy(true);
    try {
      const payload = await downloadCompanyWorkspaceExport();
      saveWorkspaceExportFile(payload);
    } catch (err) {
      setLifecycleError(
        err instanceof Error ? err.message : "Failed to export workspace"
      );
    } finally {
      setExportBusy(false);
    }
  };

  const handleOffboard = async () => {
    if (exportBusy || offboardBusy || offboardRequestedAt) return;
    setLifecycleError(null);
    setOffboardBusy(true);
    const ok = window.confirm(
      "Request workspace offboard? This notifies FECSYNC ops. Orders, payments, and users are not deleted."
    );
    if (!ok) {
      setOffboardBusy(false);
      return;
    }
    try {
      const result = await requestCompanyWorkspaceOffboard();
      setOffboardRequestedAt(result.offboardRequestedAt);
    } catch (err) {
      setLifecycleError(
        err instanceof Error ? err.message : "Failed to request offboard"
      );
    } finally {
      setOffboardBusy(false);
    }
  };

  const startBillingRenew = useCallback(async () => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/auth/company-billing-renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ durationMonths }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        data?: { url?: string };
      };
      if (!res.ok) {
        throw new Error(
          json.error || json.message || "Could not start renewal"
        );
      }
      const url = json.data?.url;
      if (!url || !url.startsWith("http")) {
        throw new Error("Renewal URL missing");
      }
      window.location.href = url;
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Could not start renewal"
      );
      setCheckoutBusy(false);
    }
  }, [checkoutBusy, durationMonths]);

  const demoTrialExpired =
    orgStatus === "suspended" &&
    subscriptionStatus === "expired" &&
    subscriptionPlan?.toLowerCase() === "demo";

  const showPayCta = orgStatus === "pending" && !billingSoftHold;
  const showRenewCta =
    isPlatformAdminActor(user) &&
    !showPayCta &&
    !demoTrialExpired &&
    (billingSoftHold ||
      (orgStatus === "suspended" && subscriptionStatus === "expired"));

  const title = billingSoftHold
    ? companyName
      ? `${companyName} — billing hold`
      : "Billing hold"
    : demoTrialExpired
      ? companyName
        ? `${companyName} — Demo trial ended`
        : "Demo trial ended"
      : orgStatus === "suspended"
        ? companyName
          ? `${companyName} — suspended`
          : "Workspace suspended"
        : companyName
          ? `${companyName} — pending`
          : "Company pending";

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="border-b border-stone-200 bg-white px-4 py-4">
        <FecSyncBrandLogo />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-lg w-full text-center space-y-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[#D4AF37]">
            FECSYNC companies
          </p>
          <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
          <p className="text-stone-600 text-sm leading-relaxed">
            {checking ? "Checking registration status…" : message}
          </p>
          {billingSoftHold && billingGraceEndsAt ? (
            <div className="mx-auto max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-left">
              <BillingGraceCountdown graceEndsAt={billingGraceEndsAt} />
            </div>
          ) : null}
          <p className="text-stone-500 text-sm">
            {billingSoftHold
              ? "Admin tools stay locked until renewal succeeds. Soft-hold does not lock the public platform store. Renew below — when Stripe confirms payment, access unlocks automatically. If grace ends without renewal, your workspace moves to Demo with records kept."
              : demoTrialExpired
                ? "Self-serve renew is locked after Demo ends. Ask FECSYNC to Approve your company with the Demo package again (one more month), then upgrade from Billing. The public platform store stays open."
                : orgStatus === "suspended"
                  ? subscriptionStatus === "ops_hold" ||
                    (subscriptionStatus !== "expired" && !demoTrialExpired)
                    ? "Your account has been suspended. Contact the developers or IT team for further help on how to unlock the suspension. Records stay intact and return when the hold is removed."
                    : "Your workspace is suspended after the plan ended. If this was paid billing expiry, renew below — successful payment reactivates automatically. Ops holds need FECSYNC Approve. The public platform store stays open."
                  : (subscriptionPlan || "").trim().toLowerCase() ===
                      "enterprise"
                    ? "Enterprise does not self-serve Checkout here. Wait for FECSYNC sales / Approve. After entitlement, open Billing or /admin/hq for the HQ multi-venue control plane (park-stamped ticketing follows scope). The public platform store stays open."
                    : "Pay for your selected package in Stripe Checkout. Successful payment automatically activates your company dashboard — FECSYNC does not need to Approve manually. After payment, sign in with the same email and password you used at registration."}
          </p>
          {checkoutError ? (
            <p className="text-sm text-red-700" role="alert">
              {checkoutError}
            </p>
          ) : null}
          {showPayCta || showRenewCta ? (
            <div className="mx-auto flex w-full max-w-sm flex-col items-stretch gap-3">
              <BillingDurationSelect
                id="company-pending-duration"
                planId={
                  interestPlan ||
                  subscriptionPlan ||
                  user?.requestedPlan ||
                  user?.subscriptionPlan
                }
                value={durationMonths}
                onChange={(months) => {
                  setDurationTouched(true);
                  setDurationMonths(months);
                }}
                disabled={checkoutBusy}
              />
              {showPayCta ? (
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => void startOnboardingCheckout()}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030] disabled:opacity-50"
                >
                  {checkoutBusy
                    ? "Opening Checkout…"
                    : "Complete package payment"}
                </button>
              ) : null}
              {showRenewCta ? (
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => void startBillingRenew()}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030] disabled:opacity-50"
                >
                  {checkoutBusy ? "Opening renewal…" : "Renew package now"}
                </button>
              ) : null}
            </div>
          ) : null}
          {canLifecycle ? (
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-4 text-left space-y-3">
              <p className="text-sm font-medium text-stone-900">
                Workspace data
              </p>
              <p className="text-xs text-stone-600">
                Download a redacted JSON export (venues, HQ location preferences,
                marketplace Connect status, booking packages, and marketplace
                bookings), or request soft offboard. Orders, payments, and users
                are never hard-deleted here.
              </p>
              {offboardRequestedAt ? (
                <p className="text-xs text-amber-800">
                  Offboard requested{" "}
                  {new Date(offboardRequestedAt).toLocaleString()}.
                </p>
              ) : null}
              {lifecycleError ? (
                <p className="text-xs text-red-700">{lifecycleError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={exportBusy || offboardBusy}
                  className="px-3 py-1.5 rounded-md border border-stone-300 text-stone-800 text-xs font-medium disabled:opacity-50"
                  onClick={() => void handleExport()}
                >
                  {exportBusy ? "Exporting…" : "Download workspace export"}
                </button>
                <button
                  type="button"
                  disabled={
                    exportBusy || offboardBusy || Boolean(offboardRequestedAt)
                  }
                  className="px-3 py-1.5 rounded-md border border-red-200 bg-red-50 text-red-800 text-xs font-medium disabled:opacity-50"
                  onClick={() => void handleOffboard()}
                >
                  {offboardBusy ? "Requesting…" : "Request offboard"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-stone-900 text-white text-sm"
              onClick={() => void refreshStatus()}
            >
              Refresh status
            </button>
            <Link
              href="/home"
              className="px-4 py-2 rounded-md border border-stone-300 text-stone-800 text-sm"
            >
              Browse store
            </Link>
            <button
              type="button"
              className="px-4 py-2 text-sm text-stone-500 underline"
              onClick={() => {
                clearUserQueries(queryClient);
                void logout();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CompanyPendingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-stone-50 text-sm text-stone-500">
          Loading…
        </div>
      }
    >
      <CompanyPendingInner />
    </Suspense>
  );
}
