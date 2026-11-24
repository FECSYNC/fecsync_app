"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { clearPersistedAuthStorage, useAuthStore } from "@/store/authStore";
import {
  broadcastClientSyncTick,
  clearHttpCaches,
  clearLegacySessionStorage,
  clearServerSessionQuietly,
  dispatchClientSyncEvent,
  fetchClientSyncPayload,
  readStoredClientSyncState,
  reconcileClientAuthSession,
  resolveClientSyncMode,
  unregisterServiceWorkers,
  writeStoredClientSyncState,
  type ClientSyncMode,
} from "@/lib/clientSync";
import type { ClientSyncPayload } from "@/lib/clientSync/constants";

const FOCUS_DEBOUNCE_MS = 800;
const DEV_POLL_MS = 45_000;

/** Auth surfaces — never fight /api/auth/login compile with client-sync polls. */
function isAuthSurfacePath(pathname: string): boolean {
  const p =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return (
    p === "/signin" ||
    p === "/signup" ||
    p === "/register-company" ||
    p === "/verify-email" ||
    p === "/forgot-password" ||
    p === "/reset-password" ||
    p === "/company-pending" ||
    p.startsWith("/signin/") ||
    p.startsWith("/register-company/")
  );
}

let syncInFlight: Promise<void> | null = null;

async function applyClientSync(
  mode: ClientSyncMode,
  server: ClientSyncPayload,
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>
): Promise<void> {
  await unregisterServiceWorkers();
  await clearHttpCaches();

  if (mode === "hard") {
    await clearServerSessionQuietly();
    clearLegacySessionStorage();
    clearPersistedAuthStorage({ broadcast: false });
    useAuthStore.getState().clearAuth();
    queryClient.clear();
  } else {
    // Mark stale only — do NOT refetch every active admin list (that made
    // every table wait on remote DB again after each soft sync / tab focus).
    await queryClient.invalidateQueries({ refetchType: "none" });
    reconcileClientAuthSession();
  }

  writeStoredClientSyncState({
    syncVersion: server.syncVersion,
    devEpoch: server.devEpoch,
  });

  dispatchClientSyncEvent(mode);
  broadcastClientSyncTick(mode);
  // Hard sync only — soft refresh fights in-flight client navigations (navbar "Opening…").
  if (mode === "hard") {
    router.refresh();
  }
}

async function runClientSync(
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>,
  force = false
): Promise<void> {
  if (typeof window !== "undefined" && isAuthSurfacePath(window.location.pathname)) {
    return;
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const server = await fetchClientSyncPayload();
    if (!server) return;

    const stored = readStoredClientSyncState();
    const mode = force ? ("soft" as const) : resolveClientSyncMode(stored, server);
    if (!mode) {
      writeStoredClientSyncState({
        syncVersion: server.syncVersion,
        devEpoch: server.devEpoch,
      });
      return;
    }

    await applyClientSync(mode, server, queryClient, router);
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

/**
 * Keeps the browser in sync with the running server automatically.
 * - Hard sync when NEXT_PUBLIC_CLIENT_SYNC_VERSION changes (migrations).
 * - Soft sync when the dev server restarts or you return to the tab.
 */
export default function ClientSyncBootstrap() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void runClientSync(queryClient, router);

    const onFocus = () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => {
        void runClientSync(queryClient, router);
      }, FOCUS_DEBOUNCE_MS);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "harewa-client-sync-tick" || !event.newValue) return;
      try {
        const tick = JSON.parse(event.newValue) as { mode?: ClientSyncMode };
        if (tick.mode === "hard") {
          void runClientSync(queryClient, router, true);
        } else {
          void queryClient.invalidateQueries({ refetchType: "none" });
          reconcileClientAuthSession();
        }
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);

    const poll =
      process.env.NODE_ENV === "development"
        ? setInterval(() => {
            void runClientSync(queryClient, router);
          }, DEV_POLL_MS)
        : null;

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      if (poll) clearInterval(poll);
    };
  }, [queryClient, router]);

  return null;
}
