// src/hooks/useFabrics.ts
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { 
  getFabrics,
  getAdminFabrics,
  getFabricById,
  getAdminFabricById,
  createFabric,
  updateFabric,
  deleteFabric,
  type Fabric,
  type CreateFabricInput,
  type UpdateFabricInput
} from '@/services/fabric';
import {
  broadcastCatalogChange,
  invalidateCatalogQueries,
} from '@/lib/catalogSync';
import { invalidateBillingUsageQueries } from '@/hooks/useBilling';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { adminListSnapshotSeed } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';

/** Query Keys */
export const fabricKeys = {
  all: ['fabrics'] as const,
  lists: () => [...fabricKeys.all, 'list'] as const,
  adminLists: () => [...fabricKeys.all, 'admin-list'] as const,
  detail: (id: string) => [...fabricKeys.all, id] as const,
  adminDetail: (id: string) => [...fabricKeys.all, 'admin-detail', id] as const,
};

const catalogRefetchAll = { refetchType: 'all' as const };

function invalidateFabricCatalogQueries(queryClient: QueryClient) {
  invalidateCatalogQueries(queryClient, 'fabric');
}

function syncLocalCartWithFabric(id: string, next: Fabric | null) {
  void import('@/store/cartStore')
    .then(({ useCartStore }) => {
      const { items, setItems } = useCartStore.getState();
      if (!items.some((line) => line.id === id)) return;

      if (next === null) {
        setItems(items.filter((line) => line.id !== id));
        return;
      }

      const bundlePrice = Number(next.bundlePrice ?? next.pricePerMeter);
      setItems(
        items.map((line) =>
          line.id === id
            ? {
                ...line,
                name: next.name || line.name,
                image: next.image || line.image,
                price: Number.isFinite(bundlePrice) ? bundlePrice : line.price,
                yardBundle: next.yardBundle ?? line.yardBundle,
                taxRate:
                  next.taxRate !== undefined ? next.taxRate : line.taxRate,
                taxExempt:
                  next.taxExempt !== undefined
                    ? Boolean(next.taxExempt)
                    : line.taxExempt,
              }
            : line
        )
      );
    })
    .catch(() => {
      /* cart store optional during SSR */
    });
}

