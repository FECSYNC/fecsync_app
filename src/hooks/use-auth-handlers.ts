"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  sanitizeAuthReturnTo,
  defaultPathForSession,
  persistAuthReturnTo,
  rememberCompanySignIn,
} from "@/utils/authRedirect";
import { useAuthStore } from "@/store/authStore";
import { releaseIdleLogoutLatch, touchAdminLastActivity } from "@/lib/adminIdleTimeout";
import {
  loginWithEmail,
  getMe,
  GOOGLE_OAUTH_URL,
  normalizeSessionUser,
  isStorefrontOrgSession,
  type UserProfile,
} from "@/services/auth";
import { useToast } from "@/contexts/toast-context";
import {
  isRolePresetId,
  isStaffPreset,
} from "@/lib/auth/permissions";
import { sessionIsStaff } from "@/lib/auth/session";
import { isPlatformSoftwareOwner } from "@/lib/platformSoftwareOwner";
import { browserPublicOrigin } from "@/lib/tenantDomain";
import { USE_COMPANY_SIGNIN_CODE, USE_PLATFORM_SIGNIN_CODE } from "@/lib/companyLoginCodes";

interface FormData {
  email: string;
  password: string;
  rememberMe: boolean;
  fullName?: string;
}

function readSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** Registered company admins only — never FECSYNC storefront / software-owner super admin. */
function shouldShowCompanyStatus(user: UserProfile): boolean {
  if (isPlatformSoftwareOwner(user) || isStorefrontOrgSession(user)) {
    return false;
  }
  const preset =
    typeof user.preset === "string" && isRolePresetId(user.preset)
      ? user.preset
      : null;
  if (!preset || !isStaffPreset(preset)) return false;
  const orgStatus = (user.orgStatus || "").trim().toLowerCase();
  return (
    orgStatus === "pending" ||
    orgStatus === "active" ||
    orgStatus === "suspended" ||
    user.billingSoftHold === true
  );
}

/**
 * Auth form handlers for /signin and company sign-in pages (`companySlug`).
 * Reads query params from window (not useSearchParams) so the page does not
 * suspend behind Suspense fallback={null} and paint blank white.
 */
