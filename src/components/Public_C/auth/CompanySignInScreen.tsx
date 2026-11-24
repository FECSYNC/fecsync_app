"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Globe, Loader2, Mail, Phone } from "lucide-react";
import AuthForm from "@/components/Public_C/auth/auth_form";
import CompanySignInHero, {
  CompanyMark,
  CompanySignInBackdrop,
  NEUTRAL_ACCENT,
} from "@/components/Public_C/auth/CompanySignInHero";
import GoogleLoginButton from "@/components/Public_C/auth/google_login_button";
import useAuthHandlers from "@/hooks/use-auth-handlers";
import CompanyAccountStatusPanel, {
  companyAccountSnapshotFromUser,
} from "@/components/billing/CompanyAccountStatusPanel";
import { consumeAdminIdleLogoutNotice } from "@/lib/adminIdleTimeout";

export type CompanySignInBrand = {
  slug: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  backgroundUrl: string | null;
  phone: string | null;
  supportEmail: string | null;
  website: string | null;
};

function ForgotPasswordPanel({
  accent,
  initialEmail,
  onBack,
}: {
  accent: string;
  initialEmail: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(
        res.status === 404
          ? "We couldn't find an account with that email."
          : data?.message || "We couldn't send the reset email. Try again shortly."
      );
    } catch {
      setError("We couldn't send the reset email. Try again shortly.");
    }
    setState("idle");
  };

  if (state === "sent") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-700">
          Check <strong>{email.trim()}</strong> for a password reset link. It is valid for 1 hour.
        </p>
        <button type="button" onClick={onBack} className="text-sm font-medium hover:underline" style={{ color: accent }}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-600">
        Enter your work email and we&apos;ll send you a link to reset your password.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError("");
        }}
        placeholder="Email"
        autoComplete="email"
        required
        disabled={state === "sending"}
        className="w-full rounded-lg bg-[#F2F2F2] px-4 py-3 text-gray-700 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="flex w-full items-center justify-center rounded-full px-4 py-3.5 font-semibold text-white shadow-md hover:brightness-95 disabled:opacity-70"
        style={{ backgroundColor: accent }}
      >
        {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send reset link"}
      </button>
      <button type="button" onClick={onBack} className="w-full text-sm text-gray-600 hover:underline">
        Back to sign in
      </button>
    </form>
  );
}

/** A company's own staff sign-in page — shows only that company's identity. */
export default function CompanySignInScreen({ brand }: { brand: CompanySignInBrand }) {
  const accent = brand.accentColor ?? NEUTRAL_ACCENT;
  const {
    formData,
    authState,
    justVerified,
    companyStatusUser,
    continueAfterCompanyStatus,
    handleChange,
    handleEmailLogin,
    handleGoogleLogin,
  } = useAuthHandlers({ companySlug: brand.slug });
  const [forgotOpen, setForgotOpen] = useState(false);
  const [movedHere, setMovedHere] = useState(false);
  const [idleSignedOut, setIdleSignedOut] = useState(false);
  useEffect(() => {
    // Same as platform /signin — drop escape latch so a prior false logout
    // cannot immediately bounce the next successful company login.
    try {
      sessionStorage.removeItem("admin-gate-escaping");
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("notice") === "company") setMovedHere(true);
    const fromFlag = consumeAdminIdleLogoutNotice();
    if (params.get("reason") === "idle" || fromFlag) setIdleSignedOut(true);
  }, []);

  if (authState.isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200"
            style={{ borderTopColor: accent }}
            aria-hidden
          />
          <p className="text-sm text-stone-600">Opening {brand.name}…</p>
        </div>
      </div>
    );
  }

  const isFormDisabled = authState.isLoading || authState.isRedirecting;
  const showCompanyStatus = Boolean(companyStatusUser);
  const hasContact = Boolean(brand.supportEmail || brand.phone || brand.website);

  return (
    <div className="flex min-h-screen bg-white">
      <CompanySignInHero brand={brand} className="hidden flex-1 lg:flex" />

      <div className="flex min-h-screen flex-1 items-center justify-center bg-white px-6 py-8 lg:px-8">
        <div className="w-full max-w-md space-y-6">
          {/* Plain <a>: on a company subdomain the proxy sends /home to the root host. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/home"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 transition-colors hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to home
          </a>

          <div className="flex flex-col items-center gap-3 text-center">
            {brand.backgroundUrl ? (
              <>
                <div
                  className="relative isolate flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl shadow-sm lg:hidden"
                  style={{ backgroundColor: accent }}
                >
                  <CompanySignInBackdrop backgroundUrl={brand.backgroundUrl} accent={accent} />
                  <CompanyMark brand={brand} size={56} />
                </div>
                <div className="hidden lg:block">
                  <CompanyMark brand={brand} size={64} />
                </div>
              </>
            ) : (
              <CompanyMark brand={brand} size={64} />
            )}
            <p className="text-lg font-semibold text-gray-900">{brand.name}</p>
          </div>

          <div className="text-center">
            <h1 className="mb-2 text-3xl font-bold text-gray-900">
              {showCompanyStatus
                ? "Company account status"
                : forgotOpen
                  ? "Reset your password"
                  : "Staff sign in"}
            </h1>
            {!showCompanyStatus && !forgotOpen ? (
              <p className="text-sm text-gray-600">
                {justVerified
                  ? "Your email is verified. Sign in to continue."
                  : `Sign in to your ${brand.name} account`}
              </p>
            ) : null}
          </div>

          {movedHere && !showCompanyStatus ? (
            <div
              role="status"
              className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800"
            >
              This is {brand.name}&apos;s own sign-in page. Enter your password again to continue,
              and bookmark this page for next time.
            </div>
          ) : null}

          {idleSignedOut && !showCompanyStatus ? (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              Your session ended after 30 minutes of inactivity. Sign in again to continue.
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
          ) : forgotOpen ? (
            <ForgotPasswordPanel
              accent={accent}
              initialEmail={formData.email}
              onBack={() => setForgotOpen(false)}
            />
          ) : (
            <>
              <AuthForm
                formData={formData}
                onChange={handleChange}
                onSubmit={handleEmailLogin}
                isDisabled={isFormDisabled}
                isLoading={authState.isLoading}
                accentColor={accent}
                onForgotPassword={() => setForgotOpen(true)}
              />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-2 text-gray-500">Or continue with</span>
                </div>
              </div>

              <GoogleLoginButton
                onClick={handleGoogleLogin}
                isLoading={authState.isGoogleLoading}
                disabled={authState.isGoogleLoading || authState.isRedirecting}
              />
            </>
          )}

          {hasContact ? (
            <div className="space-y-2 border-t border-gray-100 pt-5 text-sm text-gray-600">
              <p className="text-center font-medium text-gray-700">Need help signing in?</p>
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {brand.supportEmail ? (
                  <a href={`mailto:${brand.supportEmail}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Mail className="h-4 w-4" aria-hidden />
                    {brand.supportEmail}
                  </a>
                ) : null}
                {brand.phone ? (
                  <a href={`tel:${brand.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Phone className="h-4 w-4" aria-hidden />
                    {brand.phone}
                  </a>
                ) : null}
                {brand.website ? (
                  <a
                    href={brand.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:underline"
                  >
                    <Globe className="h-4 w-4" aria-hidden />
                    Website
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
