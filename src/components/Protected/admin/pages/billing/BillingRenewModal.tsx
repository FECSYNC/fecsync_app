"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { isPlatformAdminActor } from "@/lib/auth/permissions";
import { isStorefrontOrgSession } from "@/services/auth";
import { useBillingStateQuery } from "@/hooks/useBilling";
import { isWithinBillingRenewWindow } from "@/lib/billingRenewal";
import { P } from "@/lib/auth/permissions";
import BillingDurationSelect from "@/components/billing/BillingDurationSelect";
import {
  resolveBillingDurationMonthsInterest,
  type BillingDurationMonths,
} from "@/lib/subscriptionPlans";

function dismissKey(orgId: string, endsAt: string | null | undefined) {
  return `billing-renew-modal:${orgId}:${endsAt || "none"}`;
}

/**
 * Auto renew popup for company admins when period end is within 14 days.
 * Opens Stripe Portal/Checkout via /api/auth/company-billing-renew.
 */
export default function BillingRenewModal() {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const isCompany =
    Boolean(user?.orgId) && !isStorefrontOrgSession(user);
  const canSee = isCompany && can(P.BillingManage);
  const canPay = canSee && isPlatformAdminActor(user);
  const billing = useBillingStateQuery(canSee);
  const state = billing.data;

  const show =
    canSee &&
    Boolean(state?.billingEntitled) &&
    !state?.billingSoftHold &&
    isWithinBillingRenewWindow(state?.daysUntilRenewal);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durationMonths, setDurationMonths] = useState<BillingDurationMonths>(
    resolveBillingDurationMonthsInterest({
      requestedDurationMonths: state?.requestedDurationMonths,
      subscriptionInterval: state?.subscriptionInterval,
    })
  );

  useEffect(() => {
    setDurationMonths(
      resolveBillingDurationMonthsInterest({
        requestedDurationMonths: state?.requestedDurationMonths,
        subscriptionInterval: state?.subscriptionInterval,
      })
    );
  }, [state?.requestedDurationMonths, state?.subscriptionInterval]);

  useEffect(() => {
    if (!show || !user?.orgId) {
      setOpen(false);
      return;
    }
    try {
      const key = dismissKey(user.orgId, state?.subscriptionEndsAt);
      if (sessionStorage.getItem(key) === "1") {
        setOpen(false);
        return;
      }
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, [show, user?.orgId, state?.subscriptionEndsAt]);

  const dismiss = useCallback(() => {
    if (user?.orgId) {
      try {
        sessionStorage.setItem(
          dismissKey(user.orgId, state?.subscriptionEndsAt),
          "1"
        );
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  }, [user?.orgId, state?.subscriptionEndsAt]);

  const renew = useCallback(async () => {
    if (!canPay || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/company-billing-renew", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMonths }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        data?: { url?: string };
      };
      if (!res.ok) {
        throw new Error(json.error || json.message || "Could not start renewal");
      }
      const url = json.data?.url;
      if (!url || !url.startsWith("http")) {
        throw new Error("Renewal URL missing");
      }
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start renewal");
      setBusy(false);
    }
  }, [busy, canPay, durationMonths]);

  if (!open || !show) return null;

  const days = state?.daysUntilRenewal;
  const planId = state?.plan || null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-renew-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#D4AF37]/40 bg-white p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.18em] text-[#D4AF37]">
          Automatic renewal reminder
        </p>
        <h2
          id="billing-renew-title"
          className="mt-2 text-xl font-semibold text-stone-900"
        >
          {days === 0
            ? "Your package ends today"
            : days === 1
              ? "Your package ends tomorrow"
              : `Your package ends in ${days} days`}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          Renew now to keep venues, catalog, and team tools unlocked. If the
          period ends without renewal, the system suspends the workspace
          automatically until payment succeeds again.
        </p>
        {canPay ? (
          <div className="mt-4">
            <BillingDurationSelect
              id="billing-renew-modal-duration"
              planId={planId}
              value={durationMonths}
              onChange={setDurationMonths}
              disabled={busy}
            />
          </div>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Remind me later
          </button>
          {canPay ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void renew()}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 hover:bg-[#c4a030] disabled:opacity-50"
            >
              {busy ? "Opening…" : "Renew package"}
            </button>
          ) : (
            <a
              href="/admin/billing"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 hover:bg-[#c4a030]"
            >
              View billing
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
