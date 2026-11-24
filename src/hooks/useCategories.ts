// src/hooks/useCategories.ts
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { 
  getCategories,
  getAdminCategories,
  getCategoryById,
  getAdminCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  type ProductCategory,
  type CreateCategoryInput,
  type UpdateCategoryInput
} from '@/services/product-category';
import {
  broadcastCatalogChange,
  invalidateCatalogQueries,
} from '@/lib/catalogSync';
import { invalidateBillingUsageQueries } from '@/hooks/useBilling';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { adminListSnapshotSeed } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';

/** Query Keys */
export const categoryKeys = {
  all: ['categories'] as const,
  lists: () => [...categoryKeys.all, 'list'] as const,
  adminLists: () => [...categoryKeys.all, 'admin-list'] as const,
  detail: (id: string) => [...categoryKeys.all, id] as const,
  adminDetail: (id: string) => [...categoryKeys.all, 'admin-detail', id] as const,
};

const catalogRefetchAll = { refetchType: 'all' as const };

/** Shop caches must not keep the staff public URL or embed snippet. */
function withoutStaffPublicPage(category: ProductCategory): ProductCategory {
  const { publicPage: _publicPage, ...rest } = category;
  return rest;
}

function invalidateCategoryCatalogQueries(queryClient: QueryClient) {
  invalidateCatalogQueries(queryClient, 'category');
}

/**
 * Hook to fetch product categories (storefront org).
 */
