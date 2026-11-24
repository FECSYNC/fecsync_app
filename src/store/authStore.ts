// src/store/authStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getMe,
  logoutServer,
  normalizeSessionUser,
  refreshSessionAuthz,
  type UserProfile,
} from "@/services/auth";
import { sessionCan, sessionIsStaff } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import {
  COMPANY_BILLING_SESSION_SYNC_KEY,
  COMPANY_PROFILE_SESSION_SYNC_KEY,
  clearCompanySaasSessionSyncStorage,
  orgBillingFingerprint,
} from "@/utils/orgSaasSessionSync";
import {
  clearAdminIdleMarkers,
  isIdleLogoutLatched,
  isSessionIdleExpired,
  latchIdleLogout,
  markAdminIdleLogoutNotice,
  releaseIdleLogoutLatch,
  shouldExpirePersistedSessionOnBoot,
  touchAdminLastActivity,
} from "@/lib/adminIdleTimeout";

type User = UserProfile;
type SessionUserInput = Parameters<typeof normalizeSessionUser>[0];

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  emailForVerification: string;

  // UI gating flags
  hasHydratedAuth: boolean;
  hasClientHydrated: boolean;

  login: (user: SessionUserInput, _token?: string) => void;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
  clearAuth: () => void;
  setEmailForVerification: (email: string) => void;
  setUser: (user: SessionUserInput, storage?: "localStorage" | "sessionStorage") => void;
  hydrateFromCookie: () => Promise<void>;
  silentRefresh: (opts?: { force?: boolean }) => Promise<boolean>;
  startRefreshTimer: () => void;
  stopRefreshTimer: () => void;
  can: (permission: Permission | string) => boolean;
  isStaff: () => boolean;
}

let refreshIntervalId: NodeJS.Timeout | null = null;
let refreshRetryCount = 0;
const MAX_RETRY_COUNT = 3;
/** Bumps on login/logout so in-flight refresh/logout from a prior session cannot wipe a fresh login. */
let authGeneration = 0;
/**
 * Remount / focus / AdminLayout+AuthBootstrap can all call silentRefresh within
 * seconds. Under Turbopack cold-compile that stacks into refresh+/me stampede
 * and client timeouts. Coalesce successful refreshes; force bypasses.
 * Inflight lives on globalThis so Fast Refresh cannot start a second flight.
 */
type SilentRefreshGlobal = typeof globalThis & {
  __fecsyncSilentRefreshPromise?: Promise<boolean> | null;
  __fecsyncHydrateCookiePromise?: Promise<void> | null;
};
function silentRefreshSlot(): SilentRefreshGlobal {
  return globalThis as SilentRefreshGlobal;
}
let lastSilentRefreshOkAt = 0;
const SILENT_REFRESH_COALESCE_MS =
  process.env.NODE_ENV === "development" ? 45_000 : 30_000;

/** Other tabs listen for this key to drop stale persisted auth. */
export const AUTH_LOGOUT_BROADCAST_KEY = "harewa-auth-logout";

const AUTH_PERSIST_KEYS = ["auth-store", "auth-snapshot", "user"] as const;

function bumpAuthGeneration() {
  authGeneration += 1;
  return authGeneration;
}

/** Drop every client auth cache (Zustand persist + legacy keys). */
export function clearPersistedAuthStorage(options?: { broadcast?: boolean }) {
  if (typeof window === "undefined") return;
  for (const key of AUTH_PERSIST_KEYS) {
    localStorage.removeItem(key);
  }
  sessionStorage.removeItem("user");
  clearCompanySaasSessionSyncStorage();
  try {
    useAuthStore.persist.clearStorage();
  } catch {
    /* persist middleware not ready yet */
  }
  if (options?.broadcast !== false) {
    try {
      localStorage.setItem(AUTH_LOGOUT_BROADCAST_KEY, String(Date.now()));
    } catch {
      /* ignore quota errors */
    }
  }
}

/** Drop the signed-in UI before cookie hydrate can paint it again. */
function applyIdleSessionExpiry(): void {
  if (!isIdleLogoutLatched()) {
    latchIdleLogout();
    markAdminIdleLogoutNotice();
  }
  clearPersistedAuthStorage({ broadcast: false });
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    emailForVerification: "",
    hasHydratedAuth: true,
    hasClientHydrated: true,
  });
}

