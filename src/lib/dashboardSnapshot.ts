import type { QueryClient } from "@tanstack/react-query";
import {
  dashboardKeys,
  type AnalyticsData,
  type DashboardData,
} from "@/hooks/useDashboard";
import type { DashboardDataOptions } from "@/services/dashboard";

const PREFIX = "fecsync-dashboard-snap:v1:";
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h — good enough for instant paint

type DashboardSnapshot = {
  savedAt: number;
  orgId: string;
  analytics?: AnalyticsData;
  data?: DashboardData;
  dataOpts?: { orders: boolean; products: boolean };
};

function storageKey(orgId: string) {
  return `${PREFIX}${orgId}`;
}

export function readDashboardSnapshot(
  orgId: string | null | undefined
): DashboardSnapshot | null {
  if (!orgId || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardSnapshot;
    if (!parsed?.savedAt || parsed.orgId !== orgId) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDashboardAnalyticsSnapshot(
  orgId: string | null | undefined,
  analytics: AnalyticsData
): void {
  if (!orgId || typeof window === "undefined") return;
  try {
    const prev = readDashboardSnapshot(orgId);
    const next: DashboardSnapshot = {
      savedAt: Date.now(),
      orgId,
      analytics,
      data: prev?.data,
      dataOpts: prev?.dataOpts,
    };
    sessionStorage.setItem(storageKey(orgId), JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export function writeDashboardDataSnapshot(
  orgId: string | null | undefined,
  data: DashboardData,
  opts: DashboardDataOptions
): void {
  if (!orgId || typeof window === "undefined") return;
  try {
    const prev = readDashboardSnapshot(orgId);
    const next: DashboardSnapshot = {
      savedAt: Date.now(),
      orgId,
      analytics: prev?.analytics,
      data,
      dataOpts: {
        orders: opts.includeOrders === true,
        products: opts.includeProducts === true,
      },
    };
    sessionStorage.setItem(storageKey(orgId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * Seed RQ from the last successful dashboard load so hard refresh paints
 * metrics immediately, then revalidates in the background.
 * Only fills empty cache entries — never clobbers fresher in-memory data.
 * Call synchronously (render / before useQuery), not only in useLayoutEffect.
 */
export function hydrateDashboardQueryCache(
  queryClient: QueryClient,
  orgId: string | null | undefined,
  opts?: DashboardDataOptions
): boolean {
  if (!orgId) return false;

  const analyticsKey = dashboardKeys.analytics();
  const needsAnalytics = !queryClient.getQueryData(analyticsKey);
  const keyOpts =
    opts ??
    undefined;
  const dataKey = keyOpts ? dashboardKeys.data(keyOpts) : null;
  const needsData = Boolean(dataKey && !queryClient.getQueryData(dataKey));

  // Fast path: both slots warm — skip sessionStorage parse.
  if (!needsAnalytics && !needsData && keyOpts) return false;
  if (!needsAnalytics && !opts) return false;

  const snap = readDashboardSnapshot(orgId);
  if (!snap) return false;
  let seeded = false;
  if (needsAnalytics && snap.analytics) {
    queryClient.setQueryData(analyticsKey, snap.analytics);
    seeded = true;
  }
  if (snap.data) {
    const resolvedOpts =
      opts ??
      (snap.dataOpts
        ? {
            includeOrders: snap.dataOpts.orders,
            includeProducts: snap.dataOpts.products,
          }
        : undefined);
    if (resolvedOpts) {
      const key = dashboardKeys.data(resolvedOpts);
      const matches =
        !snap.dataOpts ||
        (snap.dataOpts.orders === (resolvedOpts.includeOrders === true) &&
          snap.dataOpts.products === (resolvedOpts.includeProducts === true));
      if (matches && !queryClient.getQueryData(key)) {
        queryClient.setQueryData(key, snap.data);
        seeded = true;
      }
    }
  }
  return seeded;
}
