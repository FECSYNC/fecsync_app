'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useAdminOrdersBellQuery } from '@/hooks/useOrders';
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from '@/hooks/useNotifications';
import { useProfileQuery } from '@/hooks/useProfile';
import { clearUserQueries } from '@/utils/clearUserQueries';
import { formatPrice } from '@/utils/currency';
import { P } from '@/lib/auth/permissions';
import type { Order } from '@/services/order';
import {
  isRecentPaidOrder,
  loadDismissedPaidOrderIds,
  pruneDismissedPaidOrderIds,
  saveDismissedPaidOrderIds,
} from '@/utils/dismissedPaidOrders';
import { orderMatchesAdminTab } from '@/components/Protected/admin/pages/orders/order-tabs';
import { sessionIsDemoPlan } from '@/lib/demoPlanLock';
import { isAdminUiHiddenHref } from '@/lib/adminUiHidden';
import HqVenueSwitcher from '@/components/Protected/admin/pages/hq/HqVenueSwitcher';
import ParkContextSwitcher from '@/components/Protected/admin/pages/hq/ParkContextSwitcher';
import AdminAppSearch from '@/components/Protected/admin/layout/AdminAppSearch';
import { useEnterpriseHqSessionCatchUp } from '@/hooks/useBilling';
import { isStorefrontOrgSession } from '@/services/auth';
import {
  HQ_LOCATION_CONTEXT_SYNC_KEY,
  parseHqLocationContextSync,
} from '@/utils/hqLocationContextSync';
import { venueLocationKeys } from '@/services/venueLocations';
import { hqKeys } from '@/services/hq';
import { parkContextKeys } from '@/services/parkContext';
import { invalidateTicketingQueries } from '@/utils/invalidateTicketingQueries';
import { invalidateMembershipsQueries } from '@/utils/invalidateMembershipsQueries';
import { invalidateWaiversQueries } from '@/utils/invalidateWaiversQueries';
import { invalidateMarketingQueries } from '@/utils/invalidateMarketingQueries';
import { useAdminCan } from '@/hooks/useAdminPermission';
import { clearAdminInstantNav, navigateAdminRoute } from '@/lib/adminInstantNav';
import { sessionCompanyBrand } from '@/components/brand/CompanyBrandLogo';
import { postLogoutPath } from '@/lib/tenantDomain';
import { Calculator } from 'lucide-react';

interface AdminHeaderProps {
  onMenuToggle: () => void;
}

type OpenMenu = 'notifications' | 'profile' | null;

