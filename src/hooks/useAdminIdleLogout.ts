"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { classifyPageRoute } from "@/lib/auth/routePolicy";
import { currentReturnTo, signInHref } from "@/utils/authRedirect";
import { useToast } from "@/contexts/toast-context";
import {
  ADMIN_IDLE_ACTIVITY_STORAGE_KEY,
  ADMIN_IDLE_TIMEOUT_MS,
  ADMIN_IDLE_WARN_BEFORE_MS,
  adoptAdminLastActivityFromPeer,
  clearAdminIdleMarkers,
  ensureAdminLastActivitySeeded,
  isIdleLogoutLatched,
  isSessionIdleExpired,
  latchIdleLogout,
  markAdminIdleLogoutNotice,
  readStoredAdminLastActivityAt,
  touchAdminLastActivity,
} from "@/lib/adminIdleTimeout";

/** Throttle activity writes so hover/mousemove cannot thrash localStorage. */
const ACTIVITY_THROTTLE_MS = 1_000;
/** How often we compare now vs last activity (foreground). */
const CHECK_INTERVAL_MS = 10_000;

const WINDOW_ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "click",
  "mousemove",
];

const IDLE_SIGNED_OUT_TOAST =
  "You were signed out after 30 minutes of inactivity. Please sign in again.";

/** Staff, tailor, and profile pages cannot stay up without a session. */
function idleMustLeavePage(pathname: string): boolean {
  const gate = classifyPageRoute(pathname.split("?")[0] || "/");
  return gate === "staff" || gate === "tailor" || gate === "client";
}

/**
 * After 30 minutes with no real UI activity (including while the computer was
 * off), log out. Homepage and other public pages drop the account chip in
 * place. Protected pages go to sign-in. Evaluates the stored stamp before
 * any focus or pointer event can refresh it.
 */
export function useAdminIdleLogout(enabled: boolean): void {
  const router = useRouter();
  const pathname = usePathname();
  const logout = useAuthStore((s) => s.logout);
  const { addToast } = useToast();
  const loggingOutRef = useRef(false);
  const warnedRef = useRef(false);
  const lastTouchWriteRef = useRef(0);
  const pathnameRef = useRef(pathname);
  /** Skip the first pathname effect so mount does not double-touch after seed. */
  const skipPathnameTouchRef = useRef(true);

  pathnameRef.current = pathname;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    loggingOutRef.current = false;

    const forceIdleLogout = async () => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      latchIdleLogout();
      markAdminIdleLogoutNotice();
      const pathnameNow = pathnameRef.current || "/";
      const leave = idleMustLeavePage(pathnameNow);
      if (!leave) {
        try {
          addToast(IDLE_SIGNED_OUT_TOAST, "info");
        } catch {
          /* toast optional */
        }
      }
      try {
        await logout();
      } catch {
        /* still leave the signed-in UI */
      }
      if (isIdleLogoutLatched()) clearAdminIdleMarkers();
      if (leave) {
        const returnTo = currentReturnTo(pathnameNow);
        router.replace(`${signInHref(returnTo)}&reason=idle`);
        return;
      }
      router.refresh();
    };

    const onActivity = () => {
      if (loggingOutRef.current || isIdleLogoutLatched()) return;
      if (isSessionIdleExpired()) {
        void forceIdleLogout();
        return;
      }
      const now = Date.now();
      if (now - lastTouchWriteRef.current < ACTIVITY_THROTTLE_MS) return;
      lastTouchWriteRef.current = now;
      touchAdminLastActivity(now);
      warnedRef.current = false;
    };

    const checkIdle = () => {
      if (loggingOutRef.current) return;
      if (useAuthStore.getState().user == null && !isIdleLogoutLatched()) return;
      if (isSessionIdleExpired()) {
        void forceIdleLogout();
        return;
      }
      const last = readStoredAdminLastActivityAt();
      if (last == null) return;
      const idleFor = Date.now() - last;
      if (idleFor >= ADMIN_IDLE_TIMEOUT_MS) {
        void forceIdleLogout();
        return;
      }
      if (
        idleFor >= ADMIN_IDLE_TIMEOUT_MS - ADMIN_IDLE_WARN_BEFORE_MS &&
        !warnedRef.current
      ) {
        warnedRef.current = true;
        try {
          addToast(
            "Still there? Your session will sign out in about 2 minutes due to inactivity.",
            "info"
          );
        } catch {
          /* ignore */
        }
      }
    };

    // Cross-tab: activity in another admin tab resets the shared clock.
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== ADMIN_IDLE_ACTIVITY_STORAGE_KEY) return;
      if (ev.newValue) {
        const n = Number(ev.newValue);
        adoptAdminLastActivityFromPeer(n);
        warnedRef.current = false;
      }
    };

    // Returning to a stale / slept tab → evaluate immediately (timers throttle in bg).
    const onResume = () => {
      checkIdle();
    };

    // Stamp must be judged before listeners. Opening the app fires focus and
    // mousemove immediately; those used to reset a shutdown-long idle clock
    // before the first timer check.
    if (isSessionIdleExpired()) {
      void forceIdleLogout();
      return;
    }
    // Do NOT reset the idle clock on effect remount — that would defeat sleep /
    // Fast Refresh / dependency churn. Only seed when empty.
    ensureAdminLastActivitySeeded();

    for (const type of WINDOW_ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, {
        capture: true,
        passive: true,
      });
    }
    // scroll does not bubble — capture on document catches overflow panels.
    document.addEventListener("scroll", onActivity, {
      capture: true,
      passive: true,
    });
    // Keyboard / assistive focus moves count as presence.
    document.addEventListener("focusin", onActivity, true);

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("storage", onStorage);

    const intervalId = window.setInterval(checkIdle, CHECK_INTERVAL_MS);
    const firstCheckId = window.setTimeout(checkIdle, 1_000);

    return () => {
      for (const type of WINDOW_ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, true);
      }
      document.removeEventListener("scroll", onActivity, true);
      document.removeEventListener("focusin", onActivity, true);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
      window.clearTimeout(firstCheckId);
    };
  }, [enabled, logout, router, addToast]);

  // Soft-nav between admin pages counts as activity (sidebar click → route change).
  useEffect(() => {
    if (!enabled) return;
    if (skipPathnameTouchRef.current) {
      skipPathnameTouchRef.current = false;
      return;
    }
    if (isIdleLogoutLatched() || isSessionIdleExpired()) return;
    touchAdminLastActivity();
    warnedRef.current = false;
  }, [enabled, pathname]);

  // When the hook re-enables after a prior disable, allow the next path touch.
  useEffect(() => {
    if (!enabled) {
      skipPathnameTouchRef.current = true;
    }
  }, [enabled]);
}
