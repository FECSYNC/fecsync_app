'use client';

import { ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  peekAuthSnapshotUser,
  seedAuthStoreFromSnapshot,
  useAuthStore,
} from '@/store/authStore';
import { sessionIsStaff } from '@/lib/auth/session';
import { currentReturnTo, signInHref } from '@/utils/authRedirect';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import { hydrateAllAdminListSnapshots } from '@/lib/adminListSnapshot';
import { hydrateDashboardQueryCache } from '@/lib/dashboardSnapshot';
import {
  isAdminPageAllowed,
  isStorefrontOrgSession,
  isStorefrontPlatformSuperAdmin,
  permissionDeniedHref,
} from '@/hooks/useAdminPermission';
import { planAllowsModule } from '@/lib/subscriptionPlans';
import {
  orgBillingFingerprint,
  orgProfileFingerprint,
} from '@/utils/orgSaasSessionSync';
import BillingRenewModal from '@/components/Protected/admin/pages/billing/BillingRenewModal';
import {
  adminNavPathOnly,
  clearAdminInstantNav,
  clearAdminRouteTransition,
  getAdminInstantTitle,
  getAdminRouteTransitionHref,
  navigateAdminRoute,
  setMarketingNavIntent,
  useAdminInstantNav,
  useAdminRouteTransition,
  useMarketingNavIntent,
} from '@/lib/adminInstantNav';
import AdminRouteLoading from '@/components/Protected/admin/components/AdminRouteLoading';
import MarketingStorefrontNotice from '@/components/Protected/admin/pages/marketing/MarketingStorefrontNotice';
import {
  isDemoAllowedAdminPath,
  sessionIsDemoPlan,
} from '@/lib/demoPlanLock';
import { P } from '@/lib/auth/permissions';

function isMarketingAdminHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const path = adminNavPathOnly(href);
  return path === '/admin/marketing' || path.startsWith('/admin/marketing/');
}
// Client module load: know staff/admin before first AdminLayout paint.
if (typeof window !== 'undefined') {
  seedAuthStoreFromSnapshot();
}

/**
 * Remount-resistant auth gate. Fast Refresh / Turbopack remounts used to clear
 * effect timers and leave hard-refresh stuck on "Restoring your session…".
 * Cookies may still be valid while localStorage snapshot is empty (InPrivate).
 */
let adminAuthStartedAt: number | null = null;
let adminHydrateShared: Promise<void> | null = null;
/** Module-level hang timer — must NOT be cleared on React effect cleanup. */
let adminAuthHangTimer: ReturnType<typeof setTimeout> | null = null;
/** Once set, hard-nav away; ignores remount cancellation. */
let adminAuthLeavingHref: string | null = null;
/** Latest pathname for returnTo / 403 (hang fires outside the effect closure). */
let adminAuthPathname = "/admin";
const ADMIN_GATE_ESCAPE_KEY = "admin-gate-escaping";
/** Show a clearer status after this; do not redirect yet (getMe can be slow under compile). */
const ADMIN_AUTH_STATUS_MS = 800;
/**
 * Last-resort redirect when cookie hydrate never settles (dev Turbopack can sit
 * on /api/auth/refresh + /me for 30–90s). Must exceed typical first-compile
 * latency or a fresh login paints /admin then bounces to /signin.
 *
 * Do not shorten these below real cold-compile times — an 8s hang previously
 * kicked valid company sessions while /me and refresh were still compiling.
 */
const ADMIN_AUTH_SIGNIN_MS =
  process.env.NODE_ENV === "development" ? 90_000 : 25_000;
/** Cap forced refresh proof so dead cookies cannot hang the gate forever. */
const ADMIN_REFRESH_PROOF_MS =
  process.env.NODE_ENV === "development" ? 30_000 : 12_000;
/** Cookie-proven staff session — only then may we disarm the hang watchdog. */
let adminCookieProven = false;
let adminLeaveRetryTimers: Array<ReturnType<typeof setTimeout>> = [];

function ensureAdminCookieHydrate(
  hydrateFromCookie: () => Promise<void>
): Promise<void> {
  if (!adminHydrateShared) {
    adminHydrateShared = hydrateFromCookie()
      .catch(() => undefined)
      .finally(() => {
        window.setTimeout(() => {
          adminHydrateShared = null;
        }, 500);
      });
  }
  return adminHydrateShared;
}

function stillOnAdminAuthGate(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname || "";
  return path.startsWith("/admin") || path.startsWith("/tailor");
}

function clearAdminLeaveRetries() {
  for (const t of adminLeaveRetryTimers) window.clearTimeout(t);
  adminLeaveRetryTimers = [];
}

