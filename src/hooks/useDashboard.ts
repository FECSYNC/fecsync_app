'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDashboardData,
  type DashboardDataOptions,
} from '@/services/dashboard';
import { getDashboardAnalytics } from '@/services/analytics';
import {
  MetricData,
  ReportMetric,
  ChartData,
  MetricChangeType,
} from '@/components/Protected/admin/pages/types/dashboard';
import { ADMIN_DASHBOARD_LIVE_MS } from '@/utils/adminLiveRefresh';
import { isTransientApiError } from '@/utils/api';
import { useAuthStore } from '@/store/authStore';
import {
  hydrateDashboardQueryCache,
  writeDashboardAnalyticsSnapshot,
  writeDashboardDataSnapshot,
} from '@/lib/dashboardSnapshot';

/** Keep non-live dashboard slices warm; order widgets poll separately below. */
export const DASHBOARD_STALE_MS = 15 * 60 * 1000;

export const dashboardKeys = {
  all: ['dashboard'] as const,
  data: (opts?: DashboardDataOptions) =>
    [
      ...dashboardKeys.all,
      'data',
      {
        orders: opts?.includeOrders === true,
        products: opts?.includeProducts === true,
      },
    ] as const,
  analytics: () => [...dashboardKeys.all, 'analytics'] as const,
};

export interface DashboardData {
  recentOrders: any[];
  lastTransactions: any[];
  popularProducts: any[];
  todayOrderChart: {
    chartData: any[];
    totalOrders: string;
    changePercentage: string;
    changeType: MetricChangeType;
  };
}

export interface AnalyticsData {
  keyMetrics: MetricData[];
  reportMetrics: ReportMetric[];
  reportChartData: ChartData[];
  todayOrderChart?: {
    chartData: Array<{ day: string; orders: number }>;
    totalOrders: string;
    changePercentage: string;
    changeType: MetricChangeType;
  };
  activityLog?: Array<{
    _id?: string;
    action?: string;
    description?: string;
    entityType?: string;
    createdAt?: string;
    user?: { email?: string; username?: string } | string | null;
  }>;
}

/**
 * Seed RQ from sessionStorage synchronously (same render as useQuery) so hard
 * refresh paints last metrics immediately. useLayoutEffect was one frame too
 * late — first observe saw an empty cache and flashed loading / waited on network.
 */
function useHydrateDashboardSnapshot(
  orgId: string | null,
  opts?: DashboardDataOptions
) {
  const queryClient = useQueryClient();
  // TanStack: setQueryData during render is supported for external-store hydration.
  if (orgId) {
    hydrateDashboardQueryCache(queryClient, orgId, opts);
  }
}

/** Dashboard list widgets (orders / products). */
export function useDashboardQuery(
  enabled: boolean = true,
  options: DashboardDataOptions = {}
) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const includeOrders = options.includeOrders === true;
  const includeProducts = options.includeProducts === true;
  const opts = { includeOrders, includeProducts };
  useHydrateDashboardSnapshot(orgId, opts);

  const query = useQuery<DashboardData, Error>({
    queryKey: dashboardKeys.data(opts),
    queryFn: async () => getDashboardData(opts),
    enabled: enabled && Boolean(orgId),
    staleTime: includeOrders ? ADMIN_DASHBOARD_LIVE_MS : DASHBOARD_STALE_MS,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: includeOrders,
    refetchInterval: includeOrders ? ADMIN_DASHBOARD_LIVE_MS : false,
    refetchIntervalInBackground: false,
    retry: (failureCount, err) =>
      isTransientApiError(err) ? failureCount < 1 : false,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (query.isSuccess && query.data && orgId) {
      writeDashboardDataSnapshot(orgId, query.data, opts);
    }
  }, [query.isSuccess, query.data, orgId, includeOrders, includeProducts]);

  return query;
}

/** Analytics metrics — seeds from sessionStorage for instant paint. */
export function useDashboardAnalyticsQuery(enabled: boolean = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  useHydrateDashboardSnapshot(orgId);

  const query = useQuery<AnalyticsData, Error>({
    queryKey: dashboardKeys.analytics(),
    queryFn: async () => getDashboardAnalytics(),
    enabled: enabled && Boolean(orgId),
    staleTime: DASHBOARD_STALE_MS,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: ADMIN_DASHBOARD_LIVE_MS,
    refetchIntervalInBackground: false,
    retry: (failureCount, err) =>
      isTransientApiError(err) ? failureCount < 1 : false,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (query.isSuccess && query.data && orgId) {
      writeDashboardAnalyticsSnapshot(orgId, query.data);
    }
  }, [query.isSuccess, query.data, orgId]);

  return query;
}
