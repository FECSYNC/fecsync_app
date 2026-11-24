import {
  CLIENT_SYNC_STORAGE_KEY,
  LEGACY_SESSION_STORAGE_KEYS,
  type ClientSyncMode,
  type ClientSyncPayload,
  type ClientSyncState,
} from "./constants";

export function readStoredClientSyncState(): ClientSyncState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CLIENT_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientSyncState;
    if (typeof parsed.syncVersion !== "string") return null;
    return {
      syncVersion: parsed.syncVersion,
      devEpoch:
        parsed.devEpoch === null || typeof parsed.devEpoch === "string"
          ? parsed.devEpoch
          : null,
    };
  } catch {
    return null;
  }
}

export function writeStoredClientSyncState(state: ClientSyncState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLIENT_SYNC_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

export function resolveClientSyncMode(
  stored: ClientSyncState | null,
  server: ClientSyncPayload
): ClientSyncMode | null {
  if (!stored) return "soft";

  if (stored.syncVersion !== server.syncVersion) {
    return "hard";
  }

  if (
    server.isDev &&
    server.devEpoch &&
    stored.devEpoch !== server.devEpoch
  ) {
    return "soft";
  }

  return null;
}

export async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    /* ignore */
  }
}

export async function clearHttpCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* ignore */
  }
}

export function clearLegacySessionStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_SESSION_STORAGE_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

/**
 * Reconcile client auth UI with HttpOnly cookies (no full page reload).
 * Safe to call on tab focus, soft client-sync, and after admin logout.
 */
export function reconcileClientAuthSession(): void {
  if (typeof window === "undefined") return;

  // Dynamic import avoids circular deps at module load; auth store is always ready at runtime.
  void import("@/store/authStore").then((store) => {
    void import("@/lib/adminIdleTimeout").then((idle) => {
      if (idle.isIdleLogoutLatched() || idle.isSessionIdleExpired()) {
        void store.logoutForIdle();
        return;
      }
      reconcileClientAuthSessionNow(store);
    });
  });
}

function reconcileClientAuthSessionNow(store: typeof import("@/store/authStore")): void {
  const { clearPersistedAuthStorage, useAuthStore } = store;
  const snapshot = localStorage.getItem("auth-snapshot");
  const state = useAuthStore.getState();

  if (!snapshot && (state.user || state.isAuthenticated)) {
    clearPersistedAuthStorage({ broadcast: false });
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      hasHydratedAuth: true,
    });
    void state.hydrateFromCookie();
    return;
  }

  if (snapshot || state.user || state.isAuthenticated) {
    void state.hydrateFromCookie();
  } else if (!state.hasHydratedAuth) {
    useAuthStore.setState({
      hasHydratedAuth: true,
      isAuthenticated: false,
      user: null,
    });
  }
}

export async function clearServerSessionQuietly(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    /* still clear client state */
  }
}

export async function fetchClientSyncPayload(): Promise<ClientSyncPayload | null> {
  try {
    const res = await fetch("/api/client-sync", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: ClientSyncPayload;
    };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export function dispatchClientSyncEvent(mode: ClientSyncMode): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("harewa:client-sync", { detail: { mode } })
  );
}

export function broadcastClientSyncTick(mode: ClientSyncMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      "harewa-client-sync-tick",
      JSON.stringify({ mode, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}
