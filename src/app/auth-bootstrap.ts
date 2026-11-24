"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  AUTH_LOGOUT_BROADCAST_KEY,
  clearPersistedAuthStorage,
  peekAuthSnapshotUser,
  seedAuthStoreFromSnapshot,
  useAuthStore,
} from "@/store/authStore";
import { getAppQueryClient } from "@/lib/appQueryClient";
import { reconcileClientAuthSession } from "@/lib/clientSync";
import { clearUserQueries } from "@/utils/clearUserQueries";
import { invalidateOrgSaasQueries } from "@/utils/invalidateOrgSaasQueries";
import {
  orgBillingFingerprint,
  orgProfileFingerprint,
} from "@/utils/orgSaasSessionSync";
import { useAdminIdleLogout } from "@/hooks/useAdminIdleLogout";
import {
  isIdleLogoutLatched,
  isSessionIdleExpired,
} from "@/lib/adminIdleTimeout";
import { classifyPageRoute } from "@/lib/auth/routePolicy";
import { currentReturnTo, signInHref } from "@/utils/authRedirect";
import { useToast } from "@/contexts/toast-context";

let idleBootNoticeSent = false;

export default function AuthBootstrap() {
  const router = useRouter();
  const { addToast } = useToast();
  const hasClientHydrated = useAuthStore((s) => s.hasClientHydrated);
  const hasHydratedAuth = useAuthStore((s) => s.hasHydratedAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const silentRefresh = useAuthStore((s) => s.silentRefresh);
  const hydrateFromCookie = useAuthStore((s) => s.hydrateFromCookie);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const billingFp = useAuthStore((s) => orgBillingFingerprint(s.user));
  const profileFp = useAuthStore((s) => orgProfileFingerprint(s.user));

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusAuthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrateStartedRef = useRef(false);
  const lastBillingFpRef = useRef<string | null>(null);
  const lastProfileFpRef = useRef<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const lastOrgIdRef = useRef<string | null>(null);

  // Homepage included: 30 minutes without real activity signs the session out,
  // including time the computer was shut down.
  useAdminIdleLogout(Boolean(user && isAuthenticated && hasHydratedAuth));

  // Cold start already cleared the store before paint. Leave protected pages,
  // and refresh public pages so the header drops the saved account chip.
  useEffect(() => {
    if (!isIdleLogoutLatched() || idleBootNoticeSent) return;
    idleBootNoticeSent = true;
    const path = window.location.pathname || "/";
    const gate = classifyPageRoute(path);
    const leave = gate === "staff" || gate === "tailor" || gate === "client";
    if (leave) {
      router.replace(`${signInHref(currentReturnTo(path))}&reason=idle`);
      return;
    }
    if (path === "/signin" || path.startsWith("/signin/")) return;
    addToast(
      "You were signed out after 30 minutes of inactivity. Please sign in again.",
      "info"
    );
    void (async () => {
      await logout();
      router.refresh();
    })();
  }, [addToast, logout, router]);

  // Hard refresh: paint from auth-snapshot before effects that wait on Zustand persist.
  useLayoutEffect(() => {
    if (isIdleLogoutLatched() || isSessionIdleExpired()) return;
    const seeded = seedAuthStoreFromSnapshot();
    // Always re-verify cookies in background when we have an optimistic session.
    if (seeded || useAuthStore.getState().user) {
      void hydrateFromCookie();
    }
  }, [hydrateFromCookie]);

  // Re-verify session when returning to the tab (pairs with ClientSyncBootstrap focus).
  useEffect(() => {
    const onFocus = () => {
      if (focusAuthTimerRef.current) clearTimeout(focusAuthTimerRef.current);
      focusAuthTimerRef.current = setTimeout(() => {
        reconcileClientAuthSession();
      }, 800);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (focusAuthTimerRef.current) clearTimeout(focusAuthTimerRef.current);
    };
  }, []);

  // Sync logout across browser tabs (admin tab vs storefront tab).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_LOGOUT_BROADCAST_KEY) return;
      clearPersistedAuthStorage({ broadcast: false });
      clearAuth();
      try {
        void import("@/store/cartStore").then(({ useCartStore }) => {
          useCartStore.getState().clearCart();
        });
      } catch {
        /* ignore */
      }
      const qc = getAppQueryClient();
      if (qc) clearUserQueries(qc);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearAuth]);

  useEffect(() => {
    const prev = lastUserIdRef.current;
    lastUserIdRef.current = userId;
    if (!userId || prev === null || prev === userId) return;
    const qc = getAppQueryClient();
    if (qc) clearUserQueries(qc);
  }, [userId]);

  useEffect(() => {
    const prev = lastOrgIdRef.current;
    lastOrgIdRef.current = orgId;
    if (!orgId || prev === null || prev === orgId) return;
    if (!userId || lastUserIdRef.current !== userId) return;
    const qc = getAppQueryClient();
    if (qc) invalidateOrgSaasQueries(qc);
  }, [orgId, userId]);

  useEffect(() => {
    if (!isAuthenticated || !hasHydratedAuth) {
      lastBillingFpRef.current = billingFp || null;
      return;
    }
    const prev = lastBillingFpRef.current;
    lastBillingFpRef.current = billingFp;
    if (prev === null || prev === billingFp) return;
    const qc = getAppQueryClient();
    if (qc) invalidateOrgSaasQueries(qc);
  }, [billingFp, isAuthenticated, hasHydratedAuth]);

  useEffect(() => {
    if (!isAuthenticated || !hasHydratedAuth) {
      lastProfileFpRef.current = profileFp || null;
      return;
    }
    const prev = lastProfileFpRef.current;
    lastProfileFpRef.current = profileFp;
    if (prev === null || prev === profileFp) return;
    const qc = getAppQueryClient();
    if (qc) invalidateOrgSaasQueries(qc, { planCaps: false });
  }, [profileFp, isAuthenticated, hasHydratedAuth]);

  useEffect(() => {
    if (!hasClientHydrated && (user || isAuthenticated)) {
      useAuthStore.setState({ hasClientHydrated: true });
    }
  }, [hasClientHydrated, user, isAuthenticated]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().hasClientHydrated) {
        useAuthStore.setState({ hasClientHydrated: true });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const checkAndHydrate = () => {
    if (isIdleLogoutLatched() || isSessionIdleExpired()) {
      useAuthStore.setState({
        user: null,
        isAuthenticated: false,
        hasHydratedAuth: true,
        hasClientHydrated: true,
      });
      return;
    }
    const state = useAuthStore.getState();
    // Prefer snapshot, then already-seeded / persisted user (staff/admin roles).
    const restored =
      peekAuthSnapshotUser() ??
      state.user ??
      null;

    if (restored) {
      useAuthStore.setState({
        user: restored,
        isAuthenticated: true,
        hasHydratedAuth: true,
        hasClientHydrated: true,
      });
      void hydrateFromCookie();
      return;
    }

    useAuthStore.setState({
      hasHydratedAuth: true,
      isAuthenticated: false,
      user: null,
    });
  };

  // useLayoutEffect so admin hard-refresh paints the shell before the browser paints.
  useLayoutEffect(() => {
    if (!hasClientHydrated || hasHydratedAuth) return;

    if (hydrateStartedRef.current) return;
    hydrateStartedRef.current = true;
    checkAndHydrate();

    return () => {
      hydrateStartedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClientHydrated, hasHydratedAuth]);

  useEffect(() => {
    if (hasHydratedAuth) return;

    const timer = setTimeout(() => {
      const state = useAuthStore.getState();
      if (state.hasHydratedAuth) return;
      if (isIdleLogoutLatched() || isSessionIdleExpired()) {
        useAuthStore.setState({
          hasHydratedAuth: true,
          hasClientHydrated: true,
          isAuthenticated: false,
          user: null,
        });
        return;
      }

      const peeked = peekAuthSnapshotUser();
      if (peeked || state.user) {
        useAuthStore.setState({
          hasHydratedAuth: true,
          hasClientHydrated: true,
          isAuthenticated: true,
          ...(peeked || state.user
            ? { user: peeked ?? state.user }
            : {}),
        });
        return;
      }

      useAuthStore.setState({
        hasHydratedAuth: true,
        hasClientHydrated: true,
        isAuthenticated: false,
        user: null,
      });
    }, 2_500);

    return () => clearTimeout(timer);
  }, [hasHydratedAuth]);

  useEffect(() => {
    if (!isAuthenticated || !hasHydratedAuth) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      void silentRefresh();
    }, 5 * 60 * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isAuthenticated, hasHydratedAuth, silentRefresh]);

  return null;
}
