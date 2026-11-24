'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useDashboardQuery, useDashboardAnalyticsQuery, dashboardKeys } from '@/hooks/useDashboard';
import { useAdminCan, isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import { P } from '@/lib/auth/permissions';
import { useQueryClient } from '@tanstack/react-query';
import { isTransientApiError } from '@/utils/api';
import { useAuthStore } from '@/store/authStore';
import { sessionIsDemoPlan } from '@/lib/demoPlanLock';
import { useParkContextQuery } from '@/hooks/useParkContext';
import { sessionCompanyBrand } from '@/components/brand/CompanyBrandLogo';
import CompanyLoginLink from '@/components/Protected/admin/components/CompanyLoginLink';

function OverviewCardsPulse() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-lg bg-stone-100" />
      ))}
    </div>
  );
}

function MetricsPulse() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading metrics">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-stone-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-72 rounded-lg bg-stone-100" />
        <div className="h-72 rounded-lg bg-stone-100" />
      </div>
    </div>
  );
}

type SoftLoader<P extends object> = () => Promise<{ default: ComponentType<P> }>;

async function loadChunkWithRetry<P extends object>(
  loader: SoftLoader<P>,
  attempts = 4
): Promise<{ default: ComponentType<P> }> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      // Back off while webpack finishes compiling sibling /api routes.
      await new Promise((r) => globalThis.setTimeout(r, 1200 * i));
    }
    try {
      return await loader();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Chunk load failed");
}

/**
 * After retries exhaust, keep trying in the UI — permanent "Couldn't load"
 * cards were false alarms under yarn-dev compile pressure (Fast Refresh /
 * memory), not missing bookings/AI/companies data.
 */
function ChunkRetryShell<P extends object>({
  label,
  loader,
  loading,
  ...props
}: P & {
  label: string;
  loader: SoftLoader<P>;
  loading?: () => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [Mod, setMod] = useState<ComponentType<P> | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setMod(null);
    void loadChunkWithRetry(loader)
      .then((mod) => {
        if (!cancelled) {
          setMod(() => mod.default);
          setBusy(false);
        }
      })
      .catch(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, loader]);

  if (Mod) {
    const Comp = Mod;
    return <Comp {...(props as P)} />;
  }
  if (busy) {
    return <>{loading ? loading() : <OverviewCardsPulse />}</>;
  }
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-6 text-sm text-stone-500">
      <p>
        Couldn’t load {label} yet — the dev server is still compiling routes.
      </p>
      <button
        type="button"
        onClick={() => setAttempt((n) => n + 1)}
        className="mt-3 text-[#8a7010] underline hover:text-[#6b5610]"
      >
        Retry section
      </button>
    </div>
  );
}

/** Dynamic import that never throws ChunkLoadError into the page error boundary. */
function softDynamic<P extends object>(
  loader: SoftLoader<P>,
  opts?: {
    loading?: () => ReactNode;
    fallbackLabel?: string;
  }
) {
  const label = opts?.fallbackLabel ?? "this section";
  const loading = opts?.loading;
  return dynamic<P>(
    () =>
      loadChunkWithRetry(loader).catch(() => ({
        default: ((props: P) => (
          <ChunkRetryShell
            {...props}
            label={label}
            loader={loader}
            loading={loading}
          />
        )) as ComponentType<P>,
      })),
    {
      loading,
      ssr: false,
    }
  );
}

// Primary metrics — load first; soft-fail so a timed-out chunk cannot blank /admin.
const KeyMetricsGrid = softDynamic(
  () => import('./components/dashboard/KeyMetricsGrid'),
  { fallbackLabel: 'metrics', loading: () => <MetricsPulse /> }
);
const PopularProducts = softDynamic(
  () => import('./components/dashboard/PopularProducts'),
  { fallbackLabel: 'popular products' }
);
const LastTransactions = softDynamic(
  () => import('./components/dashboard/LastTransactions'),
  { fallbackLabel: 'transactions' }
);
const TodayOrderChart = softDynamic(
  () => import('./components/dashboard/TodayOrderChart'),
  { fallbackLabel: 'orders chart' }
);
const RecentOrders = softDynamic(
  () => import('./components/dashboard/RecentOrders'),
  { fallbackLabel: 'recent orders' }
);
const ReportsSection = softDynamic(
  () => import('./components/dashboard/ReportsSection'),
  { fallbackLabel: 'reports' }
);
const WebsitePreviewCard = softDynamic(
  () => import('./components/dashboard/WebsitePreviewCard'),
  { fallbackLabel: 'website preview' }
);
const OperationsOverviewCards = softDynamic(
  () => import('./components/dashboard/OperationsOverviewCards'),
  { fallbackLabel: 'operations' }
);
const BookingsOverviewCards = softDynamic(
  () => import('./components/dashboard/BookingsOverviewCards'),
  { fallbackLabel: 'bookings' }
);
const RecentActivityPanel = softDynamic(
  () => import('./components/dashboard/RecentActivityPanel'),
  { fallbackLabel: 'activity' }
);
const DemoPlanLockedBanner = softDynamic(
  () => import('./components/dashboard/DemoPlanLockedBanner'),
  { fallbackLabel: 'demo banner' }
);
const MarketplacePayoutsNudge = softDynamic(
  () => import('./components/dashboard/MarketplacePayoutsNudge'),
  { fallbackLabel: 'payouts nudge' }
);

