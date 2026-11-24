'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { OrderCard } from '@/components/Protected/profile/orders/order-card';
import { OrderTabs } from '@/components/Protected/profile/orders/order-tab';
import EmptyState from '@/components/common/empty-state';
import OrderDetailsModal from '@/components/Protected/profile/orders/order-details-modal';
import {
  getProfileOrderTabLabel,
  orderMatchesProfileTab,
  sortOrdersNewestFirst,
  type ProfileOrderTabId,
} from '@/services/order';
import { useOrdersQuery } from '@/hooks/useOrders';
import { orderTabs } from '@/components/Protected/profile/profile-tabs';

export default function OrdersSection() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeOrderTab, setActiveOrderTab] = useState<ProfileOrderTabId>('all');
  const [deepLinkOrderId, setDeepLinkOrderId] = useState<string | null>(null);

  const { data: allOrders = [], isLoading, error } = useOrdersQuery();

  useEffect(() => {
    const raw = searchParams.get('orderId')?.trim() || '';
    if (raw) setDeepLinkOrderId(raw);
  }, [searchParams]);

  const clearDeepLink = () => {
    setDeepLinkOrderId(null);
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has('orderId')) return;
    params.delete('orderId');
    const qs = params.toString();
    router.replace(qs ? `/profile?${qs}` : '/profile?tab=orders');
  };

  const sortedOrders = useMemo(
    () => sortOrdersNewestFirst(allOrders),
    [allOrders]
  );

  const filteredOrders = useMemo(
    () =>
      sortedOrders.filter((order) =>
        orderMatchesProfileTab(order, activeOrderTab)
      ),
    [sortedOrders, activeOrderTab]
  );

  const orderCounts = useMemo(() => {
    const counts = Object.fromEntries(
      orderTabs.map((tab) => [tab.id, 0])
    ) as Record<ProfileOrderTabId, number>;

    for (const order of sortedOrders) {
      for (const tab of orderTabs) {
        if (orderMatchesProfileTab(order, tab.id)) {
          counts[tab.id] += 1;
        }
      }
    }

    return counts;
  }, [sortedOrders]);

  if (isLoading) {
    return (
      <div className="bg-white md:m-6 md:rounded-lg md:border">
        <div className="p-4 md:p-6 border-b">
          <h2 className="text-lg font-semibold text-black">My orders</h2>
        </div>
        <div className="p-4 md:p-6 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#D4AF37] rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white md:m-6 md:rounded-lg md:border">
        <div className="p-4 md:p-6 border-b">
          <h2 className="text-lg font-semibold text-black">My orders</h2>
        </div>
        <div className="p-4 md:p-6">
          <EmptyState
            title="Error loading orders"
            description={
              error?.message ||
              String(error) ||
              'Failed to load orders. Please try again.'
            }
          />
        </div>
      </div>
    );
  }

  const tabLabel = getProfileOrderTabLabel(activeOrderTab);

  return (
    <div className="bg-white md:m-6 md:rounded-lg md:border">
      <div className="p-4 md:p-6 border-b">
        <h2 className="text-lg font-semibold text-black">My orders</h2>
      </div>

      <OrderTabs
        activeOrderTab={activeOrderTab}
        onOrderTabChange={(tabId) =>
          setActiveOrderTab(tabId as ProfileOrderTabId)
        }
        orderCounts={orderCounts}
      />

      <div className="p-4 md:p-6 space-y-4">
        {filteredOrders.length > 0 ? (
          filteredOrders.map((order) => (
            <OrderCard key={order._id} order={order} />
          ))
        ) : (
          <EmptyState
            title={`No ${tabLabel} orders`}
            description={`You don't have any ${tabLabel} orders at the moment.`}
          />
        )}
      </div>

      <OrderDetailsModal
        isOpen={Boolean(deepLinkOrderId)}
        onClose={clearDeepLink}
        orderId={deepLinkOrderId || ''}
      />
    </div>
  );
}