function timeAgo(value?: string) {
  if (!value) return '';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function MenuSpinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-3.5 w-3.5 shrink-0 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default function AdminHeader({ onMenuToggle }: AdminHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { canMutatePath } = useAdminCan();
  const rootRef = useRef<HTMLDivElement>(null);
  const pathnameRef = useRef(pathname);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  /** Which menu item is currently opening (brief loader while navigating). */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const navigating = Boolean(pendingKey);

  const { user, logout, can, isAuthenticated } = useAuthStore();
  const isDemo = sessionIsDemoPlan(user);
  const canReadOrders = !isDemo && can(P.OrdersRead);
  /** Delay bell/notification polls so page APIs claim the DB pool first. */
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    // Dev: Opening… + leaf APIs need the compile queue; 1.5s was still too early.
    const delayMs = process.env.NODE_ENV === 'development' ? 8000 : 1500;
    const t = setTimeout(() => setChromeReady(true), delayMs);
    return () => clearTimeout(t);
  }, []);
  useEnterpriseHqSessionCatchUp(
    Boolean(user) &&
      !isStorefrontOrgSession(user) &&
      !isDemo &&
      can(P.SettingsManage)
  );

  // Cross-tab: park scope preference (billing sync already covers enterpriseHqEnabled).
  useEffect(() => {
    const orgId = user?.orgId ?? null;
    if (!orgId) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== HQ_LOCATION_CONTEXT_SYNC_KEY || !event.newValue) return;
      const payload = parseHqLocationContextSync(event.newValue);
      if (!payload || payload.orgId !== orgId) return;
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
      void queryClient.invalidateQueries({
        queryKey: venueLocationKeys.all,
      });
      invalidateTicketingQueries(queryClient);
      invalidateMembershipsQueries(queryClient);
      invalidateWaiversQueries(queryClient);
      invalidateMarketingQueries(queryClient);
      // Other tab changed park preference — force session park fields to catch up.
      void useAuthStore.getState().silentRefresh({ force: true });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.orgId, queryClient]);

  // Entitlement flip (same tab or billing broadcast → AuthBootstrap fingerprint):
  // drop HQ caches when locked so soft-upsell cannot flash stale rollup data.
  const enterpriseHqEnabled = user?.enterpriseHqEnabled === true;
  const parkLocked = user?.parkLocked === true;
  const prevHqEnabledRef = useRef<boolean | null>(null);
  const prevParkLockedRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevHqEnabledRef.current;
    prevHqEnabledRef.current = enterpriseHqEnabled;
    if (prev === null || prev === enterpriseHqEnabled) return;
    if (!enterpriseHqEnabled) {
      void queryClient.removeQueries({ queryKey: hqKeys.all });
    } else {
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
      void queryClient.invalidateQueries({
        queryKey: venueLocationKeys.all,
      });
      invalidateTicketingQueries(queryClient);
      invalidateMembershipsQueries(queryClient);
      invalidateWaiversQueries(queryClient);
      invalidateMarketingQueries(queryClient);
    }
  }, [enterpriseHqEnabled, queryClient]);

  // Park-lock flip (assignment change after re-login /me): drop stale scope caches.
  useEffect(() => {
    const prev = prevParkLockedRef.current;
    prevParkLockedRef.current = parkLocked;
    if (prev === null || prev === parkLocked) return;
    void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
    void queryClient.invalidateQueries({ queryKey: hqKeys.all });
    void queryClient.invalidateQueries({
      queryKey: venueLocationKeys.all,
    });
    invalidateTicketingQueries(queryClient);
    invalidateMembershipsQueries(queryClient);
    invalidateWaiversQueries(queryClient);
    invalidateMarketingQueries(queryClient);
  }, [parkLocked, queryClient]);

  const { data: profile } = useProfileQuery(
    Boolean(isAuthenticated) && openMenu === 'profile'
  );

  const { data: notifications = [], isFetching: fetchingNotes } =
    useNotificationsQuery(chromeReady);
  const { data: orders = [], isFetching: fetchingOrders } =
    useAdminOrdersBellQuery(canReadOrders && chromeReady);

  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();

  const dismissUserId = user?.id || null;

  const [dismissedPaidIds, setDismissedPaidIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setDismissedPaidIds(loadDismissedPaidOrderIds(dismissUserId));
  }, [dismissUserId]);

  const allPaidOrders = useMemo(
    () =>
      orders
        // Same bucket as Orders Paid tab (paid + shipping).
        .filter((order) => orderMatchesAdminTab(order.status, 'paid'))
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        ),
    [orders]
  );

  const allPaidOrderIds = useMemo(
    () => new Set(allPaidOrders.map((order) => order._id)),
    [allPaidOrders]
  );

  // Drop dismissals for orders that left the paid/shipping queue (shipped/etc.)
  useEffect(() => {
    setDismissedPaidIds((prev) => {
      const pruned = pruneDismissedPaidOrderIds(prev, allPaidOrderIds);
      if (pruned.size === prev.size) {
        let same = true;
        for (const id of prev) {
          if (!pruned.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      saveDismissedPaidOrderIds(dismissUserId, pruned);
      return pruned;
    });
  }, [allPaidOrderIds, dismissUserId]);

  const dismissPaidOrders = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    setDismissedPaidIds((prev) => {
      const next = new Set(prev);
      for (const id of orderIds) next.add(id);
      saveDismissedPaidOrderIds(dismissUserId, next);
      return next;
    });
  };

  /** Paid/shipping in last 7 days and not dismissed — drives badge + Needs processing. */
  const actionablePaidOrders = useMemo(
    () =>
      allPaidOrders.filter(
        (order) =>
          isRecentPaidOrder(order) && !dismissedPaidIds.has(order._id)
      ),
    [allPaidOrders, dismissedPaidIds]
  );

  const paidQueue = useMemo(
    () => actionablePaidOrders.slice(0, 8),
    [actionablePaidOrders]
  );

  const uniqueUnreadAlerts = useMemo(
    () =>
      notifications.filter((n) => {
        if (n.read) return false;
        const orderId =
          typeof n.metadata?.orderId === 'string' ? n.metadata.orderId : '';
        const shipmentId =
          typeof n.metadata?.shipmentId === 'string'
            ? n.metadata.shipmentId
            : '';
        // Paid queue already lists actionable paid/shipping orders — hide
        // duplicate generic order notes, but keep shipment-ops alerts.
        if (
          n.type === 'order' &&
          orderId &&
          !shipmentId &&
          actionablePaidOrders.some((o) => o._id === orderId)
        ) {
          return false;
        }
        return true;
      }),
    [notifications, actionablePaidOrders]
  );

  const alertFeed = useMemo(
    () =>
      notifications.filter((n) => {
        const orderId =
          typeof n.metadata?.orderId === 'string' ? n.metadata.orderId : '';
        const shipmentId =
          typeof n.metadata?.shipmentId === 'string'
            ? n.metadata.shipmentId
            : '';
        if (
          !n.read &&
          n.type === 'order' &&
          orderId &&
          !shipmentId &&
          actionablePaidOrders.some((o) => o._id === orderId)
        ) {
          return false;
        }
        return true;
      }),
    [notifications, actionablePaidOrders]
  );

  const badgeCount = actionablePaidOrders.length + uniqueUnreadAlerts.length;
  const badgeLabel = badgeCount > 9 ? '9+' : String(badgeCount);
  const hasUnreadAlerts = notifications.some((n) => !n.read);
  const canClearPanel =
    hasUnreadAlerts || actionablePaidOrders.length > 0;

  // Profile menu still shows full paid backlog (not only last 7 days)
  const paidOrders = allPaidOrders;

  const profileFullName = [profile?.firstName, profile?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const displayName =
    profileFullName ||
    user?.fullName ||
    user?.name ||
    user?.email?.split('@')[0] ||
    'Admin';
  const companyLabel =
    user?.companyDisplayName?.trim() ||
    user?.legalName?.trim() ||
    user?.tradingName?.trim() ||
    user?.organizationName?.trim() ||
    null;
  const initial = displayName.trim().charAt(0).toUpperCase() || 'A';
  const avatarSrc = profile?.profilePicture || user?.avatar || '';

  const clearMenuState = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenMenu(null);
    setPendingKey(null);
  };

  const finishNavigationSoon = (delayMs = 180) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpenMenu(null);
      setPendingKey(null);
      setLoggingOut(false);
    }, delayMs);
  };

  // Close menus + clear loaders when the route actually changes.
  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    finishNavigationSoon(120);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to route changes
  }, [pathname]);

  // Safety: never leave a stuck loader/menu if navigation stalls.
  useEffect(() => {
    if (!pendingKey) return;
    const safety = setTimeout(() => {
      clearMenuState();
      setLoggingOut(false);
    }, 8000);
    return () => clearTimeout(safety);
  }, [pendingKey]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        clearMenuState();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearMenuState();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggleMenu = (menu: OpenMenu) => {
    if (pendingKey) {
      clearMenuState();
      return;
    }
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const navigateWithLoader = (key: string, href: string) => {
    if (pendingKey) return;
    setPendingKey(key);
    if (pathname === href) {
      finishNavigationSoon(220);
      return;
    }
    navigateAdminRoute(router, href);
  };

  const openOrder = async (orderId: string) => {
    if (pendingKey) return;
    const key = `order:${orderId}`;
    const href = `/admin/orders/${orderId}`;
    setPendingKey(key);
    dismissPaidOrders([orderId]);
    try {
      const related = notifications.filter(
        (n) =>
          !n.read &&
          n.type === 'order' &&
          n.metadata?.orderId === orderId
      );
      await Promise.allSettled(
        related.map((n) => markRead.mutateAsync(n._id))
      );
    } catch {
      /* still navigate */
    }
    if (pathname === href) {
      finishNavigationSoon(220);
      return;
    }
    navigateAdminRoute(router, href);
  };

  const handleNotificationClick = async (
    id: string,
    orderId?: string,
    jobId?: string,
    shipmentId?: string,
    metaHref?: string
  ) => {
    if (pendingKey) return;
    const key = `note:${id}`;
    setPendingKey(key);
    if (orderId) dismissPaidOrders([orderId]);
    try {
      await markRead.mutateAsync(id);
    } catch {
      /* still navigate */
    }
    if (shipmentId && can(P.DeliveriesRead)) {
      const href = `/admin/deliveries/${shipmentId}`;
      if (pathname === href) {
        finishNavigationSoon(220);
        return;
      }
      navigateAdminRoute(router, href);
    } else if (orderId) {
      const href = `/admin/orders/${orderId}`;
      if (pathname === href) {
        finishNavigationSoon(220);
        return;
      }
      navigateAdminRoute(router, href);
    } else if (jobId) {
      const href = `/admin/tailoring-jobs/${jobId}`;
      // Tailoring jobs admin chrome is UI-hidden — stay on dashboard instead of /403.
      if (isAdminUiHiddenHref(href)) {
        finishNavigationSoon(220);
        return;
      }
      if (pathname === href) {
        finishNavigationSoon(220);
        return;
      }
      navigateAdminRoute(router, href);
    } else if (metaHref && metaHref.startsWith('/')) {
      // Step 3 company_billing alerts carry metadata.href (Billing / company-pending).
      if (pathname === metaHref) {
        finishNavigationSoon(220);
        return;
      }
      navigateAdminRoute(router, metaHref);
    } else {
      finishNavigationSoon(160);
    }
  };

  const handleMarkAllRead = async () => {
    if (pendingKey || markAllRead.isPending) return;
    dismissPaidOrders(actionablePaidOrders.map((o) => o._id));
    try {
      if (hasUnreadAlerts) {
        await markAllRead.mutateAsync();
      }
    } catch (err) {
      console.error('Failed to mark notifications read:', err);
    }
  };

  const handleLogout = async () => {
    if (pendingKey || loggingOut) return;
    setPendingKey('logout');
    setLoggingOut(true);
    const afterLogout = postLogoutPath(
      sessionCompanyBrand(user) ? user?.organizationSlug : null
    );
    try {
      clearUserQueries(queryClient);
      await logout();
      clearAdminInstantNav();
      router.replace(afterLogout);
    } catch (err) {
      console.error('Logout error:', err);
      setLoggingOut(false);
      setPendingKey(null);
      router.replace(afterLogout);
    }
  };

  const customerLabel = (order: Order) => {
    if (!order.user || typeof order.user === 'string') return 'Customer';
    return (
      order.user.firstName ||
      order.user.username ||
      order.user.email ||
      'Customer'
    );
  };

  const isBusy = (key: string) => pendingKey === key;

  // Enterprise HQ switcher for entitled CWV; park-locked / Growth multi-venue use park-context.
  const showHqSwitcher =
    !isDemo &&
    user?.parkLocked !== true &&
    (user?.enterpriseHqEnabled === true || canMutatePath('/admin/hq'));
  const showParkSwitcher =
    !isDemo &&
    Boolean(user?.orgId) &&
    !isStorefrontOrgSession(user) &&
    (user?.parkLocked === true || !showHqSwitcher);

  return (
    <header className="bg-white border-b border-gray-200 px-3 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center justify-between gap-2 min-w-0" ref={rootRef}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={onMenuToggle}
            className="lg:hidden shrink-0 p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <AdminAppSearch />
          {showHqSwitcher ? <HqVenueSwitcher /> : null}
          {showParkSwitcher ? <ParkContextSwitcher /> : null}
        </div>

        <div className="flex shrink-0 items-center space-x-2 sm:space-x-4">
          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleMenu('notifications')}
              className={`relative p-2 rounded-lg transition-colors cursor-pointer ${
                openMenu === 'notifications'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
              aria-label="Notifications"
              aria-expanded={openMenu === 'notifications'}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
              </svg>
              {badgeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {badgeLabel}
                </span>
              )}
              {(fetchingNotes || fetchingOrders) && (
                <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#D4AF37]" />
              )}
            </button>

            {openMenu === 'notifications' && (
              <div className="fixed left-3 right-3 top-[4.25rem] z-50 w-auto max-h-[min(28rem,calc(100dvh-5rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem] sm:max-w-[min(22rem,calc(100vw-2rem))]">
                <div className="flex items-start justify-between gap-3 px-3 py-3 sm:px-4 border-b border-gray-100">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Notifications</p>
                    <p className="text-xs text-gray-500 break-words">
                      {navigating && pendingKey
                        ? 'Opening…'
                        : 'Recent paid, shipping & company notices'}
                    </p>
                  </div>
                  {canClearPanel && (
                    <button
                      type="button"
                      onClick={() => void handleMarkAllRead()}
                      disabled={navigating || markAllRead.isPending}
                      className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#D4AF37] hover:text-[#B8941F] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {markAllRead.isPending ? (
                        <>
                          <MenuSpinner className="text-[#D4AF37]" />
                          Updating…
                        </>
                      ) : (
                        'Mark all read'
                      )}
                    </button>
                  )}
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {canReadOrders && (
                    <div className="px-4 pt-3 pb-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Needs processing
                      </p>
                    </div>
                  )}

                  {canReadOrders && actionablePaidOrders.length === 0 && (
                    <p className="px-4 py-2 text-sm text-gray-500">
                      {allPaidOrders.length > 0
                        ? 'No recent paid/shipping orders in the last 7 days. Older ones are on the Orders page.'
                        : 'No paid or shipping orders waiting.'}
                    </p>
                  )}

                  {canReadOrders &&
                    paidQueue.map((order) => {
                      const key = `order:${order._id}`;
                      const busy = isBusy(key);
                      return (
                        <button
                          key={order._id}
                          type="button"
                          disabled={navigating}
                          onClick={() => void openOrder(order._id)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-gray-900 inline-flex items-center gap-1.5">
                                {busy ? <MenuSpinner className="text-[#D4AF37]" /> : null}
                                {busy
                                  ? 'Opening order…'
                                  : order.status === 'shipping'
                                    ? `Shipping #${order._id.slice(-8)}`
                                    : `Paid order #${order._id.slice(-8)}`}
                              </p>
                              {!busy && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {customerLabel(order)} · {formatPrice(order.amount)}
                                </p>
                              )}
                            </div>
                            {!busy && (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full ${
                                  order.status === 'shipping'
                                    ? 'text-indigo-800 bg-indigo-50'
                                    : 'text-emerald-700 bg-emerald-50'
                                }`}
                              >
                                {order.status === 'shipping' ? 'Shipping' : 'Paid'}
                              </span>
                            )}
                          </div>
                          {!busy && (
                            <p className="text-[11px] text-gray-400 mt-1">
                              {timeAgo(order.updatedAt || order.createdAt)}
                            </p>
                          )}
                        </button>
                      );
                    })}

                  {canReadOrders && actionablePaidOrders.length > paidQueue.length && (
                    <button
                      type="button"
                      disabled={navigating}
                      onClick={() =>
                        navigateWithLoader('orders-all-paid', '/admin/orders?status=paid')
                      }
                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-[#D4AF37] hover:bg-gray-50 border-b border-gray-50 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                    >
                      {isBusy('orders-all-paid') ? (
                        <>
                          <MenuSpinner className="text-[#D4AF37]" />
                          Opening…
                        </>
                      ) : (
                        `View ${actionablePaidOrders.length - paidQueue.length} more recent`
                      )}
                    </button>
                  )}
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      Alerts
                    </p>
                  </div>

                  {alertFeed.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-500">
                      No alerts yet. Paid/shipping orders from the last 7 days and company billing notices (including offboard) appear here.
                    </p>
                  )}

                  {alertFeed.slice(0, 12).map((note) => {
                    const orderId =
                      typeof note.metadata?.orderId === 'string'
                        ? note.metadata.orderId
                        : undefined;
                    const jobId =
                      typeof note.metadata?.jobId === 'string'
                        ? note.metadata.jobId
                        : undefined;
                    const shipmentId =
                      typeof note.metadata?.shipmentId === 'string'
                        ? note.metadata.shipmentId
                        : undefined;
    const rawHref =
      typeof note.metadata?.deepLink === 'string'
        ? note.metadata.deepLink.trim()
        : typeof note.metadata?.href === 'string'
          ? note.metadata.href.trim()
          : '';
                    let metaHref: string | undefined;
                    if (rawHref.startsWith('/')) {
                      metaHref = rawHref.split('?')[0] || rawHref;
                    } else if (/^https?:\/\//i.test(rawHref)) {
                      // Legacy notices stored absolute URLs — navigate by pathname.
                      try {
                        const path = new URL(rawHref).pathname;
                        if (path.startsWith('/')) metaHref = path;
                      } catch {
                        /* ignore */
                      }
                    }
                    const key = `note:${note._id}`;
                    const busy = isBusy(key);
                    return (
                      <button
                        key={note._id}
                        type="button"
                        disabled={navigating}
                        onClick={() =>
                          void handleNotificationClick(
                            note._id,
                            orderId,
                            jobId,
                            shipmentId,
                            metaHref
                          )
                        }
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                          note.read ? 'opacity-70' : 'bg-[#D4AF37]/5'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900 inline-flex items-center gap-1.5">
                            {note.type === 'accounting' && !busy ? (
                              <Calculator className="h-4 w-4 shrink-0 text-[#8a7320]" aria-hidden />
                            ) : null}
                            {busy ? <MenuSpinner className="text-[#D4AF37]" /> : null}
                            {busy ? 'Opening…' : note.title}
                          </p>
                          {!note.read && !busy && (
                            <span className="mt-1 h-2 w-2 rounded-full bg-red-500 shrink-0" />
                          )}
                        </div>
                        {!busy && (
                          <>
                            <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                              {note.message}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-1">
                              {timeAgo(note.createdAt)}
                            </p>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {canReadOrders && (
                  <div className="border-t border-gray-100 px-4 py-2.5">
                    <button
                      type="button"
                      disabled={navigating}
                      onClick={() =>
                        navigateWithLoader('orders-footer', '/admin/orders?status=paid')
                      }
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[#D4AF37] hover:text-[#B8941F] disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isBusy('orders-footer') ? (
                        <>
                          <MenuSpinner className="text-[#D4AF37]" />
                          Opening orders…
                        </>
                      ) : (
                        'View all orders →'
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleMenu('profile')}
              className={`flex items-center gap-2 p-1.5 rounded-lg transition-colors cursor-pointer ${
                openMenu === 'profile'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
              aria-label="Account menu"
              aria-expanded={openMenu === 'profile'}
            >
              <span className="hidden sm:inline text-sm font-medium text-gray-700 max-w-[9rem] truncate">
                {displayName}
              </span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white text-sm font-semibold overflow-hidden">
                {avatarSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarSrc}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  initial
                )}
              </span>
            </button>

            {openMenu === 'profile' && (
              <div className="fixed left-3 right-3 top-[4.25rem] z-50 w-auto overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-64 sm:max-w-[calc(100vw-2rem)]">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {displayName}
                  </p>
                  {companyLabel && (
                    <p className="text-xs text-gray-600 truncate">{companyLabel}</p>
                  )}
                  <p className="text-xs text-gray-500 truncate">
                    {profile?.user?.email || user?.email}
                  </p>
                  {user?.membershipRole && (
                    <p className="text-[11px] text-gray-400 mt-1 capitalize">
                      {user.membershipRole.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
                <div className="py-1">
                  {(
                    [
                      // Intended cross-nav (workspace rule): shop public storefront
                      // without treating /profile as admin primary workspace.
                      { key: 'nav:store', href: '/home', label: 'Public site' },
                      { key: 'nav:profile', href: '/admin/profile', label: 'My profile' },
                      { key: 'nav:dashboard', href: '/admin', label: 'Dashboard' },
                      ...(isDemo
                        ? [
                            {
                              key: 'nav:company-profile',
                              href: '/admin/company-profile',
                              label: 'Company profile',
                            },
                            {
                              key: 'nav:billing',
                              href: '/admin/billing',
                              label: 'Billing / upgrade',
                            },
                          ]
                        : []),
                      ...(!isDemo && canReadOrders
                        ? [
                            {
                              key: 'nav:orders',
                              href: paidOrders.length > 0 ? '/admin/orders?status=paid' : '/admin/orders',
                              label: 'Orders',
                              extra:
                                paidOrders.length > 0 ? (
                                  <span className="ml-2 text-xs text-emerald-700">
                                    {paidOrders.length} paid
                                  </span>
                                ) : null,
                            },
                          ]
                        : []),
                      ...(!isDemo && can(P.UsersRead)
                        ? [
                            {
                              key: 'nav:users',
                              href: '/admin/users',
                              label: 'Team & users',
                            },
                          ]
                        : []),
                    ] as Array<{
                      key: string;
                      href: string;
                      label: string;
                      extra?: ReactNode;
                    }>
                  ).map((item) => {
                    const busy = isBusy(item.key);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={navigating}
                        onClick={() => navigateWithLoader(item.key, item.href)}
                        className="w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                      >
                        {busy ? <MenuSpinner className="text-[#D4AF37]" /> : null}
                        {busy ? `Opening ${item.label.toLowerCase()}…` : item.label}
                        {!busy ? item.extra : null}
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-gray-100 p-2">
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut || navigating}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {loggingOut || isBusy('logout') ? (
                      <>
                        <MenuSpinner className="text-red-600" />
                        Signing out…
                      </>
                    ) : (
                      'Sign out'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
