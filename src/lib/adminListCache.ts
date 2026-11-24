/** Shared admin list cache window — revisits paint from memory. */
export const ADMIN_LIST_STALE_MS = 10 * 60 * 1000;

/** Default React Query options for admin feature list tables. */
export const adminListQueryDefaults = {
  staleTime: ADMIN_LIST_STALE_MS,
  gcTime: 30 * 60 * 1000,
  // Snapshot/hydrate seeds are marked slightly stale → one soft background refresh.
  // Warm in-memory cache within staleTime → no refetch (instant soft-nav).
  refetchOnMount: true as const,
  refetchOnWindowFocus: false as const,
};

/**
 * Only block the table with a skeleton when there is no cached data yet.
 * Prefetched / snapshot / revisited pages paint rows immediately.
 */
export function isAdminListBlockingLoad(
  isLoading: boolean,
  rowCount: number | undefined | null
): boolean {
  return Boolean(isLoading) && !(Number(rowCount) > 0);
}

/** Same gate for object payloads (`data` present) instead of row arrays. */
export function isAdminQueryBlockingLoad(
  isLoading: boolean,
  hasCachedData: boolean
): boolean {
  return Boolean(isLoading) && !hasCachedData;
}