export default function useAuthHandlers(options?: { companySlug?: string | null }) {
  const companySlug = options?.companySlug?.trim() || null;
  const router = useRouter();
  const { setEmailForVerification, setUser } = useAuthStore();
  const { addToast } = useToast();

  const [formData, setFormData] = useState<FormData>({
    email: "",
    password: "",
    rememberMe: false,
    fullName: "",
  });

  const [justVerified, setJustVerified] = useState(false);

  const [authState, setAuthState] = useState({
    isLoading: false,
    isGoogleLoading: false,
    isRedirecting: false,
  });

  /** After company login: show live status + timer before leaving /signin. */
  const [companyStatusUser, setCompanyStatusUser] =
    useState<UserProfile | null>(null);
  const [pendingDestination, setPendingDestination] = useState<string | null>(
    null
  );

  // One-shot query handling on mount — keeps first paint instant.
  useEffect(() => {
    const params = readSearchParams();
    persistAuthReturnTo(params.get("returnTo"));

    const emailParam = params.get("email");
    if (emailParam) {
      setFormData((prev) =>
        prev.email ? prev : { ...prev, email: emailParam }
      );
    }

    const error = params.get("error");
    const verified = params.get("verified");
    const registered = params.get("registered");
    const billing = params.get("billing");

    if (verified === "1") {
      setJustVerified(true);
      addToast("Email verified successfully. Please log in.", "success");
      params.delete("verified");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`
      );
      return;
    }
    if (billing === "company_paid") {
      addToast(
        "Payment received. Sign in with your company admin email to open your dashboard.",
        "success"
      );
      params.delete("billing");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`
      );
      return;
    }
    if (registered === "1") {
      addToast("Account created. Verify your email, then log in.", "success");
      params.delete("registered");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`
      );
      return;
    }
    if (!error) return;
    if (error === "AccountBlocked") {
      addToast(
        "This email or phone number is blocked from creating or accessing an account",
        "error"
      );
    } else if (error === "AccountSuspended") {
      addToast(
        "Your account has been suspended. Contact the developers or IT team for further help on how to unlock the suspension.",
        "error"
      );
    } else if (error === "AccountDeleted") {
      addToast("This account is no longer available.", "error");
    } else if (
      error === "NoCode" ||
      error === "TokenExchangeFailed" ||
      error === "NoProfile"
    ) {
      addToast("Google authentication failed. Please try again.", "error");
    }
  }, [addToast]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, type, value, checked } = e.target;
      setFormData((prev) => ({
        ...prev,
        [name]: type === "checkbox" ? checked : value,
      }));
    },
    []
  );

  const handleAuthSuccess = useCallback(
    async (userData: any, remember: boolean) => {
      const user = normalizeSessionUser({
        id: userData?.id || "local",
        email: userData?.email || formData.email,
        fullName:
          userData?.fullName ||
          userData?.name ||
          formData.fullName ||
          undefined,
        name:
          userData?.name ||
          userData?.fullName ||
          formData.fullName ||
          undefined,
        role: userData?.role || "user",
        avatar: userData?.avatar || userData?.picture || undefined,
        permissions: userData?.permissions,
        orgId: userData?.orgId ?? null,
        membershipRole: userData?.membershipRole ?? null,
        preset: userData?.preset ?? null,
        companyWideView: userData?.companyWideView,
        storefrontOrgId: userData?.storefrontOrgId ?? null,
        orgStatus:
          userData?.orgStatus ?? userData?.organization?.status ?? null,
        organizationName:
          userData?.organizationName ?? userData?.organization?.name ?? null,
        companyDisplayName:
          userData?.companyDisplayName ??
          userData?.organization?.companyDisplayName ??
          null,
        legalName:
          userData?.legalName ?? userData?.organization?.legalName ?? null,
        tradingName:
          userData?.tradingName ??
          userData?.organization?.tradingName ??
          null,
        profileCompleteness:
          userData?.profileCompleteness ??
          userData?.organization?.profileCompleteness ??
          null,
        hasLogo:
          typeof userData?.hasLogo === "boolean"
            ? userData.hasLogo
            : typeof userData?.organization?.hasLogo === "boolean"
              ? userData.organization.hasLogo
              : undefined,
        companyLogoUrl:
          userData?.companyLogoUrl ?? userData?.organization?.logoUrl ?? null,
        organizationSlug:
          userData?.organizationSlug ?? userData?.organization?.slug ?? null,
        subscriptionPlan:
          userData?.subscriptionPlan ??
          userData?.organization?.subscriptionPlan ??
          null,
        subscriptionStatus:
          userData?.subscriptionStatus ??
          userData?.organization?.subscriptionStatus ??
          null,
        subscriptionEndsAt:
          userData?.subscriptionEndsAt ??
          userData?.organization?.subscriptionEndsAt ??
          null,
        billingSoftHold:
          userData?.billingSoftHold === true ||
          userData?.organization?.billingSoftHold === true,
        billingGraceEndsAt:
          userData?.billingGraceEndsAt ??
          userData?.organization?.billingGraceEndsAt ??
          null,
        enterpriseHqEnabled:
          userData?.enterpriseHqEnabled === true ||
          userData?.organization?.enterpriseHqEnabled === true,
        accountSuspended: userData?.accountSuspended === true,
      });

      releaseIdleLogoutLatch();
      touchAdminLastActivity();
      // Clear admin-gate escape latch — company sign-in never hit /signin/page
      // which used to leave this set and immediately bounce a fresh login.
      try {
        sessionStorage.removeItem("admin-gate-escaping");
      } catch {
        /* ignore */
      }
      rememberCompanySignIn(companySlug);
      setUser(user, remember ? "localStorage" : "sessionStorage");
      localStorage.setItem(
        "auth-snapshot",
        JSON.stringify({ user, isAuthenticated: true })
      );

      const storedReturnTo = sessionStorage.getItem("authReturnTo");
      sessionStorage.removeItem("authReturnTo");
      const safeReturnTo = sanitizeAuthReturnTo(storedReturnTo, user);
      const home = defaultPathForSession(user);
      // Staff always land on the dashboard. A leftover returnTo (for example
      // a waiver page) kept the sign-in screen up while that page compiled.
      const destination = sessionIsStaff(user)
        ? home
        : (safeReturnTo ?? home);

      addToast("Login successful.", "success");
      setAuthState({
        isLoading: false,
        isGoogleLoading: false,
        isRedirecting: true,
      });
      // Leave the sign-in screen in this click. A full document load kept the
      // form on screen until the dashboard finished compiling.
      router.push(destination);
    },
    [formData, setUser, addToast, router, companySlug]
  );

  const continueAfterCompanyStatus = useCallback(() => {
    const dest = pendingDestination || defaultPathForSession(companyStatusUser);
    setAuthState((s) => ({ ...s, isRedirecting: true }));
    router.push(dest);
  }, [pendingDestination, companyStatusUser, router]);

  /**
   * The server proved the credentials and named where this account belongs:
   * its company's own page, or the platform page. Keeps email + returnTo only.
   * Root-host URLs: on a company subdomain every /signin path is that company's page.
   */
  const goToHomeSignIn = useCallback(
    (target: { companySlug: string } | "platform") => {
      const current = new URLSearchParams(window.location.search);
      const params = new URLSearchParams();
      if (target !== "platform") {
        for (const key of ["returnTo", "billing"]) {
          const value = current.get(key);
          if (value) params.set(key, value);
        }
      }
      const email = formData.email.trim().toLowerCase();
      if (email) params.set("email", email);
      const base = browserPublicOrigin() || window.location.origin;
      let path: string;
      if (target === "platform") {
        rememberCompanySignIn(null);
        params.set("notice", "platform");
        path = "/signin";
      } else {
        params.set("notice", "company");
        path = `/signin/${encodeURIComponent(target.companySlug)}`;
      }
      setAuthState({ isLoading: false, isGoogleLoading: false, isRedirecting: true });
      window.location.assign(`${base}${path}?${params.toString()}`);
    },
    [formData.email]
  );

  /** True when the server's reply says this account signs in somewhere else (and we went there). */
  const redirectToHomeSignIn = useCallback(
    (payload: { code?: unknown; companySlug?: unknown } | null | undefined): boolean => {
      if (payload?.code === USE_COMPANY_SIGNIN_CODE) {
        const slug = typeof payload.companySlug === "string" ? payload.companySlug.trim() : "";
        if (!slug || slug === companySlug) return false;
        goToHomeSignIn({ companySlug: slug });
        return true;
      }
      if (payload?.code === USE_PLATFORM_SIGNIN_CODE && companySlug) {
        goToHomeSignIn("platform");
        return true;
      }
      return false;
    },
    [companySlug, goToHomeSignIn]
  );

  const handleAuthError = useCallback(
    (error: any, isGoogle = false) => {
      if (redirectToHomeSignIn(error?.payload)) return;
      let msg =
        error?.message ||
        error?.error ||
        "Something went wrong. Please try again.";

      if (isGoogle) {
        msg = "Google authentication failed. Please try again.";
      } else if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("not verified")
      ) {
        setEmailForVerification(formData.email);
        const emailQs = formData.email
          ? `?email=${encodeURIComponent(formData.email.trim().toLowerCase())}`
          : "";
        router.push(`/verify-email${emailQs}`);
        addToast("Please verify your email before logging in.", "error");
        setAuthState({
          isLoading: false,
          isGoogleLoading: false,
          isRedirecting: false,
        });
        return;
      } else if (
        typeof msg === "string" &&
        (msg.toLowerCase().includes("database temporarily unavailable") ||
          msg.toLowerCase() === "login failed")
      ) {
        msg =
          "Sign-in is temporarily unavailable (database connection). Please wait a few seconds and try again.";
      }

      setAuthState({
        isLoading: false,
        isGoogleLoading: false,
        isRedirecting: false,
      });

      addToast(msg, "error");
    },
    [formData.email, router, setEmailForVerification, addToast, redirectToHomeSignIn]
  );

  const handleEmailLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData.email || !formData.password) {
        addToast("Please fill in all required fields.", "error");
        return;
      }

      setAuthState((prev) => ({ ...prev, isLoading: true }));

      try {
        const { user } = await loginWithEmail({
          email: formData.email,
          password: formData.password,
          companySlug,
        });
        await handleAuthSuccess(user, formData.rememberMe);
      } catch (err: any) {
        handleAuthError(err);
      }
    },
    [formData, handleAuthError, handleAuthSuccess, addToast, companySlug]
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Google's callback runs on the root host; company sign-in may be on a subdomain.
      if (event.origin !== window.origin && event.origin !== browserPublicOrigin()) return;
      const { type, status, user: oauthUser, message, code, companySlug: home } = event.data || {};
      if (type === "oauth" && status === "error" && redirectToHomeSignIn({ code, companySlug: home })) {
        return;
      }
      if (type === "oauth" && status === "error") {
        setAuthState({ isLoading: false, isGoogleLoading: false, isRedirecting: false });
        addToast(
          typeof message === "string" && message ? message : "Google sign-in failed.",
          "error"
        );
        return;
      }
      if (type === "oauth" && status === "success") {
        getMe()
          .then(({ user }) => {
            const mergedUser = {
              ...user,
              avatar: user?.avatar || oauthUser?.picture,
              name: user?.name || oauthUser?.name,
              fullName: user?.fullName || oauthUser?.name,
              email: user?.email || oauthUser?.email,
            };
            return handleAuthSuccess(mergedUser, true);
          })
          .catch(() =>
            handleAuthError(
              { message: "Google login failed or was cancelled." },
              true
            )
          );
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleAuthSuccess, handleAuthError, addToast, redirectToHomeSignIn]);

  const handleGoogleLogin = useCallback(() => {
    setAuthState((prev) => ({
      ...prev,
      isGoogleLoading: true,
    }));

    // Start on the root host so the OAuth state cookie reaches GOOGLE_CALLBACK_URL.
    const oauthUrl = companySlug
      ? `${browserPublicOrigin()}${GOOGLE_OAUTH_URL}?company=${encodeURIComponent(companySlug)}`
      : GOOGLE_OAUTH_URL;
    const popup = window.open(
      oauthUrl,
      "google-oauth",
      "width=500,height=600,scrollbars=yes,resizable=yes"
    );

    if (!popup) {
      handleAuthError(
        { message: "Popup blocked. Enable popups and try again." },
        true
      );
    }
  }, [handleAuthError, companySlug]);

  return {
    formData,
    authState,
    justVerified,
    companyStatusUser,
    continueAfterCompanyStatus,
    handleChange,
    handleEmailLogin,
    handleGoogleLogin,
  };
}
