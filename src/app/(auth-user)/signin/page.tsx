"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import AuthForm from "@/components/Public_C/auth/auth_form";
import GoogleLoginButton from "@/components/Public_C/auth/google_login_button";
import useAuthHandlers from "@/hooks/use-auth-handlers";
import CompanyAccountStatusPanel, {
  companyAccountSnapshotFromUser,
} from "@/components/billing/CompanyAccountStatusPanel";
import { consumeAdminIdleLogoutNotice } from "@/lib/adminIdleTimeout";

/** Warm auth API chunks while the user types — avoids 60–90s first-login compile. */
function useWarmAuthApis() {
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // Compiles shared auth/prisma path without requiring credentials.
      void fetch("/api/auth/me", { credentials: "include" }).catch(() => {});
      // Compiles /api/auth/login itself (empty body → fast 400 after compile).
      void fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      // Do NOT warm /api/auth/refresh here — a raw POST bypasses single-flight and
      // can rotate/reuse JTIs while AdminLayout is still proving the session.
    };
    // Idle so first paint isn't blocked.
    const t = window.setTimeout(warm, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);
}

export default function SigninScreen() {
  useWarmAuthApis();
  const {
    formData,
    authState,
    justVerified,
    companyStatusUser,
    continueAfterCompanyStatus,
    handleChange,
    handleEmailLogin,
    handleGoogleLogin,
  } = useAuthHandlers();

  const [idleSignedOut, setIdleSignedOut] = useState(false);
  const [movedHere, setMovedHere] = useState(false);
  useEffect(() => {
    // Clear admin-gate escape latch so a successful login is not bounced.
    try {
      sessionStorage.removeItem("admin-gate-escaping");
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    const fromFlag = consumeAdminIdleLogoutNotice();
    if (params.get("reason") === "idle" || fromFlag) setIdleSignedOut(true);
    if (params.get("notice") === "platform") setMovedHere(true);
  }, []);

  const isFormDisabled = authState.isLoading || authState.isRedirecting;
  if (authState.isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-[#D4AF37]"
            aria-hidden
          />
          <p className="text-sm text-stone-600">Opening your dashboard…</p>
        </div>
      </div>
    );
  }
  const isGoogleDisabled =
    authState.isGoogleLoading || authState.isRedirecting;
  const showCompanyStatus = Boolean(companyStatusUser);

  return (
    <div className="flex min-h-screen bg-white">
      <div className="hidden lg:flex lg:flex-1 relative">
        <Image
          src="/venueflow/img/hero.jpg"
          alt="Guests at a thriving event park"
          fill
          priority
          sizes="50vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/30 to-black/30" />
        <div className="absolute bottom-8 left-8 text-white/80">
          <p className="text-sm">Secure sign-in portal</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 bg-white lg:px-8 py-8 md:py-0 min-h-screen">
        <div className="w-full max-w-md space-y-6">
          <Link
            href="/home"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-[#1DB8A0] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>

          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {showCompanyStatus ? "Company account status" : "Sign in"}
            </h1>
            <p className="text-sm text-gray-600">
              {showCompanyStatus
                ? "Live update from your workspace — review before opening the dashboard."
                : justVerified
                  ? "Your email is verified. Sign in to continue."
                  : "Enter your work email to continue to your company workspace"}
            </p>
          </div>

          {movedHere && !showCompanyStatus ? (
            <div
              role="status"
              className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800"
            >
              This account signs in on the shared portal rather than a company
              page. Enter your password again to continue.
            </div>
          ) : null}

          {idleSignedOut && !showCompanyStatus ? (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              Your session ended after 30 minutes of inactivity. Sign in
              again to continue.
            </div>
          ) : null}

          {showCompanyStatus && companyStatusUser ? (
            <CompanyAccountStatusPanel
              initial={companyAccountSnapshotFromUser(companyStatusUser)}
              onContinue={continueAfterCompanyStatus}
              continueLabel={
                companyStatusUser.orgStatus === "pending"
                  ? "Continue to waiting room"
                  : "Continue to dashboard"
              }
            />
          ) : (
            <>
              <AuthForm
                formData={formData}
                onChange={handleChange}
                onSubmit={handleEmailLogin}
                isDisabled={isFormDisabled}
                isLoading={authState.isLoading}
              />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">
                    Or continue with
                  </span>
                </div>
              </div>

              <GoogleLoginButton
                onClick={handleGoogleLogin}
                isLoading={authState.isGoogleLoading}
                disabled={isGoogleDisabled}
              />

              <div className="text-center text-sm text-gray-600 space-y-2">
                <p>
                  Don&apos;t have a company workspace?{" "}
                  <Link
                    href="/register-company"
                    className="text-[#D4AF37] font-medium hover:underline"
                  >
                    Register your company
                  </Link>
                </p>
              </div>

              <Link
                href="/home"
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-800 hover:border-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Continue without signing in
              </Link>
            </>
          )}

          <div className="text-center text-xs text-gray-500 mt-6 md:mt-0">
            By signing in, you agree to our{" "}
            <Link
              href="/terms"
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              Terms of Service
            </Link>{" "}
            &{" "}
            <Link
              href="/privacy"
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
