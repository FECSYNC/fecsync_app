// src/hooks/useOrders.ts
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { 
  getMyOrders, 
  getOrders,
  getOrderById,
  createOrderFromCart, 
  deleteOrder, 
  updateOrderStatus,
  type Order,
  type OrderPlacementResult,
  type CreateOrderFromCartInput,
  sortOrdersNewestFirst,
} from '@/services/order';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { cartKeys } from './useCart';
import {
  ADMIN_ORDER_DETAIL_LIVE_MS,
  ADMIN_ORDERS_BELL_LIVE_MS,
  ADMIN_ORDERS_LIVE_MS,
  CUSTOMER_ORDERS_LIVE_MS,
} from '@/utils/adminLiveRefresh';
import { shipmentKeys } from '@/hooks/useShipments';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import { adminListSnapshotSeed } from '@/lib/adminListSnapshot';

/** Query Keys */
export const orderKeys = {
  all: ['orders'] as const,
  mine: () => [...orderKeys.all, 'mine'] as const,
  admin: () => [...orderKeys.all, 'admin'] as const,
  /** Light list for header paid-queue badge (hydrate=0). */
  adminBell: () => [...orderKeys.all, 'admin-bell'] as const,
  byId: (id: string) => [...orderKeys.all, id] as const,
  pending: () => [...orderKeys.all, 'pending'] as const,
};