export function useCategoriesQuery() {
  return useQuery<ProductCategory[], Error>({
    queryKey: categoryKeys.lists(),
    queryFn: async () => {
      const categories = await getCategories();
      // Real empty catalog — do not inject demo categories that hide live products.
      return Array.isArray(categories) ? categories : [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

/** Admin categories for actor.orgId (Step 5.3). */
export function useAdminCategoriesQuery(enabled: boolean = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const seed = adminListSnapshotSeed<ProductCategory[]>(categoryKeys.adminLists());

  return useQuery<ProductCategory[], Error>({
    queryKey: categoryKeys.adminLists(),
    queryFn: async () => {
      const categories = await getAdminCategories();
      return categories ?? [];
    },
    enabled: enabled && Boolean(orgId),
    ...adminListQueryDefaults,
    initialData: seed.initialData,
    initialDataUpdatedAt: seed.initialDataUpdatedAt,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

/**
 * Hook to fetch a single category by ObjectId
 */
export function useCategoryByIdQuery(id: string | undefined) {
  return useQuery<ProductCategory | null, Error>({
    queryKey: categoryKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      return await getCategoryById(id);
    },
    enabled: Boolean(id),
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

function findCachedAdminCategory(
  queryClient: QueryClient,
  id: string
): ProductCategory | undefined {
  if (!id) return undefined;
  const detail = queryClient.getQueryData<ProductCategory>(
    categoryKeys.adminDetail(id)
  );
  if (detail) return detail;
  const lists = queryClient.getQueriesData<ProductCategory[]>({
    queryKey: categoryKeys.adminLists(),
  });
  for (const [, data] of lists) {
    if (!Array.isArray(data)) continue;
    const found = data.find((row) => row._id === id || row.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Admin category detail — seeds from list cache for instant View. */
export function useAdminCategoryByIdQuery(id: string | undefined) {
  const queryClient = useQueryClient();
  const cached = id ? findCachedAdminCategory(queryClient, id) : undefined;

  return useQuery<ProductCategory | null, Error>({
    queryKey: categoryKeys.adminDetail(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      return await getAdminCategoryById(id);
    },
    enabled: Boolean(id),
    initialData: cached,
    initialDataUpdatedAt: cached ? Date.now() : undefined,
    staleTime: 60_000,
    refetchOnMount: true,
    retry: 1,
  });
}

export function prefetchAdminCategoryDetail(queryClient: QueryClient, id: string) {
  if (!id) return;
  const cached = findCachedAdminCategory(queryClient, id);
  if (cached) queryClient.setQueryData(categoryKeys.adminDetail(id), cached);
  void queryClient.prefetchQuery({
    queryKey: categoryKeys.adminDetail(id),
    queryFn: () => getAdminCategoryById(id),
    staleTime: 60_000,
  });
}

/**
 * Hook to create a new category (admin)
 */
export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation<ProductCategory, Error, CreateCategoryInput>({
    mutationFn: async (payload) => {
      return await createCategory(payload);
    },
    onSuccess: (newCategory) => {
      const withCount: ProductCategory = {
        ...newCategory,
        productCount: Number(newCategory.productCount ?? 0),
        shopProductCount: Number(newCategory.shopProductCount ?? 0),
        bookingProductCount: Number(newCategory.bookingProductCount ?? 0),
      };
      invalidateCategoryCatalogQueries(queryClient);
      queryClient.setQueryData(categoryKeys.adminDetail(withCount._id), withCount);
      queryClient.setQueryData(
        categoryKeys.detail(withCount._id),
        withoutStaffPublicPage(withCount)
      );

      queryClient.setQueryData<ProductCategory[]>(categoryKeys.adminLists(), (old = []) => {
        const exists = old.some((cat) => cat._id === withCount._id);
        if (exists) return old;
        return [withCount, ...old];
      });
      queryClient.setQueryData<ProductCategory[]>(categoryKeys.lists(), (old = []) => {
        const storefront = withoutStaffPublicPage(withCount);
        const exists = old.some((cat) => cat._id === storefront._id);
        if (exists) return old;
        return [storefront, ...old];
      });
      broadcastCatalogChange({
        kind: 'category',
        action: 'create',
        id: withCount._id,
      });
      invalidateBillingUsageQueries(queryClient);
    },
    onError: (error) => {
      console.warn('Error creating category:', error instanceof Error ? error.message : error);
    },
  });
}

/**
 * Hook to update a category (admin)
 */
export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    ProductCategory,
    Error,
    { _id: string; payload: UpdateCategoryInput },
    { previousCategories: ProductCategory[] | undefined }
  >({
    mutationFn: async ({ _id, payload }) => {
      return await updateCategory(_id, payload);
    },
    onMutate: async ({ _id, payload }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: categoryKeys.adminLists() });

      // Snapshot previous value for rollback
      const previousCategories = queryClient.getQueryData<ProductCategory[]>(categoryKeys.adminLists());

      // Optimistically update the cache
      queryClient.setQueryData<ProductCategory[]>(categoryKeys.adminLists(), (old = []) => {
        return old.map(cat => 
          cat._id === _id 
            ? { ...cat, ...payload }
            : cat
        );
      });

      // Return context for rollback
      return { previousCategories };
    },
    onError: (error, variables, context) => {
      console.warn('Error updating category:', error instanceof Error ? error.message : error);
      // Rollback on error
      if (context?.previousCategories) {
        queryClient.setQueryData(categoryKeys.adminLists(), context.previousCategories);
      }
    },
    onSuccess: (updated, { _id }) => {
      const mergeWithCount = (old?: ProductCategory | null): ProductCategory => ({
        ...(old ?? {}),
        ...updated,
        productCount:
          typeof updated.productCount === 'number'
            ? updated.productCount
            : Number(old?.productCount ?? 0),
        shopProductCount:
          typeof updated.shopProductCount === 'number'
            ? updated.shopProductCount
            : Number(old?.shopProductCount ?? 0),
        bookingProductCount:
          typeof updated.bookingProductCount === 'number'
            ? updated.bookingProductCount
            : Number(old?.bookingProductCount ?? 0),
      });

      queryClient.setQueryData(categoryKeys.adminDetail(_id), (old: ProductCategory | undefined) =>
        mergeWithCount(old)
      );
      queryClient.setQueryData(categoryKeys.detail(_id), (old: ProductCategory | undefined) =>
        withoutStaffPublicPage(mergeWithCount(old))
      );
      queryClient.setQueryData<ProductCategory[]>(categoryKeys.adminLists(), (old = []) =>
        old.map((cat) => (cat._id === _id ? mergeWithCount(cat) : cat))
      );
      queryClient.setQueryData<ProductCategory[]>(categoryKeys.lists(), (old = []) =>
        old.map((cat) =>
          cat._id === _id ? withoutStaffPublicPage(mergeWithCount(cat)) : cat
        )
      );
      invalidateCategoryCatalogQueries(queryClient);
      void queryClient.invalidateQueries({
        queryKey: categoryKeys.detail(_id),
        ...catalogRefetchAll,
      });
      void queryClient.invalidateQueries({
        queryKey: categoryKeys.adminDetail(_id),
        ...catalogRefetchAll,
      });
      broadcastCatalogChange({
        kind: 'category',
        action: 'update',
        id: _id,
      });
    },
  });
}

/**
 * Hook to delete a category (admin)
 */
export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation<{ deleted: boolean }, Error, string, { previousCategories: ProductCategory[] | undefined }>({
    mutationFn: async (_id) => {
      return await deleteCategory(_id);
    },
    onMutate: async (_id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: categoryKeys.adminLists() });

      // Snapshot previous value for rollback
      const previousCategories = queryClient.getQueryData<ProductCategory[]>(categoryKeys.adminLists());

      // Optimistically remove the category
      queryClient.setQueryData<ProductCategory[]>(categoryKeys.adminLists(), (old = []) => {
        return old.filter(cat => cat._id !== _id);
      });

      // Return context for rollback
      return { previousCategories };
    },
    onError: (error, _id, context) => {
      console.warn('Error deleting category:', error instanceof Error ? error.message : error);
      // Rollback on error
      if (context?.previousCategories) {
        queryClient.setQueryData(categoryKeys.adminLists(), context.previousCategories);
      }
    },
    onSuccess: (_data, _id) => {
      queryClient.removeQueries({ queryKey: categoryKeys.detail(_id) });
      queryClient.removeQueries({ queryKey: categoryKeys.adminDetail(_id) });
      queryClient.setQueryData<ProductCategory[]>(categoryKeys.lists(), (old = []) =>
        old.filter((cat) => cat._id !== _id)
      );
      invalidateCategoryCatalogQueries(queryClient);
      broadcastCatalogChange({
        kind: 'category',
        action: 'delete',
        id: _id,
      });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}
