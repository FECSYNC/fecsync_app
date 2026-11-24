/**
 * React Query hooks for admin deliveries (Phase 4 F8).
 * Keys under ['shipments'] — invalidate on book/cancel alongside orderKeys.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { P } from "@/lib/auth/permissions";
import { useAuthStore } from "@/store/authStore";
import {
  bookShipment,
  cancelShipment,
  getShipmentById,
  getShipments,
  type ShipmentDto,
  type ShipmentsListResponse,
} from "@/services/shipping";
import { orderKeys } from "@/hooks/useOrders";
import { ADMIN_ORDERS_LIVE_MS } from "@/utils/adminLiveRefresh";
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from "@/lib/adminListCache";
import { withAdminListSnapshot } from "@/lib/adminListSnapshot";

function normalizeShipmentListFilters(filters?: {
  status?: string;
  orderId?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 100;
  const status = filters?.status?.trim() || undefined;
  const orderId = filters?.orderId?.trim() || undefined;
  return {
    page,
    limit,
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
  };
}

export const shipmentKeys = {
  all: ["shipments"] as const,
  lists: () => [...shipmentKeys.all, "list"] as const,
  list: (filters: {
    status?: string;
    orderId?: string;
    page?: number;
    limit?: number;
  }) =>
    [...shipmentKeys.lists(), normalizeShipmentListFilters(filters)] as const,
  details: () => [...shipmentKeys.all, "detail"] as const,
  detail: (id: string) => [...shipmentKeys.details(), id] as const,
  byOrder: (orderId: string) =>
    [...shipmentKeys.all, "by-order", orderId] as const,
};

/** Shared invalidate for book/cancel from any UI surface. */
export async function invalidateShipmentCaches(
  queryClient: QueryClient,
  orderId?: string | null
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: shipmentKeys.all });
  if (orderId) {
    await queryClient.invalidateQueries({
      queryKey: orderKeys.byId(orderId),
    });
  }
  await queryClient.invalidateQueries({ queryKey: orderKeys.admin() });
  await queryClient.invalidateQueries({ queryKey: orderKeys.adminBell() });
  await queryClient.invalidateQueries({ queryKey: orderKeys.mine() });
}

export function useShipmentsQuery(filters?: {
  status?: string;
  orderId?: string;
  page?: number;
  limit?: number;
  enabled?: boolean;
}) {
  const can = useAuthStore((s) => s.can);
  const normalized = normalizeShipmentListFilters({
    status: filters?.status,
    orderId: filters?.orderId,
    page: filters?.page,
    limit: filters?.limit,
  });
  const enabled = (filters?.enabled ?? true) && can(P.DeliveriesRead);
  const listKey = shipmentKeys.list(normalized);

  return useQuery<ShipmentsListResponse, Error>({
    queryKey: listKey,
    queryFn: () => getShipments(normalized),
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot<ShipmentsListResponse>(listKey),
    refetchOnWindowFocus: true,
    refetchInterval: ADMIN_ORDERS_LIVE_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
}

export function useShipmentByIdQuery(
  id: string | undefined | null,
  options?: { enabled?: boolean }
) {
  const can = useAuthStore((s) => s.can);
  const shipmentId = String(id || "").trim();
  const enabled =
    (options?.enabled ?? true) &&
    can(P.DeliveriesRead) &&
    Boolean(shipmentId);

  return useQuery<ShipmentDto | null, Error>({
    queryKey: shipmentKeys.detail(shipmentId),
    queryFn: () => getShipmentById(shipmentId),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

async function invalidateShipmentAndOrders(
  queryClient: ReturnType<typeof useQueryClient>,
  orderId?: string | null
) {
  await invalidateShipmentCaches(queryClient, orderId);
}

export function useBookShipmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => bookShipment(orderId),
    onSuccess: async (shipment) => {
      await invalidateShipmentAndOrders(queryClient, shipment.orderId);
    },
  });
}

export function useCancelShipmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shipmentId: string) => cancelShipment(shipmentId),
    onSuccess: async (shipment) => {
      await invalidateShipmentAndOrders(queryClient, shipment.orderId);
    },
  });
}
