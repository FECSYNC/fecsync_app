'use client';

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ticketingKeys,
  listTicketingProducts,
  getTicketingProduct,
  createTicketingProduct,
  patchTicketingProduct,
  archiveTicketingProduct,
  replaceProductPrices,
  linkProductAddOn,
  unlinkProductAddOn,
  patchProductExpiry,
  listTicketSessions,
  createTicketSession,
  patchTicketSession,
  closeTicketSession,
  listCapacityResources,
  createCapacityResource,
  patchCapacityResource,
  listStockPeriods,
  createStockPeriod,
  patchStockPeriod,
  deleteStockPeriod,
  getTicketingSettings,
  patchTicketingSettings,
  type ProductListParams,
  type AdmissionProductDto,
  type PriceBandInput,
  type BookingSettingsDto,
  type CapacityResourceType,
} from '@/services/ticketing';
import { adminBookingKeys } from '@/services/adminBookings';
import { broadcastCatalogChange } from '@/lib/catalogSync';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export { ticketingKeys };

/**
 * Keep Catalog category counts + public book catalog + staff booking surfaces
 * in sync when admission products are created/updated/archived.
 * Also refreshes Membership plan Add-ons pickers (same query tree under
 * ticketingKeys.all) so new ticket products appear in realtime.
 */
function invalidateAfterAdmissionProductMutation(
  queryClient: QueryClient,
  opts?: { id?: string; action?: 'create' | 'update' | 'delete' }
) {
  void queryClient.invalidateQueries({ queryKey: ticketingKeys.all });
  void queryClient.invalidateQueries({
    queryKey: [...ticketingKeys.all, 'products'],
  });
  void queryClient.invalidateQueries({ queryKey: ['public', 'booking'] });
  void queryClient.invalidateQueries({ queryKey: adminBookingKeys.all });
  // Public book catalog embeds category names — refresh without shop caches.
  // Cross-tab: QueryProvider subscribeCatalogChange → invalidateCatalogQueries
  // (includes admin ticketing) so Memberships → Plans Add-ons stay live.
  broadcastCatalogChange({
    kind: 'category-counts',
    action: opts?.action ?? 'update',
    id: opts?.id,
  });
}

export function useTicketingProductsQuery(
  filters: ProductListParams = {},
  enabled = true
) {
  const key = ticketingKeys.products(filters);
  return useQuery({
    queryKey: key,
    queryFn: () => listTicketingProducts(filters),
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

export function useTicketingProductQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: ticketingKeys.product(id),
    queryFn: () => getTicketingProduct(id),
    enabled: enabled && Boolean(id),
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useCreateTicketingProductMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTicketingProduct,
    onSuccess: (product) => {
      qc.setQueryData(ticketingKeys.product(product.id), product);
      invalidateAfterAdmissionProductMutation(qc, {
        id: product.id,
        action: 'create',
      });
    },
  });
}

export function usePatchTicketingProductMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => patchTicketingProduct(id, payload),
    onSuccess: (product: AdmissionProductDto) => {
      qc.setQueryData(ticketingKeys.product(product.id), product);
      invalidateAfterAdmissionProductMutation(qc, {
        id: product.id,
        action: 'update',
      });
    },
  });
}

export function useArchiveTicketingProductMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveTicketingProduct,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ticketingKeys.all });
      // Drop from every product list cache immediately (default lists hide archived).
      qc.setQueriesData<AdmissionProductDto[]>(
        { queryKey: [...ticketingKeys.all, 'products'] },
        (old) => {
          if (!Array.isArray(old)) return old;
          return old.filter((p) => p.id !== id);
        }
      );
    },
    onSuccess: (_data, id) => {
      invalidateAfterAdmissionProductMutation(qc, {
        id: typeof id === 'string' ? id : undefined,
        action: 'delete',
      });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ticketingKeys.all });
    },
  });
}

export function useReplaceProductPricesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      prices,
    }: {
      productId: string;
      prices: PriceBandInput[];
    }) => replaceProductPrices(productId, prices),
    onSuccess: (product) => {
      qc.setQueryData(ticketingKeys.product(product.id), product);
      invalidateAfterAdmissionProductMutation(qc, {
        id: product.id,
        action: 'update',
      });
    },
  });
}

export function useLinkProductAddOnMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      payload,
    }: {
      productId: string;
      payload: {
        addOnProductId: string;
        required?: boolean;
        maxQty?: number | null;
        stockPeriodId?: string | null;
      };
    }) => linkProductAddOn(productId, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ticketingKeys.product(vars.productId),
      });
      invalidateAfterAdmissionProductMutation(qc, {
        id: vars.productId,
        action: 'update',
      });
    },
  });
}

export function useUnlinkProductAddOnMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      addOnProductId,
    }: {
      productId: string;
      addOnProductId: string;
    }) => unlinkProductAddOn(productId, addOnProductId),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ticketingKeys.product(vars.productId),
      });
      invalidateAfterAdmissionProductMutation(qc, {
        id: vars.productId,
        action: 'update',
      });
    },
  });
}

export function usePatchProductExpiryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      defaultPassExpiryDays,
    }: {
      productId: string;
      defaultPassExpiryDays: number | null;
    }) => patchProductExpiry(productId, defaultPassExpiryDays),
    onSuccess: (product) => {
      qc.setQueryData(ticketingKeys.product(product.id), product);
      invalidateAfterAdmissionProductMutation(qc, {
        id: product.id,
        action: 'update',
      });
    },
  });
}

export function useTicketSessionsQuery(
  filters: {
    productId?: string;
    from?: string;
    to?: string;
    includeClosed?: boolean;
  } = {},
  enabled = true
) {
  const key = ticketingKeys.sessions(filters);
  return useQuery({
    queryKey: key,
    queryFn: () => listTicketSessions(filters),
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

function invalidateSessionsAndAvailability(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: [...ticketingKeys.all, 'sessions'] });
  void qc.invalidateQueries({
    queryKey: [...ticketingKeys.all, 'availability'],
  });
  void qc.invalidateQueries({ queryKey: ['public', 'booking'] });
  void qc.invalidateQueries({ queryKey: adminBookingKeys.all });
}

export function useCreateTicketSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTicketSession,
    onSuccess: () => {
      invalidateSessionsAndAvailability(qc);
    },
  });
}

export function usePatchTicketSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => patchTicketSession(id, payload),
    onSuccess: () => {
      invalidateSessionsAndAvailability(qc);
    },
  });
}

export function useCloseTicketSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeTicketSession,
    onSuccess: () => {
      invalidateSessionsAndAvailability(qc);
    },
  });
}

export function useCapacityResourcesQuery(
  filters: { locationId?: string; includeArchived?: boolean } = {},
  enabled = true
) {
  const key = ticketingKeys.resources(filters);
  return useQuery({
    queryKey: key,
    queryFn: () => listCapacityResources(filters),
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

function invalidateAfterResourceMutation(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ticketingKeys.all });
  void qc.invalidateQueries({ queryKey: ['public', 'booking'] });
  void qc.invalidateQueries({ queryKey: adminBookingKeys.all });
}

export function useCreateCapacityResourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCapacityResource,
    onSuccess: () => {
      invalidateAfterResourceMutation(qc);
    },
  });
}

export function usePatchCapacityResourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<{
        name: string;
        type: CapacityResourceType;
        defaultCapacity: number;
        archive: boolean;
        unarchive: boolean;
      }>;
    }) => patchCapacityResource(id, payload),
    onSuccess: () => {
      invalidateAfterResourceMutation(qc);
    },
  });
}

export function useStockPeriodsQuery(
  filters: { locationId?: string; productId?: string } = {},
  enabled = true
) {
  const key = ticketingKeys.stockPeriods(filters);
  return useQuery({
    queryKey: key,
    queryFn: () => listStockPeriods(filters),
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

function invalidateStockPeriods(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({
    queryKey: [...ticketingKeys.all, 'stock-periods'],
  });
  void qc.invalidateQueries({
    queryKey: [...ticketingKeys.all, 'availability'],
  });
  void qc.invalidateQueries({ queryKey: ['public', 'booking'] });
}

export function useCreateStockPeriodMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createStockPeriod,
    onSuccess: () => {
      invalidateStockPeriods(qc);
    },
  });
}

export function usePatchStockPeriodMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        startsAt?: string;
        endsAt?: string;
        kind?: 'available' | 'blocked';
        quantity?: number | null;
        productIds?: string[];
      };
    }) => patchStockPeriod(id, payload),
    onSuccess: () => {
      invalidateStockPeriods(qc);
    },
  });
}

export function useDeleteStockPeriodMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteStockPeriod,
    onSuccess: () => {
      invalidateStockPeriods(qc);
    },
  });
}

export function useTicketingSettingsQuery(
  locationId?: string | null,
  enabled = true
) {
  const key = ticketingKeys.settings(locationId);
  return useQuery({
    queryKey: key,
    queryFn: () => getTicketingSettings(locationId || null),
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
  });
}

export function usePatchTicketingSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      payload: Partial<BookingSettingsDto> & { locationId?: string | null }
    ) => patchTicketingSettings(payload),
    onSuccess: (settings, vars) => {
      const key = ticketingKeys.settings(vars.locationId ?? null);
      qc.setQueryData(key, settings);
      void qc.invalidateQueries({ queryKey: key });
      // Public venue DTO embeds allowOnlinePayLater / TTLs from settings.
      void qc.invalidateQueries({ queryKey: ['public', 'booking'] });
      void qc.invalidateQueries({ queryKey: adminBookingKeys.all });
    },
  });
}
