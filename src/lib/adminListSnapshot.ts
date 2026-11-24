import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { peekAuthSnapshotUser, useAuthStore } from "@/store/authStore";
import { ADMIN_LIST_STALE_MS } from "@/lib/adminListCache";

const PREFIX = "fecsync-admin-list:v1:";
const INDEX_KEY = "fecsync-admin-list:v1:index";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Cap stored entries so sessionStorage stays small. */
const MAX_ENTRIES = 48;
/** ~350KB — keep hydrate/parse cheap even with large lists. */
const MAX_ENTRY_BYTES = 350_000;
/** Prefer first N rows when trimming list payloads. */
const TRIM_ROW_CAP = 120;

/** Seed age so hydrate paints instantly but refetchOnMount still soft-refreshes. */
const SNAPSHOT_SEED_AGE_MS = ADMIN_LIST_STALE_MS + 5_000;

type SnapEntry = {
  savedAt: number;
  orgId: string;
  key: string;
  data: unknown;
};

function stableKey(queryKey: QueryKey): string {
  try {
    return JSON.stringify(queryKey);
  } catch {
    return String(queryKey);
  }
}

function storageKey(orgId: string, keyJson: string): string {
  // Keep keys short-ish; hash long JSON
  const slug =
    keyJson.length > 120
      ? `${keyJson.slice(0, 80)}#${simpleHash(keyJson)}`
      : keyJson;
  return `${PREFIX}${orgId}:${slug}`;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readIndex(orgId: string): string[] {
  try {
    const raw = sessionStorage.getItem(`${INDEX_KEY}:${orgId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(orgId: string, keys: string[]): void {
  try {
    sessionStorage.setItem(
      `${INDEX_KEY}:${orgId}`,
      JSON.stringify(keys.slice(-MAX_ENTRIES))
    );
  } catch {
    /* ignore */
  }
}

/**
 * Shrink oversized list payloads so sessionStorage hydrate stays fast.
 * Keeps first TRIM_ROW_CAP items for common `{ items }` / `{ data }` / array shapes.
 */
function trimForSnapshot(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.length > TRIM_ROW_CAP ? data.slice(0, TRIM_ROW_CAP) : data;
  }
  if (typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const next = { ...obj };
  for (const field of ["items", "data", "rows", "results", "venues", "bookings"] as const) {
    const v = next[field];
    if (Array.isArray(v) && v.length > TRIM_ROW_CAP) {
      next[field] = v.slice(0, TRIM_ROW_CAP);
    }
  }
  // Infinite-query pages: keep first page only if pages are huge
  if (Array.isArray(next.pages) && next.pages.length > 1) {
    next.pages = (next.pages as unknown[]).slice(0, 1);
  }
  return next;
}

function serializeSnapEntry(entry: SnapEntry): string | null {
  try {
    let payload = entry.data;
    let json = JSON.stringify({ ...entry, data: payload });
    if (json.length <= MAX_ENTRY_BYTES) return json;
    payload = trimForSnapshot(payload);
    json = JSON.stringify({ ...entry, data: payload });
    if (json.length <= MAX_ENTRY_BYTES) return json;
    // Still too big — skip persist rather than block the main thread on hydrate
    return null;
  } catch {
    return null;
  }
}

/** Only persist list-shaped admin caches (not cart / auth / live bells). */
export function shouldPersistAdminListQuery(queryKey: QueryKey): boolean {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return false;
  const root = String(queryKey[0] ?? "");
  const deny = new Set([
    "cart",
    "wishlist",
    "notifications",
    "auth",
    "profile",
    "me",
    "client-sync",
  ]);
  if (deny.has(root)) return false;
  // Live header bells — keep out of snapshot noise.
  if (root === "orders" && queryKey.includes("admin-bell")) return false;
  if (root === "admin" || root.startsWith("admin")) return true;
  const allow = new Set([
    "dashboard",
    "categories",
    "fabrics",
    "orders",
    "customizations",
    "deliveries",
    "reviews",
    "products",
    "tailors",
    "tailoring-jobs",
    "ad-banners",
    "homepage-content",
    "company-billing",
    "company-profile",
    "tax-settings",
    "shipping-settings",
    "fashion-chats",
    "ticketing",
    "venue-locations",
    "shipments",
    "role-templates",
    "admin-user-blacklist",
    "registered-companies",
    "registered-companies-metrics",
    "hq",
    "ai-settings",
    "parties",
    "booking-accounts",
    "booking-invoices",
    "booking-payments",
    "booking-packages",
    "marketplace-account",
  ]);
  return allow.has(root);
}

export function writeAdminListSnapshot(
  orgId: string | null | undefined,
  queryKey: QueryKey,
  data: unknown
): void {
  if (!orgId || typeof window === "undefined") return;
  if (data == null) return;
  if (!shouldPersistAdminListQuery(queryKey)) return;
  // Never wipe a good snapshot with an empty list (prefetch / permission miss)
  // — except registered-companies, where an empty server result must clear ghosts.
  if (Array.isArray(data) && data.length === 0) {
    const root = Array.isArray(queryKey) ? String(queryKey[0] ?? "") : "";
    if (root !== "registered-companies") {
      const existing = readAdminListSnapshot(orgId, queryKey);
      if (Array.isArray(existing) && existing.length > 0) return;
    }
  }
  try {
    const keyJson = stableKey(queryKey);
    const sk = storageKey(orgId, keyJson);
    const entry: SnapEntry = {
      savedAt: Date.now(),
      orgId,
      key: keyJson,
      data,
    };
    const serialized = serializeSnapEntry(entry);
    if (!serialized) return;
    sessionStorage.setItem(sk, serialized);
    const idx = readIndex(orgId).filter((k) => k !== sk);
    idx.push(sk);
    while (idx.length > MAX_ENTRIES) {
      const drop = idx.shift();
      if (drop) sessionStorage.removeItem(drop);
    }
    writeIndex(orgId, idx);
  } catch {
    /* quota */
  }
}


export function readAdminListSnapshot<T = unknown>(
  orgId: string | null | undefined,
  queryKey: QueryKey
): T | undefined {
  if (!orgId || typeof window === "undefined") return undefined;
  try {
    const sk = storageKey(orgId, stableKey(queryKey));
    const raw = sessionStorage.getItem(sk);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as SnapEntry;
    if (!entry?.savedAt || entry.orgId !== orgId) return undefined;
    if (Date.now() - entry.savedAt > MAX_AGE_MS) return undefined;
    return entry.data as T;
  } catch {
    return undefined;
  }
}

/** Seed one query from sessionStorage if RQ is empty. */
export function hydrateAdminListQuery(
  queryClient: QueryClient,
  orgId: string | null | undefined,
  queryKey: QueryKey
): boolean {
  if (!orgId) return false;
  if (queryClient.getQueryData(queryKey) !== undefined) return false;
  const data = readAdminListSnapshot(orgId, queryKey);
  if (data === undefined) return false;
  queryClient.setQueryData(queryKey, data, {
    updatedAt: Date.now() - SNAPSHOT_SEED_AGE_MS,
  });
  return true;
}

/** Restore every saved list for this org into RQ (sidebar click → instant rows). */
export function hydrateAllAdminListSnapshots(
  queryClient: QueryClient,
  orgId: string | null | undefined
): number {
  if (!orgId || typeof window === "undefined") return 0;
  let n = 0;
  for (const sk of readIndex(orgId)) {
    try {
      const raw = sessionStorage.getItem(sk);
      if (!raw) continue;
      const entry = JSON.parse(raw) as SnapEntry;
      if (!entry?.key || entry.orgId !== orgId) continue;
      if (Date.now() - entry.savedAt > MAX_AGE_MS) continue;
      const queryKey = JSON.parse(entry.key) as QueryKey;
      if (queryClient.getQueryData(queryKey) !== undefined) continue;
      // Mark older than staleTime so refetchOnMount soft-refreshes after paint.
      queryClient.setQueryData(queryKey, entry.data, {
        updatedAt: Date.now() - SNAPSHOT_SEED_AGE_MS,
      });
      n += 1;
    } catch {
      /* skip bad entry */
    }
  }
  return n;
}

export function clearAdminListSnapshots(
  orgId: string | null | undefined
): void {
  if (!orgId || typeof window === "undefined") return;
  try {
    for (const sk of readIndex(orgId)) {
      sessionStorage.removeItem(sk);
    }
    sessionStorage.removeItem(`${INDEX_KEY}:${orgId}`);
  } catch {
    /* ignore */
  }
}

/** Persist a successful query when the actor has an org. */
export function persistAdminQuerySuccess(
  queryKey: QueryKey,
  data: unknown
): void {
  const orgId =
    useAuthStore.getState().user?.orgId ??
    peekAuthSnapshotUser()?.orgId ??
    null;
  writeAdminListSnapshot(orgId, queryKey, data);
}

/**
 * Sync seed for useQuery — paint table rows on hard refresh before the network returns.
 * Marks data stale so a background refetch can still run.
 */
export function adminListSnapshotSeed<T>(queryKey: QueryKey): {
  initialData: T | undefined;
  initialDataUpdatedAt: number | undefined;
} {
  if (typeof window === "undefined") {
    return { initialData: undefined, initialDataUpdatedAt: undefined };
  }
  const orgId =
    useAuthStore.getState().user?.orgId ??
    peekAuthSnapshotUser()?.orgId ??
    null;
  if (!orgId) {
    return { initialData: undefined, initialDataUpdatedAt: undefined };
  }
  const initialData = readAdminListSnapshot<T>(orgId, queryKey);
  if (initialData === undefined) {
    return { initialData: undefined, initialDataUpdatedAt: undefined };
  }
  return {
    initialData,
    initialDataUpdatedAt: Date.now() - SNAPSHOT_SEED_AGE_MS,
  };
}

/** Spread into admin list useQuery options for instant hard-refresh paint. */
export function withAdminListSnapshot<T>(queryKey: QueryKey) {
  const seed = adminListSnapshotSeed<T>(queryKey);
  return {
    initialData: seed.initialData,
    initialDataUpdatedAt: seed.initialDataUpdatedAt,
  };
}