export async function logoutForIdle(): Promise<void> {
  applyIdleSessionExpiry();
  try {
    await useAuthStore.getState().logout();
  } finally {
    // Keep the stamp until cookies are cleared so a refresh mid-logout still
    // sees the expired clock. A sign-in releases the latch and writes a new stamp.
    if (isIdleLogoutLatched()) clearAdminIdleMarkers();
  }
}

function persistSessionSnapshot(user: User | null, isAuthenticated: boolean) {
  if (typeof window === "undefined") return;
  if (user && isAuthenticated) {
    localStorage.setItem(
      "auth-snapshot",
      JSON.stringify({ user, isAuthenticated: true })
    );
    return;
  }
  localStorage.removeItem("auth-snapshot");
}

/**
 * Sync read of the last logged-in session (hard refresh / first paint).
 * Does not touch React state — callers seed the store when needed.
 */
export function peekAuthSnapshotUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("auth-snapshot");
    if (!raw) return null;
    const cached = JSON.parse(raw) as {
      isAuthenticated?: boolean;
      user?: SessionUserInput | null;
    };
    if (!cached?.isAuthenticated || !cached.user) return null;
    return normalizeSessionUser(cached.user);
  } catch {
    return null;
  }
}

/** Fallback: Zustand persist blob (`auth-store`) when auth-snapshot is missing. */
function peekPersistedZustandUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("auth-store");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: { user?: SessionUserInput | null; isAuthenticated?: boolean };
    };
    const user = parsed?.state?.user;
    if (!user) return null;
    // Prefer explicit isAuthenticated when present; otherwise accept user object.
    if (
      parsed.state?.isAuthenticated === false &&
      !localStorage.getItem("auth-snapshot")
    ) {
      return null;
    }
    return normalizeSessionUser(user);
  } catch {
    return null;
  }
}

/**
 * Seed Zustand from auth-snapshot (or persist) before first paint.
 * Marks hasHydratedAuth so staff/admin gates open immediately; AuthBootstrap
 * still verifies cookies in the background.
 */
export function seedAuthStoreFromSnapshot(): User | null {
  if (typeof window === "undefined") return null;
  if (isIdleLogoutLatched() || isSessionIdleExpired()) return null;
  const state = useAuthStore.getState();
  if (state.user) {
    if (!state.hasClientHydrated || !state.hasHydratedAuth) {
      useAuthStore.setState({
        hasClientHydrated: true,
        hasHydratedAuth: true,
        isAuthenticated: true,
      });
    }
    return state.user;
  }
  const peeked = peekAuthSnapshotUser() ?? peekPersistedZustandUser();
  if (!peeked) return null;
  useAuthStore.setState({
    user: peeked,
    isAuthenticated: true,
    hasClientHydrated: true,
    hasHydratedAuth: true,
  });
  return peeked;
}

/** Idempotent client entry — restore staff/admin identity before UI gates. */
export function ensureClientAuthSeeded(): User | null {
  return seedAuthStoreFromSnapshot();
}

function broadcastCompanyBillingSession(user: {
  orgStatus?: string | null;
  subscriptionPlan?: string | null;
  requestedPlan?: string | null;
  requestedDurationMonths?: number | null;
  subscriptionInterval?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: string | null;
  billingSoftHold?: boolean | null;
  billingGraceEndsAt?: string | null;
  accountSuspended?: boolean | null;
  enterpriseHqEnabled?: boolean | null;
} | null) {
  if (typeof window === "undefined" || !user) return;
  try {
    localStorage.setItem(
      COMPANY_BILLING_SESSION_SYNC_KEY,
      JSON.stringify({
        orgStatus: user.orgStatus ?? null,
        subscriptionPlan: user.subscriptionPlan ?? null,
        subscriptionStatus: user.subscriptionStatus ?? null,
        subscriptionEndsAt: user.subscriptionEndsAt ?? null,
        billingSoftHold: user.billingSoftHold === true,
        billingGraceEndsAt: user.billingGraceEndsAt ?? null,
        accountSuspended: user.accountSuspended === true,
        enterpriseHqEnabled: user.enterpriseHqEnabled === true,
        t: Date.now(),
      })
    );
  } catch {
    /* ignore quota */
  }
}