/** Staff cookies proven — cancel any in-flight bounce-to-signin. */
function markAdminCookieProven() {
  adminCookieProven = true;
  adminAuthLeavingHref = null;
  clearAdminLeaveRetries();
  clearAdminAuthHangWatchdog({ resetClock: true });
  try {
    sessionStorage.removeItem(ADMIN_GATE_ESCAPE_KEY);
  } catch {
    /* ignore */
  }
}

function leaveAdminAuthGate(href: string) {
  if (typeof window === "undefined") return;
  // A late hang must not override a session that just proved cookies.
  if (adminCookieProven) return;
  // Allow retries with the same or updated href — a single failed assign used
  // to latch forever while Restoring stayed on screen.
  adminAuthLeavingHref = href;
  if (adminAuthHangTimer != null) {
    window.clearTimeout(adminAuthHangTimer);
    adminAuthHangTimer = null;
  }
  clearAdminLeaveRetries();
  useAuthStore.setState({
    hasHydratedAuth: true,
    hasClientHydrated: true,
  });
  const go = () => {
    // Proof can win after leave was scheduled — abort the bounce.
    if (adminCookieProven) return;
    if (!stillOnAdminAuthGate()) return;
    window.location.replace(href);
  };
  go();
  // Hard-nav can stall under Turbopack; keep pushing until we leave /admin.
  for (const ms of [200, 800, 2000, 4000]) {
    adminLeaveRetryTimers.push(window.setTimeout(go, ms));
  }
}

function clearAdminAuthHangWatchdog(opts?: { resetClock?: boolean }) {
  if (adminAuthHangTimer != null) {
    window.clearTimeout(adminAuthHangTimer);
    adminAuthHangTimer = null;
  }
  // Never rewind the clock on optimistic snapshot paints — that was the
  // Restoring deadlock when refresh 401 ↔ snapshot flicker looped.
  if (opts?.resetClock && adminCookieProven) {
    adminAuthStartedAt = null;
  }
}

function ensureAdminAuthHangWatchdog() {
  if (typeof window === "undefined") return;
  if (adminCookieProven) return;
  if (adminAuthHangTimer != null) return;
  if (adminAuthStartedAt == null) adminAuthStartedAt = Date.now();
  const wait = Math.max(
    0,
    ADMIN_AUTH_SIGNIN_MS - (Date.now() - adminAuthStartedAt)
  );
  adminAuthHangTimer = window.setTimeout(() => {
    adminAuthHangTimer = null;
    if (adminCookieProven) return;
    const next = useAuthStore.getState().user ?? null;
    // Fresh login paints a staff snapshot before cookie proof finishes.
    // Do not bounce that session — the prove IIFE leaves if cookies are dead.
    if (next && sessionIsStaff(next)) return;
    const path = adminAuthPathname || "/admin";
    // Prefer sign-in for empty/expired sessions; 403 only for a live non-staff user.
    if (next && !sessionIsStaff(next)) {
      leaveAdminAuthGate(`/403?from=${encodeURIComponent(path)}`);
      return;
    }
    leaveAdminAuthGate(signInHref(currentReturnTo(path)));
  }, wait);
}

async function raceAdminAuthMs(
  promise: Promise<unknown>,
  ms: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

interface AdminLayoutProps {
  children: ReactNode;
}

/**
 * Force-escape when the admin gate cannot prove a staff session.
 * Does NOT call /api/auth/refresh (parallel refresh kills the session via
 * token-reuse detection and wedged the dev server).
 */
function forceAdminGateSignIn() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname || "/";
  if (path.startsWith("/signin")) return;
  try {
    if (sessionStorage.getItem(ADMIN_GATE_ESCAPE_KEY) === "1") {
      // Already navigating — only hard-replace, no second logout storm.
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.replace(
        `/signin?returnTo=${encodeURIComponent(returnTo)}`
      );
      return;
    }
    sessionStorage.setItem(ADMIN_GATE_ESCAPE_KEY, "1");
  } catch {
    /* ignore */
  }
  try {
    for (const key of ["auth-store", "auth-snapshot", "user"]) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(ADMIN_GATE_ESCAPE_KEY, "1");
  } catch {
    /* ignore */
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const href = `/signin?returnTo=${encodeURIComponent(returnTo)}`;
  // Navigate first — logout in background. Awaiting logout + parallel refresh
  // previously deadlocked pages and the Next dev server.
  window.location.replace(href);
  void fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  }).catch(() => undefined);
}

/**
 * Escape hard-cap must exceed cold /me compile (logs show 10s+). A 10s cap
 * previously force-logged-out successful logins while /me was still in flight.
 */
const ADMIN_SKELETON_ESCAPE_MS =
  process.env.NODE_ENV === "development" ? 90_000 : 25_000;
