import type { QueryClient } from '@tanstack/react-query';
import {
  getDashboardData,
  type DashboardDataOptions,
} from '@/services/dashboard';
import { getDashboardAnalytics } from '@/services/analytics';
import {
  DASHBOARD_STALE_MS,
  dashboardKeys,
  type AnalyticsData,
  type DashboardData,
} from '@/hooks/useDashboard';

const emptyAnalytics = (): AnalyticsData => ({
  keyMetrics: [],
  reportMetrics: [],
  reportChartData: [],
  todayOrderChart: {
    chartData: [],
    totalOrders: '0',
    changePercentage: "No change vs last 7 days",
    changeType: 'neutral',
  },
  activityLog: [],
});

/**
 * Warm dashboard React Query caches so /admin paints from cache on click/hover.
 */
export function prefetchAdminDashboard(
  queryClient: QueryClient,
  options: {
    canAnalytics: boolean;
    includeOrders?: boolean;
    includeProducts?: boolean;
  }
) {
  const includeOrders = options.includeOrders === true;
  const includeProducts = options.includeProducts === true;

  if (options.canAnalytics) {
    void queryClient.prefetchQuery({
      queryKey: dashboardKeys.analytics(),
      queryFn: async (): Promise<AnalyticsData> => {
        try {
          return await getDashboardAnalytics();
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('Missing required permission')) {
            return emptyAnalytics();
          }
          throw err;
        }
      },
      staleTime: DASHBOARD_STALE_MS,
      meta: { suppressErrorBanner: true },
    });
  }

  if (options.canAnalytics && (includeOrders || includeProducts)) {
    const opts: DashboardDataOptions = { includeOrders, includeProducts };
    void queryClient.prefetchQuery({
      queryKey: dashboardKeys.data(opts),
      queryFn: (): Promise<DashboardData> => getDashboardData(opts),
      staleTime: DASHBOARD_STALE_MS,
      meta: { suppressErrorBanner: true },
    });
  }
}