function findCachedAdminFabric(queryClient: QueryClient, id: string): Fabric | undefined {
  if (!id) return undefined;
  const detail = queryClient.getQueryData<Fabric>(fabricKeys.adminDetail(id));
  if (detail) return detail;
  const lists = queryClient.getQueriesData<Fabric[]>({ queryKey: fabricKeys.adminLists() });
  for (const [, data] of lists) {
    if (!Array.isArray(data)) continue;
    const found = data.find((row) => row._id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Hook to fetch all fabrics (storefront org).
 */
export function useFabricsQuery(enabled: boolean = true) {
  return useQuery<Fabric[], Error>({
    queryKey: fabricKeys.lists(),
    queryFn: async () => {
      const fabrics = await getFabrics();
      return fabrics ?? [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

/** Admin fabrics for actor.orgId (Step 5.3). */
export function useAdminFabricsQuery(enabled: boolean = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const seed = adminListSnapshotSeed<Fabric[]>(fabricKeys.adminLists());

  return useQuery<Fabric[], Error>({
    queryKey: fabricKeys.adminLists(),
    queryFn: async () => {
      const fabrics = await getAdminFabrics();
      return fabrics ?? [];
    },
    enabled: enabled && Boolean(orgId),
    ...adminListQueryDefaults,
    initialData: seed.initialData,
    initialDataUpdatedAt: seed.initialDataUpdatedAt,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

export function useFabricByIdQuery(id: string | undefined) {
  return useQuery<Fabric | null, Error>({
    queryKey: fabricKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      return await getFabricById(id);
    },
    enabled: Boolean(id),
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Admin fabric detail — seeds from list cache for instant View. */
export function useAdminFabricByIdQuery(id: string | undefined) {
  const queryClient = useQueryClient();
  const cached = id ? findCachedAdminFabric(queryClient, id) : undefined;

  return useQuery<Fabric | null, Error>({
    queryKey: fabricKeys.adminDetail(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      return await getAdminFabricById(id);
    },
    enabled: Boolean(id),
    initialData: cached,
    initialDataUpdatedAt: cached ? Date.now() : undefined,
    staleTime: 60_000,
    refetchOnMount: false,
    retry: 1,
  });
}

export function prefetchAdminFabricDetail(queryClient: QueryClient, id: string) {
  if (!id) return;
  const cached = findCachedAdminFabric(queryClient, id);
  if (cached) queryClient.setQueryData(fabricKeys.adminDetail(id), cached);
  void queryClient.prefetchQuery({
    queryKey: fabricKeys.adminDetail(id),
    queryFn: () => getAdminFabricById(id),
    staleTime: 60_000,
  });
}

/**
 * Hook to create a new fabric (admin)
 */
export function useCreateFabricMutation() {
  const queryClient = useQueryClient();

  return useMutation<Fabric, Error, CreateFabricInput>({
    mutationFn: async (payload) => {
      return await createFabric(payload);
    },
    onSuccess: (newFabric) => {
      invalidateFabricCatalogQueries(queryClient);
      queryClient.setQueryData(fabricKeys.adminDetail(newFabric._id), newFabric);
      queryClient.setQueryData(fabricKeys.detail(newFabric._id), newFabric);

      queryClient.setQueryData<Fabric[]>(fabricKeys.adminLists(), (old = []) => {
        const exists = old.some((f) => f._id === newFabric._id);
        if (exists) return old;
        return [{ ...newFabric, productCount: Number(newFabric.productCount ?? 0) }, ...old];
      });
      queryClient.setQueryData<Fabric[]>(fabricKeys.lists(), (old = []) => {
        const exists = old.some((f) => f._id === newFabric._id);
        if (exists) return old;
        return [newFabric, ...old];
      });
      broadcastCatalogChange({
        kind: 'fabric',
        action: 'create',
        id: newFabric._id,
      });
      invalidateBillingUsageQueries(queryClient);
    },
    onError: (error) => {
      console.error('Error creating fabric:', error);
    },
  });
}

/**
 * Hook to update a fabric (admin)
 */
export function useUpdateFabricMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    Fabric,
    Error,
    { _id: string; payload: UpdateFabricInput },
    { previousFabrics: Fabric[] | undefined }
  >({
    mutationFn: async ({ _id, payload }) => {
      return await updateFabric(_id, payload);
    },
    onMutate: async ({ _id, payload }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: fabricKeys.adminLists() });

      // Snapshot previous value for rollback
      const previousFabrics = queryClient.getQueryData<Fabric[]>(fabricKeys.adminLists());

      // Optimistically update the cache
      queryClient.setQueryData<Fabric[]>(fabricKeys.adminLists(), (old = []) => {
        return old.map(f => 
          f._id === _id 
            ? { ...f, ...payload }
            : f
        );
      });

      // Return context for rollback
      return { previousFabrics };
    },
    onError: (error, variables, context) => {
      console.error('Error updating fabric:', error);
      // Rollback on error
      if (context?.previousFabrics) {
        queryClient.setQueryData(fabricKeys.adminLists(), context.previousFabrics);
      }
    },
    onSuccess: (updated, { _id }) => {
      const mergeWithCount = (old?: Fabric | null): Fabric => ({
        ...(old ?? {}),
        ...updated,
        productCount:
          typeof updated.productCount === 'number'
            ? updated.productCount
            : Number(old?.productCount ?? 0),
      });

      queryClient.setQueryData(fabricKeys.adminDetail(_id), (old: Fabric | undefined) =>
        mergeWithCount(old)
      );
      queryClient.setQueryData(fabricKeys.detail(_id), (old: Fabric | undefined) =>
        mergeWithCount(old)
      );
      queryClient.setQueryData<Fabric[]>(fabricKeys.adminLists(), (old = []) =>
        old.map((f) => (f._id === _id ? mergeWithCount(f) : f))
      );
      queryClient.setQueryData<Fabric[]>(fabricKeys.lists(), (old = []) =>
        old.map((f) => (f._id === _id ? mergeWithCount(f) : f))
      );
      syncLocalCartWithFabric(_id, updated);
      invalidateFabricCatalogQueries(queryClient);
      void queryClient.invalidateQueries({
        queryKey: fabricKeys.detail(_id),
        ...catalogRefetchAll,
      });
      void queryClient.invalidateQueries({
        queryKey: fabricKeys.adminDetail(_id),
        ...catalogRefetchAll,
      });
      broadcastCatalogChange({
        kind: 'fabric',
        action: 'update',
        id: _id,
      });
    },
  });
}

/**
 * Hook to delete a fabric (admin)
 */
export function useDeleteFabricMutation() {
  const queryClient = useQueryClient();

  return useMutation<{ deleted: boolean }, Error, string, { previousFabrics: Fabric[] | undefined }>({
    mutationFn: async (_id) => {
      return await deleteFabric(_id);
    },
    onMutate: async (_id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: fabricKeys.adminLists() });

      // Snapshot previous value for rollback
      const previousFabrics = queryClient.getQueryData<Fabric[]>(fabricKeys.adminLists());

      // Optimistically remove the fabric
      queryClient.setQueryData<Fabric[]>(fabricKeys.adminLists(), (old = []) => {
        return old.filter(f => f._id !== _id);
      });

      // Return context for rollback
      return { previousFabrics };
    },
    onError: (error, _id, context) => {
      console.error('Error deleting fabric:', error);
      // Rollback on error
      if (context?.previousFabrics) {
        queryClient.setQueryData(fabricKeys.adminLists(), context.previousFabrics);
      }
    },
    onSuccess: (_data, _id) => {
      queryClient.removeQueries({ queryKey: fabricKeys.detail(_id) });
      queryClient.removeQueries({ queryKey: fabricKeys.adminDetail(_id) });
      queryClient.setQueryData<Fabric[]>(fabricKeys.lists(), (old = []) =>
        old.filter((f) => f._id !== _id)
      );
      syncLocalCartWithFabric(_id, null);
      invalidateFabricCatalogQueries(queryClient);
      broadcastCatalogChange({
        kind: 'fabric',
        action: 'delete',
        id: _id,
      });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}