const ADMIN_SKELETON_ME_MS =
  process.env.NODE_ENV === "development" ? 60_000 : 20_000;

/** Chrome placeholder while auth settles — avoids blank white hard-refresh splash. */
function AdminShellSkeleton({
  message,
  /** When true, check /me once and hard-nav to sign-in on definitive 401. */
  forceEscape = false,
}: {
  message: string;
  forceEscape?: boolean;
}) {
  useEffect(() => {
    if (!forceEscape) return;
    let cancelled = false;

    try {
      if (sessionStorage.getItem(ADMIN_GATE_ESCAPE_KEY) === "1") {
        // Landed back on admin mid-escape — finish leaving, do not refresh again.
        forceAdminGateSignIn();
        return;
      }
    } catch {
      /* ignore */
    }

    // Last resort only — wait for cold /me compile before declaring the session dead.
    const hardCap = window.setTimeout(() => {
      if (!cancelled) forceAdminGateSignIn();
    }, ADMIN_SKELETON_ESCAPE_MS);

    void (async () => {
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), ADMIN_SKELETON_ME_MS);
      try {
        // /me only — never POST refresh here (single-flight lives in authStore).
        const me = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (cancelled) return;
        if (me.ok) {
          window.clearTimeout(hardCap);
          try {
            sessionStorage.removeItem(ADMIN_GATE_ESCAPE_KEY);
          } catch {
            /* ignore */
          }
          // Store will hydrate; do not reload-loop.
          return;
        }
        if (me.status === 401 || me.status === 403) {
          window.clearTimeout(hardCap);
          forceAdminGateSignIn();
        }
      } catch {
        /* hardCap handles total failure */
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(hardCap);
    };
  }, [forceEscape]);

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden" aria-busy="true">
      <aside
        className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col border-r border-stone-200 bg-white"
        aria-hidden
      >
        <div className="h-16 border-b border-stone-100 px-5 flex items-center">
          <div className="h-7 w-28 rounded bg-stone-100 animate-pulse" />
        </div>
        <div className="flex-1 space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-9 rounded-lg bg-stone-100 animate-pulse"
              style={{ opacity: 1 - i * 0.06 }}
            />
          ))}
        </div>
      </aside>
      <div className="lg:pl-64 min-w-0">
        <div className="sticky top-0 z-30 h-14 border-b border-stone-200 bg-white/90 px-4 flex items-center">
          <div className="h-5 w-40 rounded bg-stone-100 animate-pulse" />
        </div>
        <main className="min-w-0 px-3 pb-4 pt-4 sm:px-4 sm:pb-5 sm:pt-5 md:px-6 md:pb-6 md:pt-6">
          <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 py-12">
            <div
              className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-[#D4AF37]"
              aria-hidden
            />
            <p className="text-sm text-stone-500">{message}</p>
            {forceEscape ? (
              <button
                type="button"
                onClick={() => forceAdminGateSignIn()}
                className="mt-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
              >
                Go to sign in
              </button>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Pending chrome while an instant-nav page chunk compiles. */
function AdminInstantPendingChrome({ title }: { title: string }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
          Admin
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </div>
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-lg border border-stone-200 bg-white py-12">
        <div
          className="h-9 w-9 animate-spin rounded-full border-4 border-stone-200 border-t-[#D4AF37]"
          aria-hidden
        />
        <p className="text-sm text-stone-500">Loading {title.toLowerCase()}…</p>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Membership cookie refresh finished — used for permission redirect only. */
  const [sessionSynced, setSessionSynced] = useState(false);
  /**
   * Avoid seeding auth during render — that made the client tree diverge from
   * SSR (skeleton `<aside>` vs sidebar `<div>`) → hydration mismatch → full
   * reload loops → memory restart + session death in the terminal log.
   */
  const [clientReady, setClientReady] = useState(false);
  const snapHydratedOrgRef = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const hasHydratedAuth = useAuthStore((s) => s.hasHydratedAuth);
  const can = useAuthStore((s) => s.can);
  const silentRefresh = useAuthStore((s) => s.silentRefresh);
  const hydrateFromCookie = useAuthStore((s) => s.hydrateFromCookie);
  const instantNav = useAdminInstantNav();
  const routeTransition = useAdminRouteTransition();
  const marketingNavIntent = useMarketingNavIntent();

  useLayoutEffect(() => {
    seedAuthStoreFromSnapshot();
    setClientReady(true);
  }, []);

  const resolvedUser = clientReady
    ? useAuthStore.getState().user ??
      user ??
      peekAuthSnapshotUser()
    : user;
  const isAdmin = Boolean(
    clientReady && resolvedUser && sessionIsStaff(resolvedUser)
  );

  // CRITICAL: hydrate list snapshots DURING render (before children mount), not in
  // useLayoutEffect — otherwise CategoriesTable useQuery starts empty and spins.
  if (
    typeof window !== 'undefined' &&
    isAdmin &&
    resolvedUser?.orgId &&
    snapHydratedOrgRef.current !== resolvedUser.orgId
  ) {
    hydrateAllAdminListSnapshots(queryClient, resolvedUser.orgId);
    hydrateDashboardQueryCache(queryClient, resolvedUser.orgId);
    snapHydratedOrgRef.current = resolvedUser.orgId;
  }

  // Registered company awaiting FECSYNC approval, suspended, or soft billing
  // hold cannot use full /admin — waiting room still allows lifecycle export.
  // Ops hold / account lock: SuspendedAccountGate shows the dialog on /admin;
  // do not emit here (that sticky-opened the dialog on /company-pending).
  useEffect(() => {
    if (!user || !hasHydratedAuth) return;
    if (
      user.orgStatus === "pending" ||
      user.orgStatus === "suspended" ||
      user.billingSoftHold === true
    ) {
      router.replace("/company-pending");
    }
  }, [user, hasHydratedAuth, router]);

  // Step 6.3 — per-route page permission (dashboard soft-gated; unknown → deny).
  const pageAccess = useMemo(
    () => isAdminPageAllowed(pathname || '/admin', can, user),
    [pathname, can, user]
  );
  const { allowed: canOpenPage, permission: pagePermission } = pageAccess;

  const handleMenuToggle = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleSidebarClose = () => {
    setSidebarOpen(false);
  };

  // Refresh Membership cookie in the background — do NOT block page paint.
  // Re-poll periodically so remote approve/suspend/lazy-expire updates orgStatus.
  // When billing/org fields change, invalidate company SaaS RQ so meters match /me.
  useEffect(() => {
    if (!isAdmin || !hasHydratedAuth) return;
    let cancelled = false;
    // Do NOT setSessionSynced(true) here — that ran permission redirects before
    // /me refresh finished and bounced Deliveries → /403 on every cold open.
    setSessionSynced(false);
    const billingFingerprint = orgBillingFingerprint;
    const profileFingerprint = orgProfileFingerprint;

    const syncSaasCaches = async (opts?: { planCaps?: boolean }) => {
      const { invalidateOrgSaasQueries } = await import(
        '@/utils/invalidateOrgSaasQueries'
      );
      invalidateOrgSaasQueries(queryClient, opts);
    };

    const run = async (opts?: { force?: boolean }) => {
      const beforeUser = useAuthStore.getState().user;
      const beforeBilling = billingFingerprint(beforeUser);
      const beforeProfile = profileFingerprint(beforeUser);
      try {
        await silentRefresh(opts);
      } catch {
        // APIs use requirePermissionFresh as fallback.
      }
      if (cancelled) return;
      setSessionSynced(true);
      const afterUser = useAuthStore.getState().user;
      // Logged out during refresh — leave admin chrome; auth gate sends to sign-in.
      if (!afterUser || !sessionIsStaff(afterUser)) return;
      const afterBilling = billingFingerprint(afterUser);
      const afterProfile = profileFingerprint(afterUser);
      if (beforeBilling !== afterBilling) {
        await syncSaasCaches();
      } else if (beforeProfile !== afterProfile) {
        await syncSaasCaches({ planCaps: false });
      }
    };

    // Prove cookies ASAP — a delayed first refresh left expired snapshot sessions
    // painting /admin with no login redirect.
    const initialDelayMs =
      process.env.NODE_ENV === 'development' ? 400 : 0;
    const startTimer = window.setTimeout(() => {
      void run({ force: true });
    }, initialDelayMs);
    const id = window.setInterval(() => {
      void run();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearInterval(id);
    };
  }, [isAdmin, hasHydratedAuth, silentRefresh, queryClient]);

  // Cookies can be valid while the client store is empty (InPrivate has no
  // localStorage snapshot) OR while a stale non-staff snapshot still sits in
  // memory after a fresh admin login (JWT is staff; proxy allowed /admin).
  // Never 403/signin until cookie hydrate finishes — a 3.5s timer used to race
  // slow first-compile refresh and bounce successful logins back to /signin.
  //
  // Hang watchdog + leaveAdminAuthGate are module-level so Turbopack remounts
  // (heavy /admin/accounting/* hard refresh) cannot cancel the leave forever.
  useEffect(() => {
    adminAuthPathname = pathname || "/admin";

    // Optimistic snapshot can paint isAdmin before cookies are proven. Keep the
    // hang watchdog armed until silentRefresh/hydrate actually succeeds.
    if (isAdmin && adminCookieProven) {
      markAdminCookieProven();
      return;
    }

    if (adminAuthStartedAt == null) {
      adminAuthStartedAt = Date.now();
    }
    ensureAdminAuthHangWatchdog();

    seedAuthStoreFromSnapshot();
    if (!useAuthStore.getState().hasClientHydrated) {
      useAuthStore.setState({ hasClientHydrated: true });
    }

    const statusTimer = window.setTimeout(() => {
      if (adminAuthLeavingHref && !stillOnAdminAuthGate()) return;
      // Marketing keeps "Opening…" until cookie proof finishes — flipping
      // hydrated early painted a false "Session expired" and could hard-nav
      // away while /me was still in flight on a slow pooler.
      if (isMarketingAdminHref(adminAuthPathname)) return;
      if (!useAuthStore.getState().hasHydratedAuth) {
        useAuthStore.setState({ hasHydratedAuth: true });
      }
    }, Math.max(0, ADMIN_AUTH_STATUS_MS - (Date.now() - (adminAuthStartedAt ?? Date.now()))));

    void (async () => {
      // Cap wait — hung /me compile left Restoring forever on hard refresh.
      // hydrateFromCookie now awaits cookie proof on /admin (no stale snapshot OK).
      await raceAdminAuthMs(ensureAdminCookieHydrate(hydrateFromCookie), 12_000);

      let nextUser = useAuthStore.getState().user ?? null;
      if (nextUser && sessionIsStaff(nextUser)) {
        // Prove cookies even when snapshot already painted staff.
        await raceAdminAuthMs(
          silentRefresh({ force: true }),
          ADMIN_REFRESH_PROOF_MS
        );
        nextUser = useAuthStore.getState().user ?? null;
        if (nextUser && sessionIsStaff(nextUser)) {
          markAdminCookieProven();
          return;
        }
      }

      // Optimistic auth-snapshot can still be a prior client session while
      // HttpOnly cookies are staff. Prove via forced refresh before /403.
      if (nextUser && !sessionIsStaff(nextUser)) {
        await raceAdminAuthMs(
          silentRefresh({ force: true }),
          ADMIN_REFRESH_PROOF_MS
        );
        nextUser = useAuthStore.getState().user ?? null;
        if (nextUser && sessionIsStaff(nextUser)) {
          markAdminCookieProven();
          return;
        }
        if (nextUser && !sessionIsStaff(nextUser)) {
          leaveAdminAuthGate(
            `/403?from=${encodeURIComponent(adminAuthPathname || "/admin")}`
          );
          return;
        }
      }

      // Marketing cold open: prove cookies first, then hard-nav to sign-in.
      if (isMarketingAdminHref(adminAuthPathname)) {
        await raceAdminAuthMs(
          silentRefresh({ force: true }),
          ADMIN_REFRESH_PROOF_MS
        );
        nextUser = useAuthStore.getState().user ?? null;
        if (nextUser && sessionIsStaff(nextUser)) {
          markAdminCookieProven();
          useAuthStore.setState({
            hasHydratedAuth: true,
            hasClientHydrated: true,
          });
          return;
        }
        leaveAdminAuthGate(signInHref(currentReturnTo(adminAuthPathname)));
        return;
      }

      // Empty after hydrate: one short retry for slow first-compile /me.
      useAuthStore.setState({
        hasHydratedAuth: true,
        hasClientHydrated: true,
      });
      await new Promise((r) => window.setTimeout(r, 300));
      adminHydrateShared = null;
      await raceAdminAuthMs(ensureAdminCookieHydrate(hydrateFromCookie), 5_000);

      nextUser = useAuthStore.getState().user ?? null;
      if (nextUser && sessionIsStaff(nextUser)) {
        markAdminCookieProven();
        return;
      }
      if (nextUser && !sessionIsStaff(nextUser)) {
        leaveAdminAuthGate(
          `/403?from=${encodeURIComponent(adminAuthPathname || "/admin")}`
        );
        return;
      }

      // Dead cookies (/me + refresh 401) — leave immediately.
      leaveAdminAuthGate(signInHref(currentReturnTo(adminAuthPathname)));
    })();

    return () => {
      // Only clear the cosmetic status timer. Hang watchdog stays armed.
      window.clearTimeout(statusTimer);
    };
  }, [isAdmin, pathname, hydrateFromCookie, silentRefresh]);

  // Staff missing this page's read/manage permission → permission 403.
  // Demo lock: soft-send to Billing (each sidebar leaf still linked its own href).
  useEffect(() => {
    if (!isAdmin || !hasHydratedAuth || !user) return;
    if (canOpenPage) return;
    if (!sessionSynced) return;
    const from = pathname || '/admin';
    if (
      sessionIsDemoPlan(user) &&
      !isStorefrontPlatformSuperAdmin(user) &&
      !isDemoAllowedAdminPath(from)
    ) {
      router.replace(`/admin/billing?from=${encodeURIComponent(from)}`);
      return;
    }
    // Growth+ module soft-lock (Starter entitled but Memberships not on plan).
    if (
      !isStorefrontPlatformSuperAdmin(user) &&
      !isStorefrontOrgSession(user) &&
      (from === '/admin/memberships' || from.startsWith('/admin/memberships/')) &&
      !planAllowsModule(user.subscriptionPlan, 'memberships')
    ) {
      router.replace(`/admin/billing?from=${encodeURIComponent(from)}`);
      return;
    }
    if (
      !isStorefrontPlatformSuperAdmin(user) &&
      !isStorefrontOrgSession(user) &&
      (from === '/admin/waivers' || from.startsWith('/admin/waivers/')) &&
      !planAllowsModule(user.subscriptionPlan, 'waivers')
    ) {
      router.replace(`/admin/billing?from=${encodeURIComponent(from)}`);
      return;
    }
    if (
      !isStorefrontPlatformSuperAdmin(user) &&
      !isStorefrontOrgSession(user) &&
      (from === '/admin/pos' || from.startsWith('/admin/pos/')) &&
      !planAllowsModule(user.subscriptionPlan, 'pos')
    ) {
      router.replace(`/admin/billing?from=${encodeURIComponent(from)}`);
      return;
    }
    if (
      !isStorefrontPlatformSuperAdmin(user) &&
      !isStorefrontOrgSession(user) &&
      (from === '/admin/marketing' || from.startsWith('/admin/marketing/')) &&
      !planAllowsModule(user.subscriptionPlan, 'marketing')
    ) {
      router.replace(`/admin/billing?from=${encodeURIComponent(from)}`);
      return;
    }
    router.replace(
      permissionDeniedHref(from, pagePermission, { user })
    );
  }, [
    isAdmin,
    hasHydratedAuth,
    user,
    sessionSynced,
    canOpenPage,
    pagePermission,
    pathname,
    router,
  ]);

  // Restore last list payloads as soon as orgId is known (hard refresh).
  useLayoutEffect(() => {
    if (!isAdmin || !user?.orgId) return;
    hydrateAllAdminListSnapshots(queryClient, user.orgId);
    hydrateDashboardQueryCache(queryClient, user.orgId);
  }, [isAdmin, queryClient, user?.orgId]);

  // Warm the current route after the shell paints. The prefetch module pulls in
  // every admin list client — loading it up front held hard refresh on a spinner.
  useEffect(() => {
    if (!isAdmin || !user) return;
    let cancel = () => {};
    let disposed = false;
    void import('@/lib/prefetchAdminRoute').then((mod) => {
      if (disposed) return;
      cancel = mod.warmAdminShellCaches(
        queryClient,
        can,
        pathname || '/admin',
        user
      );
    });
    return () => {
      disposed = true;
      cancel();
    };
  }, [isAdmin, queryClient, user, can, pathname]);

  // Do not background-compile Parties/Bookings/Orders on every admin mount —
  // that stampeded webpack, timed out /api/auth/refresh, and OOM-restarted dev.
  // Safety: only Create booking may use the optimistic overlay. Clear any
  // stale overlay left from older builds / HMR (Sessions, Ticket products, etc.).
  useEffect(() => {
    if (instantNav.href && instantNav.href !== '/admin/bookings/new') {
      clearAdminInstantNav();
    }
  }, [instantNav.href]);

  // Alt+Shift+N → Create booking (when entitled; skips inputs/contenteditable).
  // On the Bookings list, open the in-page modal (no route change).
  useEffect(() => {
    if (!isAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'N' && e.key !== 'n') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (!(can(P.BookingsCreate) || can(P.BookingsWrite))) return;
      if (sessionIsDemoPlan(user) && !isDemoAllowedAdminPath('/admin/bookings/new')) {
        return;
      }
      if (pathname === '/admin/bookings/new') return;
      e.preventDefault();
      const bookingsList =
        pathname.replace(/\/$/, '') === '/admin/bookings';
      if (bookingsList) {
        window.dispatchEvent(new Event('admin:open-create-booking'));
        return;
      }
      navigateAdminRoute(router, '/admin/bookings/new');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isAdmin, can, user, pathname, router]);

  // When the real route catches up, drop the optimistic overlay (children take over).
  useEffect(() => {
    if (!instantNav.href || !pathname) return;
    if (pathname === instantNav.href) {
      clearAdminInstantNav(instantNav.href);
    }
  }, [pathname, instantNav.href]);

  // Opening… clears only when React pathname matches the intended destination.
  // Compare path-only so ?create=1 (and similar) cannot stick the spinner.
  // Never clear on window.location alone — pushState updates the address bar
  // before App Router settles; clearing then revealed the previous leaf.
  useEffect(() => {
    if (!routeTransition.href || !pathname) return;
    if (adminNavPathOnly(pathname) !== adminNavPathOnly(routeTransition.href)) {
      return;
    }
    clearAdminRouteTransition(routeTransition.href, { immediate: true });
  }, [pathname, routeTransition.href]);

  // Marketing path settled — drop soft-nav intent.
  useEffect(() => {
    if (!marketingNavIntent || !pathname) return;
    if (!isMarketingAdminHref(pathname)) return;
    setMarketingNavIntent(null);
  }, [pathname, marketingNavIntent]);

  // Storefront Marketing: drop Opening chrome immediately and keep the shell notice.
  useEffect(() => {
    if (!isAdmin || !user || !isStorefrontOrgSession(user)) return;
    const pending = routeTransition.href;
    if (!isMarketingAdminHref(pending) && !isMarketingAdminHref(marketingNavIntent)) {
      return;
    }
    if (pending) clearAdminRouteTransition(pending, { immediate: true });
  }, [isAdmin, user, routeTransition.href, marketingNavIntent]);

  // Fast path: address bar already at dest but React pathname lagged (common
  // under yarn-dev compile). Nudge replace after 1.5s so Opening never sticks.
  useEffect(() => {
    if (!routeTransition.href) return;
    const dest = routeTransition.href;
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== dest) return;
    if (pathname === dest) return;
    const t = window.setTimeout(() => {
      if (getAdminRouteTransitionHref() !== dest) return;
      router.replace(dest);
    }, 1_500);
    return () => window.clearTimeout(t);
  }, [routeTransition.href, pathname, router]);

  // Slow-compile nudge: if the address bar already shows dest but App Router
  // pathname lagged, replace again. Never clear Opening onto the previous leaf.
  useEffect(() => {
    if (!routeTransition.href) return;
    const dest = routeTransition.href;
    const t = window.setTimeout(() => {
      if (getAdminRouteTransitionHref() !== dest) return;
      const here =
        typeof window !== 'undefined' ? window.location.pathname : '';
      if (here === dest) {
        if (pathname === dest) {
          clearAdminRouteTransition(dest, { immediate: true });
        } else {
          router.replace(dest);
        }
        return;
      }
      try {
        window.history.pushState(
          {
            ...(window.history.state && typeof window.history.state === 'object'
              ? window.history.state
              : {}),
            __fecAdminNav: dest,
          },
          '',
          dest
        );
      } catch {
        /* ignore */
      }
      router.replace(dest);
    }, 8_000);
    return () => window.clearTimeout(t);
  }, [routeTransition.href, routeTransition.startedAt, router, pathname]);

  // Last resort after a very long wait — hard navigate so we never sit forever
  // on Opening, and never silently drop back to the previous leaf.
  useEffect(() => {
    if (!routeTransition.href) return;
    const dest = routeTransition.href;
    const t = window.setTimeout(() => {
      if (getAdminRouteTransitionHref() !== dest) return;
      // Always leave the previous leaf — hard nav. Do not clear Opening first
      // onto stale children.
      window.location.assign(dest);
    }, 75_000);
    return () => window.clearTimeout(t);
  }, [routeTransition.href, pathname]);

  // Browser back/forward must dismiss Opening + create-booking overlay.
  // Soft-nav pushState/replace can emit popstate — do NOT clear Opening when
  // the address bar still matches the pending destination.
  useEffect(() => {
    const onPopState = () => {
      const pending = getAdminRouteTransitionHref();
      const here =
        typeof window !== 'undefined' ? window.location.pathname : '';
      if (pending && here === pending) {
        return;
      }
      clearAdminInstantNav();
      clearAdminRouteTransition(undefined, { immediate: true });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  // Safety net: marketing confirmed empty session but soft-nav stalled —
  // hard-assign after a short beat (hasHydratedAuth only flips after proof).
  useEffect(() => {
    if (isAdmin || !hasHydratedAuth) return;
    if (!isMarketingAdminHref(pathname)) return;
    const t = window.setTimeout(() => {
      const u = useAuthStore.getState().user;
      if (u && sessionIsStaff(u)) return;
      window.location.assign(signInHref(currentReturnTo(pathname)));
    }, 2500);
    return () => window.clearTimeout(t);
  }, [isAdmin, hasHydratedAuth, pathname]);

  // Auth settling — only for true guests (no staff session in memory or storage).
  // Never replace the real sidebar when the actor is already a known staff/admin.
  if (!isAdmin) {
    const destLabel =
      pathname && pathname !== '/admin' && pathname.startsWith('/admin/')
        ? pathname.replace(/^\/admin\//, '').split('/')[0]?.replace(/-/g, ' ') ||
          'page'
        : null;
    const marketingCold = isMarketingAdminHref(pathname);
    const leaving = Boolean(adminAuthLeavingHref) && stillOnAdminAuthGate();
    // Fresh login sets hasHydratedAuth before soft-nav to /admin. First paint is
    // still !isAdmin (clientReady false for SSR match) — do NOT arm force-escape
    // while a staff snapshot/user exists or we bounce successful logins in ~10s.
    const staffSnapshot = Boolean(
      (user && sessionIsStaff(user)) ||
        (() => {
          const snap = peekAuthSnapshotUser();
          return Boolean(snap && sessionIsStaff(snap));
        })()
    );
    const forceEscape =
      leaving ||
      marketingCold ||
      (hasHydratedAuth && clientReady && !staffSnapshot);
    return (
      <AdminShellSkeleton
        forceEscape={forceEscape}
        message={
          leaving
            ? 'Session expired — taking you to sign in…'
            : forceEscape
              ? marketingCold
                ? 'Session expired — taking you to sign in…'
                : 'Restoring your session…'
              : destLabel
                ? `Opening ${destLabel}…`
                : 'Opening admin workspace…'
        }
      />
    );
  }

  // Avoid flashing forbidden content while redirecting to /403 (after sync).
  if (sessionSynced && !canOpenPage) {
    return (
      <div className="min-h-screen bg-gray-50 overflow-x-hidden">
        <AdminSidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />
        <div className="lg:pl-64 min-w-0">
          <div className="sticky top-0 z-30">
            <AdminHeader onMenuToggle={handleMenuToggle} />
          </div>
          <main className="min-w-0 px-3 pb-4 pt-4 sm:px-4 sm:pb-5 sm:pt-5 md:px-6 md:pb-6 md:pt-6">
            <AdminRouteLoading label="Redirecting…" />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />

      <div className="lg:pl-64 min-w-0">
        <div className="sticky top-0 z-30">
          <AdminHeader onMenuToggle={handleMenuToggle} />
        </div>

        {/* Do not use py-* / p-* here — they override pt-* in Tailwind and
            collapse clearance under the sticky header (content gets covered). */}
        <main className="min-w-0 px-3 pb-4 pt-4 sm:px-4 sm:pb-5 sm:pt-5 md:px-6 md:pb-6 md:pt-6">
          {(() => {
            // Legacy create-booking chunk overlay (rare / HMR).
            if (instantNav.href && instantNav.href !== pathname) {
              const InstantPage = instantNav.Comp;
              if (InstantPage) {
                return (
                  <Suspense
                    fallback={
                      <AdminInstantPendingChrome
                        title={getAdminInstantTitle(instantNav.href)}
                      />
                    }
                  >
                    <InstantPage />
                  </Suspense>
                );
              }
              return (
                <AdminInstantPendingChrome
                  title={getAdminInstantTitle(instantNav.href)}
                />
              );
            }

            // Storefront Marketing: shell-owned notice on click (no RSC wait).
            const addressPath =
              typeof window !== 'undefined' ? window.location.pathname : '';
            const marketingStorefront =
              isStorefrontOrgSession(user) &&
              (isMarketingAdminHref(pathname) ||
                isMarketingAdminHref(routeTransition.href) ||
                isMarketingAdminHref(marketingNavIntent) ||
                isMarketingAdminHref(addressPath));
            if (marketingStorefront) {
              return <MarketingStorefrontNotice />;
            }

            // Opening chrome is a full-pane cover until React pathname matches
            // the click target. Previous children stay mounted (soft-nav needs
            // them) but are hidden AND covered so they never flash back.
            const pendingHref = routeTransition.href;
            // Storefront marketing never uses Opening — handled above.
            const showOpening = Boolean(
              pendingHref &&
                !isMarketingAdminHref(pendingHref) &&
                adminNavPathOnly(pendingHref) !==
                  adminNavPathOnly(pathname || '')
            );
            const title = pendingHref
              ? getAdminInstantTitle(pendingHref)
              : '';

            return (
              <div className="relative min-h-[16rem]">
                <div
                  // Remount when the settled URL changes so a stale page (e.g.
                  // Deliveries) cannot linger after Opening clears.
                  key={pathname || '/admin'}
                  className={showOpening ? 'invisible h-0 overflow-hidden' : undefined}
                  aria-hidden={showOpening || undefined}
                >
                  {children}
                </div>
                {showOpening ? (
                  <div
                    className="absolute inset-0 z-10 min-h-[16rem] bg-gray-50"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <AdminRouteLoading
                      label={`Opening ${title.toLowerCase()}…`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })()}
        </main>
      </div>
      <BillingRenewModal />
    </div>
  );
}
