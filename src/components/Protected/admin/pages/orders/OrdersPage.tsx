'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { orderTabs, orderMatchesAdminTab, type OrderTabId } from './order-tabs';
import OrdersTable from './OrdersTable';
import OrderFilters from './OrderFilters';
import { useAdminOrdersQuery } from '@/hooks/useOrders';
import { useAuthStore } from '@/store/authStore';
import { useParkContextQuery } from '@/hooks/useParkContext';

function isOrderTabId(value: string | null): value is OrderTabId {
  return !!value && orderTabs.some((tab) => tab.id === value);
}

export default function OrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get('status');
  const parkLocked = useAuthStore((s) => s.user?.parkLocked === true);
  const parkContextQuery = useParkContextQuery(parkLocked);

  const [activeTab, setActiveTab] = useState<OrderTabId>(
    isOrderTabId(statusFromUrl) ? statusFromUrl : 'pending'
  );
  const [filters, setFilters] = useState({
    search: '',
    dateRange: ''
  });
  const [livePulse, setLivePulse] = useState(false);
  const prevPaidCountRef = useRef<number | null>(null);

  const {
    data: allOrders = [],
    isPending,
    isFetching,
    error,
    dataUpdatedAt,
  } = useAdminOrdersQuery();

  const paidCount = useMemo(
    () =>
      allOrders.filter(
        (order) => order.status === 'paid' || order.status === 'shipping'
      ).length,
    [allOrders]
  );

  // Honor ?status=paid (and other tabs) from notifications / deep links
  useEffect(() => {
    if (isOrderTabId(statusFromUrl)) {
      setActiveTab(statusFromUrl);
    }
  }, [statusFromUrl]);

  useEffect(() => {
    if (prevPaidCountRef.current === null) {
      prevPaidCountRef.current = paidCount;
      return;
    }
    if (paidCount > prevPaidCountRef.current) {
      setLivePulse(true);
      setActiveTab('paid');
      const params = new URLSearchParams(searchParams.toString());
      params.set('status', 'paid');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      const t = window.setTimeout(() => setLivePulse(false), 2500);
      prevPaidCountRef.current = paidCount;
      return () => window.clearTimeout(t);
    }
    prevPaidCountRef.current = paidCount;
  }, [paidCount, pathname, router, searchParams]);

  const filteredOrders = useMemo(() => {
    return allOrders.filter((order) =>
      orderMatchesAdminTab(order.status, activeTab)
    );
  }, [allOrders, activeTab]);

  const tabsWithCounts = useMemo(() => {
    return orderTabs.map((tab) => ({
      ...tab,
      count: allOrders.filter((order) =>
        orderMatchesAdminTab(order.status, tab.id as OrderTabId)
      ).length,
    }));
  }, [allOrders]);

  const handleTabChange = (tabId: OrderTabId) => {
    setActiveTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', tabId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const lastUpdatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-sm sm:text-base text-gray-600">Track and manage customer orders</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              livePulse
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-gray-100 text-gray-600'
            }`}
            title="Orders refresh automatically while this page is open"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isFetching ? 'bg-[#D4AF37] animate-pulse' : 'bg-emerald-500'
              }`}
            />
            {livePulse ? 'New payment received' : 'Live'}
          </div>
          {lastUpdatedLabel && (
            <p className="text-[11px] text-gray-400">Updated {lastUpdatedLabel}</p>
          )}
        </div>
      </div>

      {parkLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Showing orders stamped to your assigned park
          {parkContextQuery.data?.effectiveLocationName
            ? ` (${parkContextQuery.data.effectiveLocationName})`
            : ''}
          . Mixed or company-shared orders stay visible to company-wide admins only.
        </div>
      ) : null}

      <div className="border-b border-gray-200 -mx-1 px-1 overflow-x-auto">
        <nav className="-mb-px flex gap-4 sm:gap-8 min-w-max">
          {tabsWithCounts.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id as OrderTabId)}
              className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-[#D4AF37] text-[#D4AF37]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                    livePulse && tab.id === 'paid'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <OrderFilters 
        filters={filters} 
        onFiltersChange={setFilters}
        activeTab={activeTab}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error loading orders: {error.message}</p>
        </div>
      )}

      <OrdersTable 
        filters={filters} 
        activeTab={activeTab}
        loading={isPending && allOrders.length === 0}
        orders={filteredOrders}
      />
    </div>
  );
}