// Secondary workspace cards — only requested after metrics settle (fewer parallel chunks).
const StoreOverviewCards = softDynamic(
  () => import('./components/dashboard/StoreOverviewCards'),
  { loading: () => <OverviewCardsPulse />, fallbackLabel: 'store overview' }
);
const CompaniesOverviewCards = softDynamic(
  () => import('./components/dashboard/CompaniesOverviewCards'),
  { loading: () => <OverviewCardsPulse />, fallbackLabel: 'companies' }
);
const CompanyPlanUsageCards = softDynamic(
  () => import('./components/dashboard/CompanyPlanUsageCards'),
  { loading: () => <OverviewCardsPulse />, fallbackLabel: 'plan usage' }
);
const AiChatsOverviewCards = softDynamic(
  () => import('./components/dashboard/AiChatsOverviewCards'),
  { fallbackLabel: 'AI chats' }
);

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const { can } = useAdminCan();
  const user = useAuthStore((s) => s.user);
  const isStorefront = isStorefrontOrgSession(user);
  const companyBrand = sessionCompanyBrand(user);
  const isDemo = sessionIsDemoPlan(user);
  const parkLocked = user?.parkLocked === true;

  /**
   * Stagger workspace cards so the first paint does not stampede 10+ APIs / chunks
   * (ChunkLoadError blanked /admin under webpack memory pressure).
   */
  const [opsReady, setOpsReady] = useState(false);
  const [secondaryReady, setSecondaryReady] = useState(isDemo);

  const parkContextQuery = useParkContextQuery(
    parkLocked && !isDemo && !isStorefront
  );
  const managingParkName =
    parkContextQuery.data?.effectiveLocationName ??
    (parkContextQuery.data?.assignedLocations?.length === 1
      ? parkContextQuery.data.assignedLocations[0]?.name
      : null);
  const canAnalytics = !isDemo && can(P.AnalyticsRead);
  const canProducts = !isDemo && can(P.ProductsRead);
  const canOrders = !isDemo && can(P.OrdersRead);
  const loadListWidgets = canAnalytics && (canProducts || canOrders);

  const {
    data: dashboardData,
    isLoading: isLoadingDashboard,
    isFetching: isFetchingDashboard,
    error: dashboardError,
  } = useDashboardQuery(loadListWidgets, {
    includeProducts: canProducts,
    includeOrders: canOrders,
  });

  const {
    data: analyticsData,
    isLoading: isLoadingAnalytics,
    isFetching: isFetchingAnalytics,
    error: analyticsError,
  } = useDashboardAnalyticsQuery(canAnalytics);

  useEffect(() => {
    if (isDemo) {
      setOpsReady(true);
      setSecondaryReady(true);
      return;
    }
    // Ops/bookings cards after first paint — fewer parallel chunks vs metrics.
    const opsTimer = window.setTimeout(() => setOpsReady(true), 900);
    if (analyticsData) {
      const t = window.setTimeout(() => setSecondaryReady(true), 1200);
      return () => {
        window.clearTimeout(opsTimer);
        window.clearTimeout(t);
      };
    }
    const fallback = window.setTimeout(() => setSecondaryReady(true), 4500);
    return () => {
      window.clearTimeout(opsTimer);
      window.clearTimeout(fallback);
    };
  }, [isDemo, analyticsData]);

  const error = canAnalytics
    ? analyticsError || (loadListWidgets && !dashboardData ? dashboardError : null)
    : null;
  const permissionDenied =
    error instanceof Error &&
    error.message.toLowerCase().includes('missing required permission');
  const transientError = error != null && isTransientApiError(error);
  const showError =
    Boolean(error) &&
    !permissionDenied &&
    !transientError &&
    !analyticsData &&
    !(loadListWidgets && dashboardData);
  const isRefreshing =
    canAnalytics &&
    ((loadListWidgets && isFetchingDashboard) || isFetchingAnalytics) &&
    Boolean(analyticsData || (loadListWidgets && dashboardData));

  const orderChart =
    analyticsData?.todayOrderChart ?? dashboardData?.todayOrderChart;
  const waitingMetrics =
    canAnalytics && !analyticsData && (isLoadingAnalytics || transientError);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">
            {isDemo
              ? 'Demo workspace — company dashboard and profile only'
              : isStorefront
                ? 'Platform owner — every admin surface unlocked for testing; company money APIs stay fail-closed on the host org'
                : companyBrand
                  ? `Welcome to the ${companyBrand.name} dashboard`
                  : 'Welcome to your company admin dashboard'}
          </p>
          {parkLocked ? (
            <p className="mt-1 text-sm font-medium text-stone-800">
              Managing:{' '}
              <span className="text-[#8a7010]">
                {managingParkName ??
                  (user?.assignedLocationIds?.length
                    ? `${user.assignedLocationIds.length} assigned park${
                        user.assignedLocationIds.length === 1 ? '' : 's'
                      }`
                    : 'assigned park')}
              </span>
            </p>
          ) : null}
        </div>
        {isRefreshing && (
          <span className="text-xs text-gray-400 mt-1">Updating…</span>
        )}
      </div>

      {companyBrand && user?.organizationSlug ? (
        <CompanyLoginLink slug={user.organizationSlug} />
      ) : null}

      {isDemo ? (
        <>
          <DemoPlanLockedBanner />
          <CompanyPlanUsageCards />
          <StoreOverviewCards />
        </>
      ) : (
        <>
          {isStorefront && <WebsitePreviewCard />}
          {!isStorefront &&
            (!parkLocked || user?.franchiseParkManager === true) && (
              <MarketplacePayoutsNudge />
            )}
          {opsReady ? (
            <>
              <OperationsOverviewCards />
              <BookingsOverviewCards />
            </>
          ) : (
            <OverviewCardsPulse />
          )}

          {!canAnalytics ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
              Metrics and reports need the{' '}
              <span className="font-medium text-gray-800">analytics:read</span>{' '}
              permission. Workspace settings cards above still respect their own
              permissions.
            </div>
          ) : showError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium">Error loading dashboard</p>
              <p className="text-red-600 text-sm mt-1">
                {error instanceof Error
                  ? error.message
                  : 'Failed to load dashboard data'}
              </p>
              <button
                type="button"
                onClick={() => {
                  void queryClient.invalidateQueries({
                    queryKey: dashboardKeys.all,
                  });
                }}
                className="mt-3 text-red-600 hover:text-red-800 underline text-sm"
              >
                Try again
              </button>
            </div>
          ) : waitingMetrics ? (
            <MetricsPulse />
          ) : (
            <>
              {analyticsData?.keyMetrics ? (
                <KeyMetricsGrid metrics={analyticsData.keyMetrics} />
              ) : null}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {canProducts &&
                  (dashboardData ? (
                    <PopularProducts products={dashboardData.popularProducts} />
                  ) : isLoadingDashboard ? (
                    <div className="h-72 animate-pulse rounded-lg bg-stone-100" />
                  ) : null)}
                {canOrders &&
                  (dashboardData ? (
                    <LastTransactions
                      transactions={dashboardData.lastTransactions}
                    />
                  ) : isLoadingDashboard ? (
                    <div className="h-72 animate-pulse rounded-lg bg-stone-100" />
                  ) : null)}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {canOrders && orderChart && (
                  <TodayOrderChart
                    data={orderChart.chartData}
                    totalOrders={orderChart.totalOrders}
                    change={orderChart.changePercentage}
                    changeType={orderChart.changeType}
                  />
                )}
                {canOrders &&
                  (dashboardData ? (
                    <RecentOrders orders={dashboardData.recentOrders} />
                  ) : isLoadingDashboard ? (
                    <div className="h-64 animate-pulse rounded-lg bg-stone-100" />
                  ) : null)}
              </div>

              {analyticsData?.reportMetrics ? (
                <ReportsSection metrics={analyticsData.reportMetrics} />
              ) : null}

              {analyticsData ? (
                <RecentActivityPanel entries={analyticsData.activityLog ?? []} />
              ) : null}
            </>
          )}

          {secondaryReady ? (
            <>
              <AiChatsOverviewCards />
              {isStorefront ? (
                <CompaniesOverviewCards />
              ) : parkLocked ? null : (
                <CompanyPlanUsageCards />
              )}
              <StoreOverviewCards hideBillingCards={parkLocked} />
            </>
          ) : (
            <OverviewCardsPulse />
          )}
        </>
      )}
    </div>
  );
}
