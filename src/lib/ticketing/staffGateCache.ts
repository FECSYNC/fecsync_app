/**
 * Short-lived in-memory pass cache for Online Booking / ticketing staff gates.
 * Cuts repeated Active + Billing + module + HQ scope DB round-trips when staff
 * click between Booking app pages (lists fire many GETs in a few seconds).
 *
 * Fail-closed: only successful checks are cached; TTL stays short so suspend /
 * plan demotion still bite quickly.
 *
 * Process-local only — other Node workers keep entries until TTL (≤20s) after
 * org-wide clears (assignment replace / venue archive). Prefer session
 * authzVersion bumps for hard authority changes.
 */

const DEFAULT_TTL_MS = 20_000;

type CacheEntry = { until: number };

const staffGateByKey = new Map<string, CacheEntry>();
const locationScopeByKey = new Map<string, CacheEntry & { value: unknown }>();

function sweep(map: Map<string, CacheEntry>, now: number) {
  if (map.size < 200) return;
  for (const [k, v] of map) {
    if (v.until <= now) map.delete(k);
  }
}

export function getCachedStaffGate(key: string): boolean {
  const now = Date.now();
  const hit = staffGateByKey.get(key);
  if (!hit) return false;
  if (hit.until <= now) {
    staffGateByKey.delete(key);
    return false;
  }
  return true;
}

export function setCachedStaffGate(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const now = Date.now();
  staffGateByKey.set(key, { until: now + ttlMs });
  sweep(staffGateByKey, now);
}

/** Drop one staff-gate cache entry (smokes / plan demotion tests). */
export function clearCachedStaffGate(key: string): void {
  staffGateByKey.delete(key);
}

/** Drop module:* staff-gate caches for an org after plan / billing changes. */
export function clearCachedStaffGatesForOrg(orgId: string): void {
  if (!orgId) return;
  const prefix = `module:${orgId}:`;
  for (const key of staffGateByKey.keys()) {
    if (key.startsWith(prefix) || key.includes(`:${orgId}:`)) {
      staffGateByKey.delete(key);
    }
  }
}

export function getCachedLocationScope<T>(key: string): T | null {
  const now = Date.now();
  const hit = locationScopeByKey.get(key);
  if (!hit) return null;
  if (hit.until <= now) {
    locationScopeByKey.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setCachedLocationScope(
  key: string,
  value: unknown,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const now = Date.now();
  locationScopeByKey.set(key, { until: now + ttlMs, value });
  sweep(locationScopeByKey, now);
}

/** Drop one location-scope cache entry (e.g. after park-context PUT). */
export function clearCachedLocationScope(key: string): void {
  locationScopeByKey.delete(key);
}

/** Drop all location-scope caches for an org (venue archive / assignment replace). */
export function clearCachedLocationScopesForOrg(orgId: string): void {
  if (!orgId) return;
  const prefixes = [`parkScope:${orgId}:`, `scope:${orgId}:`];
  for (const key of locationScopeByKey.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) {
      locationScopeByKey.delete(key);
    }
  }
}
