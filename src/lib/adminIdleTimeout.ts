/**
 * Signed-in idle auto-logout (client-side), including the public homepage.
 * Wall-clock: time the computer is off or asleep counts. A fresh page load
 * must read this stamp before any focus/mousemove can move it forward.
 * Does not change JWT TTLs — it ends the session after no UI activity.
 */

/** 30 minutes without pointer/keyboard/scroll/nav activity → sign out. */
export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Soft warning toast this long before timeout (once per idle stretch). */
export const ADMIN_IDLE_WARN_BEFORE_MS = 2 * 60 * 1000;

/** Cross-tab last-activity timestamp (ms since epoch). */
export const ADMIN_IDLE_ACTIVITY_STORAGE_KEY = "fecsync-admin-last-activity";

/** Sign-in page can show a one-shot notice when this is set. */
export const ADMIN_IDLE_LOGOUT_FLAG_KEY = "fecsync-admin-idle-logout";

/** In-memory fallback when localStorage is blocked (InPrivate / quota). */
let memoryLastActivityAt = 0;

/**
 * Sticky for this page load. Set when the stored stamp is already past the
 * idle limit so cookie hydrate cannot paint the account chip again.
 * Cleared only by a real sign-in on this document.
 */
let idleLogoutLatched = false;

export function isIdleLogoutLatched(): boolean {
  return idleLogoutLatched;
}

export function latchIdleLogout(): void {
  idleLogoutLatched = true;
}

/** Call immediately before setUser on a real sign-in / registration. */
export function releaseIdleLogoutLatch(): void {
  idleLogoutLatched = false;
}

/** Persisted activity time, or null if this browser has never recorded one. */
export function readStoredAdminLastActivityAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ADMIN_IDLE_ACTIVITY_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* private mode */
  }
  return memoryLastActivityAt > 0 ? memoryLastActivityAt : null;
}

/**
 * True when this browser's last real UI activity is at least 30 minutes ago,
 * including time the computer was shut down. Missing stamp is not expired
 * (a brand-new sign-in records one). A latch stays expired until sign-in.
 */
export function isSessionIdleExpired(now = Date.now()): boolean {
  if (idleLogoutLatched) return true;
  const last = readStoredAdminLastActivityAt();
  if (last == null) return false;
  return now - last >= ADMIN_IDLE_TIMEOUT_MS;
}

/**
 * Cold start: expired stamp, or a saved sign-in that never recorded activity
 * (homepage used to skip the idle clock). A normal sign-in always writes a stamp.
 */
export function shouldExpirePersistedSessionOnBoot(): boolean {
  if (typeof window === "undefined") return false;
  if (isSessionIdleExpired()) return true;
  if (readStoredAdminLastActivityAt() != null) return false;
  try {
    const snap = localStorage.getItem("auth-snapshot");
    if (snap) {
      const parsed = JSON.parse(snap) as {
        isAuthenticated?: boolean;
        user?: unknown;
      };
      if (parsed?.isAuthenticated && parsed.user) return true;
    }
    const store = localStorage.getItem("auth-store");
    if (store) {
      const parsed = JSON.parse(store) as { state?: { user?: unknown } };
      if (parsed?.state?.user) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function readAdminLastActivityAt(): number {
  return readStoredAdminLastActivityAt() ?? Date.now();
}

export function touchAdminLastActivity(at = Date.now()): void {
  if (idleLogoutLatched) return;
  memoryLastActivityAt = at;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ADMIN_IDLE_ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    /* private mode / quota — memory stamp still advances */
  }
}

/** Apply another tab's activity stamp without re-writing localStorage (no loop). */
export function adoptAdminLastActivityFromPeer(at: number): void {
  if (!Number.isFinite(at) || at <= 0) return;
  if (at > memoryLastActivityAt) memoryLastActivityAt = at;
}

/**
 * Seed the clock only when empty. Never reset an in-progress idle stretch
 * (e.g. React effect remount / Fast Refresh).
 */
export function ensureAdminLastActivitySeeded(at = Date.now()): void {
  if (idleLogoutLatched) return;
  if (memoryLastActivityAt > 0) return;
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(ADMIN_IDLE_ACTIVITY_STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) {
        memoryLastActivityAt = n;
        return;
      }
    } catch {
      /* ignore */
    }
  }
  touchAdminLastActivity(at);
}

export function clearAdminIdleMarkers(): void {
  memoryLastActivityAt = 0;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ADMIN_IDLE_ACTIVITY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function markAdminIdleLogoutNotice(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ADMIN_IDLE_LOGOUT_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function consumeAdminIdleLogoutNotice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const hit = sessionStorage.getItem(ADMIN_IDLE_LOGOUT_FLAG_KEY) === "1";
    if (hit) sessionStorage.removeItem(ADMIN_IDLE_LOGOUT_FLAG_KEY);
    return hit;
  } catch {
    return false;
  }
}