function findCachedAdminOrder(queryClient: QueryClient, orderId: string): Order | undefined {
  if (!orderId) return undefined;
  const detail = queryClient.getQueryData<Order>(orderKeys.byId(orderId));
  if (detail) return detail;
  for (const key of [orderKeys.admin(), orderKeys.adminBell()]) {
    const lists = queryClient.getQueriesData<Order[]>({ queryKey: key });
    for (const [, data] of lists) {
      if (!Array.isArray(data)) continue;
      const found = data.find((row) => row._id === orderId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Hook to fetch all user orders.
 * Light live refresh so profile orders pick up paid status after checkout.
 */
export function useOrdersQuery(enabled: boolean = true) {
  const { isAuthenticated } = useAuthStore();
  
  return useQuery<Order[], Error>({
    queryKey: orderKeys.mine(),
    queryFn: async () => {
      const orders = await getMyOrders();
      return sortOrdersNewestFirst(orders ?? []);
    },
    enabled: enabled && isAuthenticated,
    staleTime: CUSTOMER_ORDERS_LIVE_MS,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: CUSTOMER_ORDERS_LIVE_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Hook to get the current pending/initiated order
 * Derived from useOrdersQuery (no separate API call!)
 */
export function usePendingOrderQuery(enabled: boolean = true) {
  const { data: allOrders = [], isLoading, error } = useOrdersQuery(enabled);
  
  // Find the first pending or initiated order
  const pendingOrder = allOrders.find(order => 
    order.status === 'pending' || order.status === 'initiated'
  ) ?? null;

  return {
    data: pendingOrder,
    isLoading,
    error,
    hasPendingOrder: !!pendingOrder,
  };
}

/**
 * Hook to create an order from the current cart
 * Includes optimistic updates and cache invalidation
 */
export function useCreateOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation<OrderPlacementResult, Error, CreateOrderFromCartInput | void>({
    mutationFn: async (input) => {
      return await createOrderFromCart(input || undefined);
    },
    onSuccess: (result) => {
      if (result.success && result.order) {
        // Optimistically add the new order to the cache
        queryClient.setQueryData<Order[]>(orderKeys.mine(), (oldOrders = []) => {
          // Check if order already exists (avoid duplicates)
          const exists = oldOrders.some(o => o._id === result.order!._id);
          if (exists) return oldOrders;
          return [result.order!, ...oldOrders];
        });
      }
      
      // Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: orderKeys.mine() });
      // Cart may have been modified, refetch it
      queryClient.invalidateQueries({ queryKey: cartKeys.mine() });
    },
    onError: (error) => {
      console.error('Failed to create order:', error);
      // Optionally show error toast here
    },
  });
}

/**
 * Hook to delete an order (pending/initiated orders only)
 * Includes optimistic updates
 */
export function useDeleteOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    boolean,
    Error,
    string,
    { previousOrders?: Order[] }
  >({
    mutationFn: async (orderId: string) => {
      const result = await deleteOrder(orderId);
      return result.deleted ?? false;
    },
    onMutate: async (orderId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: orderKeys.mine() });

      // Snapshot previous value for rollback
      const previousOrders = queryClient.getQueryData<Order[]>(orderKeys.mine());

      // Optimistically remove the order
      queryClient.setQueryData<Order[]>(orderKeys.mine(), (oldOrders = []) => {
        return oldOrders.filter(order => order._id !== orderId);
      });

      // Return context for rollback
      return { previousOrders };
    },
    onError: (error, orderId, context) => {
      console.error('Failed to delete order:', error);
      // Rollback on error
      if (context?.previousOrders) {
        queryClient.setQueryData(orderKeys.mine(), context.previousOrders);
      }
    },
    onSuccess: () => {
      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: orderKeys.mine() });
    },
  });
}

/**
 * Hook to get a specific order by ID
 * Uses cache-first approach (checks existing orders before fetching)
 */
export function useOrderByIdQuery(orderId: string | null, enabled: boolean = true) {
  const { data: allOrders = [] } = useOrdersQuery(enabled);
  
  // First check if order exists in cache
  const cachedOrder = allOrders.find(order => order._id === orderId);
  
  return useQuery<Order | null, Error>({
    queryKey: orderKeys.byId(orderId ?? ''),
    queryFn: async () => {
      // If order exists in cache, return it
      if (cachedOrder) return cachedOrder;
      
      // Otherwise, would need to fetch individual order
      // (Not implemented in current API, so return null)
      return null;
    },
    enabled: enabled && !!orderId,
    staleTime: 2 * 60 * 1000,
    initialData: cachedOrder ?? undefined,
  });
}

/**
 * Hook to fetch all orders (admin orders page).
 * Live-polls while the tab is visible so new paid checkouts appear automatically.
 */
export function useAdminOrdersQuery(enabled: boolean = true) {
  const can = useAuthStore((state) => state.can);
  const orgId = useAuthStore((state) => state.user?.orgId ?? null);
  const queryClient = useQueryClient();
  const seed = adminListSnapshotSeed<Order[]>(orderKeys.admin());

  return useQuery<Order[], Error>({
    queryKey: orderKeys.admin(),
    queryFn: async () => {
      // Match API default (200) so paid-queue / live badge stay accurate.
      const orders = await getOrders({ limit: 200 });
      const list = orders ?? [];

      // Keep open detail views / prefetch caches aligned with the live list.
      for (const order of list) {
        if (!order?._id) continue;
        queryClient.setQueryData<Order | null>(orderKeys.byId(order._id), (old) => {
          if (!old) return order;
          const cart = order.carts;
          const hasPopulatedCart =
            cart &&
            typeof cart === 'object' &&
            (Array.isArray((cart as { lines?: unknown[] }).lines) ||
              Array.isArray((cart as { products?: unknown[] }).products));
          return {
            ...old,
            ...order,
            carts: hasPopulatedCart ? order.carts : old.carts,
          } as Order;
        });
      }

      return list;
    },
    enabled: enabled && Boolean(orgId) && can(P.OrdersRead),
    staleTime: ADMIN_LIST_STALE_MS,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    // Keep the paid queue fresh without blocking first paint after prefetch.
    refetchInterval: ADMIN_ORDERS_LIVE_MS,
    refetchIntervalInBackground: false,
    retry: false,
    initialData: seed.initialData,
    initialDataUpdatedAt: seed.initialDataUpdatedAt,
    placeholderData: (previous) => previous,
  });
}

/**
 * Light orders feed for AdminHeader paid-queue badge.
 * hydrate=0 skips cart joins; smaller limit + slower poll on every admin page.
 */
export function useAdminOrdersBellQuery(enabled: boolean = true) {
  const can = useAuthStore((state) => state.can);

  return useQuery<Order[], Error>({
    queryKey: orderKeys.adminBell(),
    queryFn: async () => {
      const orders = await getOrders({ limit: 40, hydrate: 0 });
      return orders ?? [];
    },
    enabled: enabled && can(P.OrdersRead),
    staleTime: ADMIN_ORDERS_BELL_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: ADMIN_ORDERS_BELL_LIVE_MS,
    refetchIntervalInBackground: false,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

/** Admin order detail — seeds from list cache for instant View; live-polls status. */
export function useAdminOrderByIdQuery(orderId: string, enabled: boolean = true) {
  const queryClient = useQueryClient();
  const cached = findCachedAdminOrder(queryClient, orderId);

  return useQuery<Order | null, Error>({
    queryKey: orderKeys.byId(orderId),
    queryFn: async () => {
      if (!orderId) return null;
      return await getOrderById(orderId);
    },
    enabled: enabled && !!orderId,
    initialData: cached,
    initialDataUpdatedAt: cached ? Date.now() : undefined,
    staleTime: ADMIN_ORDER_DETAIL_LIVE_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchInterval: ADMIN_ORDER_DETAIL_LIVE_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function prefetchAdminOrderDetail(queryClient: QueryClient, orderId: string) {
  if (!orderId) return;
  const cached = findCachedAdminOrder(queryClient, orderId);
  if (cached) queryClient.setQueryData(orderKeys.byId(orderId), cached);
  void queryClient.prefetchQuery({
    queryKey: orderKeys.byId(orderId),
    queryFn: () => getOrderById(orderId),
    staleTime: 60_000,
  });
}

/**
 * Hook to update order status (admin flow)
 */
export function useUpdateOrderStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation<Order, Error, { orderId: string; status: Order['status'] }>({
    mutationFn: async ({ orderId, status }) => updateOrderStatus(orderId, status),
    onSuccess: (updatedOrder) => {
      const mergeCachedOrder = (existing: Order, incoming: Order): Order => {
        const cart = incoming.carts;
        const hasPopulatedCart =
          cart &&
          typeof cart === 'object' &&
          (Array.isArray((cart as { lines?: unknown[] }).lines) ||
            Array.isArray((cart as { products?: unknown[] }).products));

        return {
          ...existing,
          ...incoming,
          carts: hasPopulatedCart ? incoming.carts : existing.carts,
        } as Order;
      };

      queryClient.setQueryData<Order[]>(orderKeys.admin(), (old = []) =>
        old.map((order) =>
          order._id === updatedOrder._id
            ? mergeCachedOrder(order, updatedOrder)
            : order
        )
      );
      queryClient.setQueryData<Order[]>(orderKeys.adminBell(), (old = []) =>
        old.map((order) =>
          order._id === updatedOrder._id
            ? mergeCachedOrder(order, updatedOrder)
            : order
        )
      );
      queryClient.setQueryData<Order[]>(orderKeys.mine(), (old = []) =>
        old.map((order) =>
          order._id === updatedOrder._id
            ? mergeCachedOrder(order, updatedOrder)
            : order
        )
      );
      queryClient.setQueryData<Order | null>(orderKeys.byId(updatedOrder._id), (old) =>
        old ? mergeCachedOrder(old, updatedOrder) : updatedOrder
      );
      queryClient.invalidateQueries({ queryKey: orderKeys.admin() });
      queryClient.invalidateQueries({ queryKey: orderKeys.adminBell() });
      queryClient.invalidateQueries({ queryKey: orderKeys.mine() });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: shipmentKeys.all });
    },
  });
}

