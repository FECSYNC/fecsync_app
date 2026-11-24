"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";
import { useAuthStore } from "@/store/authStore";
import { clearCompanyPlanHint } from "@/utils/companyPlanHint";

/**
 * Stripe onboarding success landing.
 * 1) Confirm Checkout session with Stripe (auto-activates pending org)
 * 2) Clear register-time session
 * 3) Send admin to sign in → /admin
 */
function CompanyCheckoutCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const logout = useAuthStore((s) => s.logout);
  const [message, setMessage] = useState("Confirming your payment…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      clearCompanyPlanHint();
      const sessionId = searchParams.get("session_id")?.trim() || "";
      const emailHint = searchParams.get("email")?.trim() || "";

      if (!sessionId) {
        setError(
          "Missing Checkout session. If you paid, wait a moment then sign in — activation may still complete via Stripe webhook."
        );
        setMessage("Could not confirm payment from this link.");
        return;
      }

      try {
        setMessage("Verifying payment with Stripe…");
        const res = await fetch("/api/auth/company-onboarding-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ sessionId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          data?: {
            orgStatus?: string;
            activated?: boolean;
            email?: string | null;
            plan?: string | null;
            orgSlug?: string | null;
          };
        };
        if (!res.ok) {
          throw new Error(
            json.error || json.message || "Payment confirmation failed"
          );
        }
        if (cancelled) return;
        const email =
          (typeof json.data?.email === "string" && json.data.email) ||
          emailHint;
        setMessage(
          json.data?.activated
            ? "Payment confirmed — workspace activated."
            : "Payment confirmed."
        );
        try {
          await logout();
        } catch {
          /* continue */
        }
        if (cancelled) return;
        const qs = new URLSearchParams();
        if (email) qs.set("email", email);
        qs.set("billing", "company_paid");
        qs.set("returnTo", "/admin");
        const slug = json.data?.orgSlug?.trim();
        // A cross-host hop when subdomains are on, so leave the client router.
        window.location.replace(
          `${slug ? `/signin/${encodeURIComponent(slug)}` : "/signin"}?${qs.toString()}`
        );
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Payment confirmation failed";
        setError(msg);
        setMessage("We could not confirm payment yet.");
        // Still offer sign-in — webhook may activate shortly.
        try {
          await logout();
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logout, router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6">
      <FecSyncBrandLogo size="lg" variant="onLight" href="/home" />
      {!error ? (
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
      ) : null}
      <p className="text-sm text-stone-600">{message}</p>
      {error ? (
        <div className="max-w-md space-y-3 text-center">
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
          <a
            href={`/signin?billing=company_paid&returnTo=${encodeURIComponent("/admin")}${
              searchParams.get("email")
                ? `&email=${encodeURIComponent(searchParams.get("email") || "")}`
                : ""
            }`}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900"
          >
            Continue to sign in
          </a>
          <a
            href="/company-pending"
            className="block text-sm text-stone-500 underline"
          >
            Waiting room / resume payment
          </a>
        </div>
      ) : null}
    </div>
  );
}

export default function CompanyCheckoutCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
        </div>
      }
    >
      <CompanyCheckoutCompleteInner />
    </Suspense>
  );
}