if (typeof window !== "undefined") {
  const w = window as Window & {
    __harewaCompanyProfileSessionListener?: boolean;
    __harewaCompanyBillingSessionListener?: boolean;
  };
  if (!w.__harewaCompanyProfileSessionListener) {
    w.__harewaCompanyProfileSessionListener = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== COMPANY_PROFILE_SESSION_SYNC_KEY || !event.newValue) {
        return;
      }
      try {
        const patch = JSON.parse(event.newValue) as {
          legalName?: string | null;
          tradingName?: string | null;
          companyDisplayName?: string | null;
          profileCompleteness?: number | null;
          hasLogo?: boolean;
          companyLogoUrl?: string | null;
          organizationSlug?: string | null;
        };
        const current = useAuthStore.getState().user;
        if (!current) return;
        useAuthStore.getState().updateUser({
          legalName: patch.legalName ?? null,
          tradingName: patch.tradingName ?? null,
          companyDisplayName: patch.companyDisplayName ?? null,
          profileCompleteness: patch.profileCompleteness,
          hasLogo: patch.hasLogo,
          ...(patch.companyLogoUrl !== undefined
            ? { companyLogoUrl: patch.companyLogoUrl }
            : {}),
          ...(patch.organizationSlug !== undefined
            ? { organizationSlug: patch.organizationSlug }
            : {}),
        });
      } catch {
        /* ignore malformed broadcast */
      }
    });
  }
  if (!w.__harewaCompanyBillingSessionListener) {
    w.__harewaCompanyBillingSessionListener = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== COMPANY_BILLING_SESSION_SYNC_KEY || !event.newValue) {
        return;
      }
      try {
        const patch = JSON.parse(event.newValue) as {
          orgStatus?: string | null;
          subscriptionPlan?: string | null;
          subscriptionStatus?: string | null;
          subscriptionEndsAt?: string | null;
          billingSoftHold?: boolean | null;
          billingGraceEndsAt?: string | null;
          accountSuspended?: boolean | null;
          enterpriseHqEnabled?: boolean | null;
        };
        const current = useAuthStore.getState().user;
        if (!current) return;
        const next = {
          orgStatus: patch.orgStatus ?? null,
          subscriptionPlan: patch.subscriptionPlan ?? null,
          subscriptionStatus: patch.subscriptionStatus ?? null,
          subscriptionEndsAt: patch.subscriptionEndsAt ?? null,
          billingSoftHold: patch.billingSoftHold === true,
          billingGraceEndsAt: patch.billingGraceEndsAt ?? null,
          accountSuspended: patch.accountSuspended === true,
          enterpriseHqEnabled: patch.enterpriseHqEnabled === true,
        };
        if (
          orgBillingFingerprint(current) === orgBillingFingerprint(next)
        ) {
          return;
        }
        useAuthStore.getState().updateUser(next);
      } catch {
        /* ignore malformed broadcast */
      }
    });
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      emailForVerification: "",

      hasHydratedAuth: false,
      hasClientHydrated: false,

      login: (user) => {
        releaseIdleLogoutLatch();
        touchAdminLastActivity();
        bumpAuthGeneration();
        const sessionUser = normalizeSessionUser(user);
        set({
          user: sessionUser,
          isAuthenticated: true,
          isLoading: false,
          hasHydratedAuth: true,
          hasClientHydrated: true,
        });
        
        // Reset retry count on successful login
        refreshRetryCount = 0;
        
        persistSessionSnapshot(sessionUser, true);
        
        // Start proactive token refresh
        get().startRefreshTimer();
        
        // Trigger cart merge after login
        if (typeof window !== 'undefined') {
          // Cart merge is now handled by CartHydration component with React Query
          // No manual merge needed here
        }
      },

      logout: async () => {
        const gen = bumpAuthGeneration();
        get().stopRefreshTimer();
        refreshRetryCount = 0;
        lastSilentRefreshOkAt = 0;
        const slot = silentRefreshSlot();
        slot.__fecsyncSilentRefreshPromise = null;
        slot.__fecsyncHydrateCookiePromise = null;

        // Optimistic UI clear first so the landing header drops the profile chip
        // immediately (do not wait on network / audit / dynamic imports).
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          emailForVerification: "",
          hasHydratedAuth: true,
          hasClientHydrated: true,
        });
        if (typeof window !== "undefined") {
          persistSessionSnapshot(null, false);
          clearPersistedAuthStorage();
        }

        // Clear HttpOnly cookies — short timeout so a hung DB audit cannot stall.
        await logoutServer().catch(() => undefined);
        if (gen !== authGeneration) return;

        // Invalidate any silentRefresh/getMe that raced while cookies were still
        // valid and would otherwise rewrite auth-snapshot after we cleared it.
        bumpAuthGeneration();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          emailForVerification: "",
          hasHydratedAuth: true,
          hasClientHydrated: true,
        });
        if (typeof window !== "undefined") {
          persistSessionSnapshot(null, false);
          clearPersistedAuthStorage({ broadcast: false });
        }

        // Side-effect cleanup must not block navigation.
        if (typeof window !== "undefined") {
          void (async () => {
            try {
              const { useCartStore } = await import("@/store/cartStore");
              useCartStore.getState().clearCart();
            } catch (error) {
              console.warn("Failed to clear cart on logout:", error);
            }
            try {
              const { getAppQueryClient } = await import("@/lib/appQueryClient");
              const { clearUserQueries } = await import(
                "@/utils/clearUserQueries"
              );
              const qc = getAppQueryClient();
              if (qc) clearUserQueries(qc);
            } catch {
              /* ignore */
            }
            try {
              const { clearFashionChatSession } = await import(
                "@/services/fashionChat"
              );
              clearFashionChatSession();
            } catch {
              try {
                localStorage.removeItem("harewa_fashion_chat_session");
                localStorage.removeItem("harewa_fashion_chat_contact");
                localStorage.removeItem("harewa_fashion_chat_messages");
              } catch {
                /* ignore */
              }
            }
          })();
        }
      },

      updateUser: (userData) =>
        set((state) => {
          const user = state.user
            ? normalizeSessionUser({ ...state.user, ...userData })
            : null;
          persistSessionSnapshot(user, Boolean(user));
          return { user };
        }),

      setLoading: (loading) => set({ isLoading: loading }),

      clearAuth: () => {
        bumpAuthGeneration();
        get().stopRefreshTimer();
        refreshRetryCount = 0;
        lastSilentRefreshOkAt = 0;
        const slot = silentRefreshSlot();
        slot.__fecsyncSilentRefreshPromise = null;
        slot.__fecsyncHydrateCookiePromise = null;
        
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          emailForVerification: "",
          hasHydratedAuth: true,
          hasClientHydrated: true,
        });
        persistSessionSnapshot(null, false);
        if (typeof window !== "undefined") {
          clearPersistedAuthStorage({ broadcast: false });
        }
      },

      setEmailForVerification: (email) => set({ emailForVerification: email }),

      setUser: (user, storage = "localStorage") => {
        if (isIdleLogoutLatched()) return;
        const loggingIn = !get().user;
        bumpAuthGeneration();
        const beforeFp = orgBillingFingerprint(get().user);
        const sessionUser = normalizeSessionUser(user);
        set({ user: sessionUser, isAuthenticated: true, hasHydratedAuth: true, hasClientHydrated: true });
        
        // Reset retry count
        refreshRetryCount = 0;
        
        if (typeof window !== "undefined") {
          const data = JSON.stringify(sessionUser);
          if (storage === "localStorage") {
            localStorage.setItem("user", data);
          } else {
            sessionStorage.setItem("user", data);
          }
          persistSessionSnapshot(sessionUser, true);
          if (loggingIn) touchAdminLastActivity();
          
          // Start proactive token refresh
          get().startRefreshTimer();

          if (beforeFp !== orgBillingFingerprint(sessionUser)) {
            broadcastCompanyBillingSession(sessionUser);
          }
          
          // Cart merge is now handled by CartHydration component with React Query
          // No manual merge needed here
        }
      },

      silentRefresh: async (opts) => {
        if (typeof window === "undefined") return false;
        if (isIdleLogoutLatched()) return false;
        if (isSessionIdleExpired()) {
          await logoutForIdle();
          return false;
        }
        const force = opts?.force === true;
        if (
          !force &&
          lastSilentRefreshOkAt > 0 &&
          Date.now() - lastSilentRefreshOkAt < SILENT_REFRESH_COALESCE_MS
        ) {
          return true;
        }
        const slot = silentRefreshSlot();
        if (slot.__fecsyncSilentRefreshPromise) {
          return slot.__fecsyncSilentRefreshPromise;
        }

        const gen = authGeneration;
        slot.__fecsyncSilentRefreshPromise = (async () => {
        try {
          // Refresh HttpOnly access cookie from Membership, then hydrate UI.
          let user;
          try {
            ({ user } = await refreshSessionAuthz());
          } catch (refreshErr: unknown) {
            if (gen !== authGeneration) return false;
            const status =
              typeof refreshErr === "object" &&
              refreshErr !== null &&
              "status" in refreshErr
                ? Number((refreshErr as { status?: unknown }).status)
                : 0;
            const message =
              refreshErr instanceof Error
                ? refreshErr.message.toLowerCase()
                : "";
            const errPayload =
              typeof refreshErr === "object" &&
              refreshErr !== null &&
              "payload" in refreshErr
                ? (refreshErr as { payload?: { code?: unknown } }).payload
                : undefined;
            const revoked =
              errPayload?.code === "SESSION_REVOKED" ||
              message.includes("session revoked");
            const refreshReuse =
              errPayload?.code === "REFRESH_REUSE" ||
              // Legacy servers returned this text for parallel JTI races.
              (status === 401 && message.includes("session expired"));
            // Truly empty / missing cookies — guest or cleared session.
            // Do NOT hard-miss on "session expired" / REFRESH_REUSE: a parallel
            // refresh often already rotated cookies; /me still returns 200.
            // Hard-logout there was kicking active admins mid-dashboard.
            const hardMiss =
              status === 401 &&
              !refreshReuse &&
              (message.includes("no refresh token") ||
                message.includes("no access token") ||
                message.includes("invalid or expired refresh token"));
            if (hardMiss || revoked) {
              if (!get().isAuthenticated) return false;
              if (gen !== authGeneration) return false;
              await get().logout();
              return false;
            }
            // Prefer /me over an immediate logout on refresh 401 — another
            // in-flight refresh may have rotated cookies. If /me also 401s,
            // logout (do not keep a stale snapshot).
            if (status === 401 || status === 403 || status === 0) {
              try {
                ({ user } = await getMe());
              } catch (meErr: unknown) {
                const meStatus =
                  typeof meErr === "object" &&
                  meErr !== null &&
                  "status" in meErr
                    ? Number((meErr as { status?: unknown }).status)
                    : 0;
                if (meStatus === 401 || meStatus === 403) {
                  // Refresh and /me both failed — cookies are dead. Always clear
                  // the optimistic snapshot so AdminLayout can send the user to
                  // /signin?returnTo=…. Keeping on jtiRace trapped expired
                  // sessions behind a painted admin shell with no login UI.
                  if (!get().isAuthenticated) return false;
                  if (gen !== authGeneration) return false;
                  await get().logout();
                  return false;
                }
                // Network/timeout — keep optimistic session.
                console.warn(
                  "[Auth] Silent refresh fell back; keeping session:",
                  refreshErr instanceof Error
                    ? refreshErr.message
                    : "refresh failed"
                );
                return false;
              }
            } else {
              throw refreshErr;
            }
          }
          if (gen !== authGeneration) return false;
          // Logout cleared the session while this refresh was in flight — do not
          // resurrect profile UI / auth-snapshot on the landing page.
          if (!get().isAuthenticated && get().user == null) {
            return false;
          }
          const beforeFp = orgBillingFingerprint(get().user);
          const sessionUser = normalizeSessionUser(user);
          set({
            user: sessionUser,
            isAuthenticated: true,
            hasHydratedAuth: true,
          });
          persistSessionSnapshot(sessionUser, true);
          if (beforeFp !== orgBillingFingerprint(sessionUser)) {
            broadcastCompanyBillingSession(sessionUser);
          }
          
          // Reset retry count on success
          refreshRetryCount = 0;
          lastSilentRefreshOkAt = Date.now();
          return true;
        } catch (error: any) {
          if (gen !== authGeneration) return false;
          const status = error?.status;
          
          // IMPORTANT: Only logout on definitive auth failures (401/403)
          if (status === 401 || status === 403) {
            if (!get().isAuthenticated) return false;
            await get().logout();
            return false;
          }
          
          console.warn('[Auth] Silent refresh failed (will retry):', error.message || 'Network error');
          return false;
        }
        })().finally(() => {
          silentRefreshSlot().__fecsyncSilentRefreshPromise = null;
        });
        return slot.__fecsyncSilentRefreshPromise;
      },

      startRefreshTimer: () => {
        if (typeof window === "undefined") return;
        
        // Clear existing timer if any
        if (refreshIntervalId) {
          clearInterval(refreshIntervalId);
        }
        
        // Refresh token every 10 minutes 
        const REFRESH_INTERVAL = 10 * 60 * 1000;
        
        refreshIntervalId = setInterval(async () => {
          const state = get();
          if (state.isAuthenticated) {
            try {
              const success = await state.silentRefresh();
              
              if (success) {
                refreshRetryCount = 0;
              } else if (!get().isAuthenticated) {
                // silentRefresh already logged out on a definitive 401/403.
                refreshRetryCount = 0;
              } else {
                // Transient network / DB lag — keep the session; do not force logout.
                refreshRetryCount++;
                console.warn(
                  `[Auth] Refresh failed (attempt ${refreshRetryCount}/${MAX_RETRY_COUNT}); keeping session`
                );
                if (refreshRetryCount >= MAX_RETRY_COUNT) {
                  refreshRetryCount = 0;
                }
              }
            } catch (error) {
              refreshRetryCount++;
              console.warn(
                `[Auth] Refresh error (attempt ${refreshRetryCount}/${MAX_RETRY_COUNT}):`,
                error
              );
              if (refreshRetryCount >= MAX_RETRY_COUNT) {
                refreshRetryCount = 0;
              }
            }
          }
        }, REFRESH_INTERVAL);
        
        //console.log('[Auth] Proactive refresh timer started (5min interval)');
      },

      stopRefreshTimer: () => {
        if (refreshIntervalId) {
          clearInterval(refreshIntervalId);
          refreshIntervalId = null;
          //console.log('[Auth] Proactive refresh timer stopped');
        }
      },

      hydrateFromCookie: async () => {
        if (typeof window === "undefined") return;
        if (isIdleLogoutLatched()) return;
        if (isSessionIdleExpired()) {
          await logoutForIdle();
          return;
        }
        const slot = silentRefreshSlot();
        if (slot.__fecsyncHydrateCookiePromise) {
          return slot.__fecsyncHydrateCookiePromise;
        }

        const gen = authGeneration;
        // Admin hard-refresh must not resolve "hydrated" from a stale snapshot
        // while cookies are dead — that left AdminLayout on Restoring forever.
        const proveCookies =
          window.location.pathname.startsWith("/admin") ||
          window.location.pathname.startsWith("/tailor");

        slot.__fecsyncHydrateCookiePromise = (async () => {
        const snapshot = localStorage.getItem('auth-snapshot');
        if (snapshot) {
          try {
            const cached = JSON.parse(snapshot);
            if (cached.user && cached.isAuthenticated) {
              const sessionUser = normalizeSessionUser(cached.user);
              persistSessionSnapshot(sessionUser, true);
              // Optimistic UI from cache — mark hydrated so storefront header
              // shows the account immediately while refresh runs in background.
              set({ 
                user: sessionUser, 
                isAuthenticated: true, 
                hasClientHydrated: true,
                hasHydratedAuth: true,
              });
              
              // Reset retry count
              refreshRetryCount = 0;

              if (proveCookies) {
                const ok = await get().silentRefresh({ force: true });
                if (gen !== authGeneration) return;
                if (ok) {
                  get().startRefreshTimer();
                  return;
                }
                // Only clear when logout already ran (no user). Soft refresh
                // failures that kept the session must not wipe an active admin.
                if (!get().user || !get().isAuthenticated) {
                  clearPersistedAuthStorage({ broadcast: false });
                  set({
                    user: null,
                    isAuthenticated: false,
                    hasHydratedAuth: true,
                    hasClientHydrated: true,
                  });
                  persistSessionSnapshot(null, false);
                } else {
                  get().startRefreshTimer();
                }
                return;
              }

              // Storefront: refresh in the background — never block UI/nav.
              void (async () => {
                const ok = await get().silentRefresh();
                if (gen !== authGeneration) return;
                if (ok) {
                  get().startRefreshTimer();
                  return;
                }
                // soft-network keep may still have a user; only timer-retry then.
                // Definitive expiry already cleared user via logout().
                if (get().user) {
                  get().startRefreshTimer();
                }
              })();
              return;
            }
          } catch {
            console.warn('[Auth] Invalid cached snapshot');
          }
        }

        try {
          const { user } = await getMe();
          if (gen !== authGeneration) return;
          const sessionUser = normalizeSessionUser(user);
          persistSessionSnapshot(sessionUser, true);
          set({ user: sessionUser, isAuthenticated: true, hasHydratedAuth: true });
          
          // Reset retry count
          refreshRetryCount = 0;
          
          // Start proactive token refresh
          get().startRefreshTimer();
          
          // Cart merge is now handled by CartHydration component with React Query
          // No manual merge needed here
        } catch (error: any) {
          if (gen !== authGeneration) return;
          if (error?.status !== 401 && error?.status !== 403) {
            console.warn('[Auth] Hydration failed:', error.message);
          }
          clearPersistedAuthStorage({ broadcast: false });
          set({ user: null, isAuthenticated: false, hasHydratedAuth: true });
          persistSessionSnapshot(null, false);
        }
        })().finally(() => {
          silentRefreshSlot().__fecsyncHydrateCookiePromise = null;
        });
        return slot.__fecsyncHydrateCookiePromise;
      },

      can: (permission) => sessionCan(get().user, permission),
      isStaff: () => sessionIsStaff(get().user),
    }),
    {
      name: "auth-store",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        emailForVerification: state.emailForVerification,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AuthState> | undefined;
        const rawUser = persisted?.user ?? currentState.user;
        return {
          ...currentState,
          ...persisted,
          user: rawUser ? normalizeSessionUser(rawUser) : null,
        };
      },
      onRehydrateStorage: () => {
        // Finish callback can run *inside* create() before `useAuthStore` is
        // assigned — never touch `useAuthStore` synchronously here (TDZ crash
        // wiped staff session and flashed "Opening admin workspace…").
        return (state, error) => {
          if (error) {
            console.error("[Auth] Rehydration error:", error);
          }

          const persistedUser = state?.user
            ? normalizeSessionUser(state.user)
            : null;
          const logged = Boolean(persistedUser);

          queueMicrotask(() => {
            if (isIdleLogoutLatched() || isSessionIdleExpired()) {
              void logoutForIdle();
              return;
            }

            const current = useAuthStore.getState();
            const user = current.user
              ? normalizeSessionUser(current.user)
              : persistedUser;
            const snapshot =
              typeof window !== "undefined"
                ? localStorage.getItem("auth-snapshot")
                : null;

            if (logged && !snapshot) {
              clearPersistedAuthStorage({ broadcast: false });
              useAuthStore.setState({
                user: null,
                isAuthenticated: false,
                hasClientHydrated: true,
                hasHydratedAuth: true,
              });
              void useAuthStore.getState().hydrateFromCookie();
              return;
            }

            const fromSnap =
              !user && typeof window !== "undefined"
                ? peekAuthSnapshotUser() ?? peekPersistedZustandUser()
                : null;
            const nextUser = user ?? fromSnap;

            useAuthStore.setState({
              user: nextUser,
              hasClientHydrated: true,
              hasHydratedAuth: true,
              isAuthenticated: Boolean(nextUser),
            });

            if (nextUser) {
              void useAuthStore.getState().hydrateFromCookie();
            }
          });
        };
      },
      skipHydration: false,
    }
  )
);

// Restore staff/admin session as soon as this module loads on the client.
// Idle expiry runs first so a shutdown longer than 30 minutes cannot paint
// the homepage account chip from the saved snapshot.
if (typeof window !== "undefined") {
  try {
    if (shouldExpirePersistedSessionOnBoot()) {
      void logoutForIdle();
    } else {
      seedAuthStoreFromSnapshot();
    }
  } catch {
    /* ignore corrupt storage */
  }
}
