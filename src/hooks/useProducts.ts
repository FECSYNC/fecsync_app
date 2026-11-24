// Custom hooks for fetching products using React Query
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  getProducts,
  getProductById,
  adminGetProducts,
  adminAddProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminGetProductById,
  type Product,
  type PaginatedResponse,
  type AdminProductInput
} from '@/services/products';
import { slimCatalogImages } from '@/lib/catalogImages';
import { optimizeProductGalleryImages } from '@/lib/productImages';
import {
  broadcastCatalogChange,
  invalidateCatalogQueries,
} from '@/lib/catalogSync';
import { categoryKeys } from '@/hooks/useCategories';
import { fabricKeys } from '@/hooks/useFabrics';
import { invalidateBillingUsageQueries } from '@/hooks/useBilling';
import type { ProductCategory } from '@/services/product-category';
import type { Fabric } from '@/services/fabric';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { adminListSnapshotSeed } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';

/**
 * Query keys for admin products
 */
export function normalizeAdminProductListParams(params?: {
  page?: number;
  limit?: number;
  sort?: string;
  gender?: string;
  category?: string;
  fabric?: string;
}) {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 10;
  const sort = params?.sort ?? 'newest';
  const gender = params?.gender ?? '';
  const category = params?.category?.trim() || undefined;
  const fabric = params?.fabric?.trim() || undefined;
  // Omit empty optional filters so prefetch keys match the list page.
  return {
    page,
    limit,
    sort,
    gender,
    ...(category ? { category } : {}),
    ...(fabric ? { fabric } : {}),
  };
}

export const adminProductKeys = {
  all: ['admin-products'] as const,
  lists: () => [...adminProductKeys.all, 'list'] as const,
  list: (params?: {
    page?: number;
    limit?: number;
    sort?: string;
    gender?: string;
    category?: string;
    fabric?: string;
  }) =>
    [...adminProductKeys.lists(), normalizeAdminProductListParams(params)] as const,
  details: () => [...adminProductKeys.all, 'detail'] as const,
  detail: (id: string) => [...adminProductKeys.details(), id] as const,
};

/** Public storefront product caches (shop, homepage, PDP, recommendations). */
export const storefrontProductKeys = {
  homepage: ['homepage-products'] as const,
  shop: ['shop-products'] as const,
  detail: (id: string) => ['product', id] as const,
  details: ['product'] as const,
  lists: ['products'] as const,
};

/**
 * Hook to fetch homepage products (20 products for trending + new arrivals)
 * Cached for 5 minutes, shared across homepage components
 */
export function useHomepageProducts(options?: { enabled?: boolean }) {
  return useQuery<Product[], Error>({
    queryKey: storefrontProductKeys.homepage,
    queryFn: async () => {
      const response = await getProducts({
        page: 1,
        limit: 20,
        sort: 'newest',
        totals: 0,
      });
      const data = 'items' in response ? response.items : response;
      const rows = Array.isArray(data) ? data : [];
      // Match /shop normalization — empty images still render with a placeholder.
      return rows.map((product) => {
        const images = Array.isArray(product.images)
          ? product.images.filter(Boolean)
          : [];
        if (images.length === 0) {
          return { ...product, images: ['/placeholder.png'] };
        }
        return product;
      });
    },
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // One quick retry — long DB waits + default retries keep the homepage on skeletons.
    retry: 1,
    retryDelay: 800,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
}

/**
 * Hook to fetch shop page products with pagination and filters
 */
export function useShopProducts(params?: {
  page?: number;
  limit?: number;
  gender?: string;
  category?: string;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
}) {
  const queryKey = [...storefrontProductKeys.shop, params] as const;

  return useQuery<PaginatedResponse<Product>, Error>({
    queryKey,
    queryFn: async () => {
      const response = await getProducts(params);

      // Ensure we always return a PaginatedResponse format
      if (Array.isArray(response)) {
        // Legacy format - convert to paginated response
        return {
          items: response,
          pagination: {
            page: params?.page || 1,
            limit: params?.limit || 20,
            total: response.length,
            totalPages: 1,
            hasMore: false,
          }
        } as PaginatedResponse<Product>;
      }

      // Already in PaginatedResponse format
      return response as PaginatedResponse<Product>;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
}

const catalogRefetchActive = { refetchType: 'active' as const };

function productMatchesId(product: Product, id: string) {
  return product._id === id || product.id === id;
}

function productIdOf(product: Product): string {
  return product._id || product.id || '';
}

/** Storefront grids only need one thumb — avoid injecting full admin galleries. */
function toStorefrontListProduct(product: Product): Product {
  return {
    ...product,
    images: slimCatalogImages(product.images, 720),
  };
}

function mapProductCollection(
  items: Product[],
  id: string,
  next: Product | null
): Product[] {
  if (next === null) {
    return items.filter((product) => !productMatchesId(product, id));
  }
  return items.map((product) =>
    productMatchesId(product, id) ? { ...product, ...next } : product
  );
}

/** Patch array or paginated `{ items }` product caches (admin + shop). */
function patchProductListData(
  old: PaginatedResponse<Product> | Product[] | undefined,
  id: string,
  next: Product | null
): PaginatedResponse<Product> | Product[] | undefined {
  if (!old) return old;
  if (Array.isArray(old)) {
    return mapProductCollection(old, id, next);
  }
  if (old && typeof old === 'object' && Array.isArray(old.items)) {
    const items = mapProductCollection(old.items, id, next);
    const removed = next === null ? old.items.length - items.length : 0;
    return {
      ...old,
      items,
      pagination: old.pagination
        ? {
            ...old.pagination,
            total: Math.max(0, (old.pagination.total ?? items.length) - removed),
          }
        : old.pagination,
    };
  }
  return old;
}

/**
 * Immediately update every known product list/detail cache so admin tables,
 * shop grids, homepage, and recommendations stay in sync before refetch lands.
 */
function applyProductCachePatch(
  queryClient: QueryClient,
  id: string,
  next: Product | null
) {
  if (next) {
    const previous =
      queryClient.getQueryData<Product>(adminProductKeys.detail(id)) ??
      findCachedAdminProduct(queryClient, id);
    next = mergeProductCatalogRefs(previous, next);
    // If still bare ids (e.g. older clients), hydrate from category/fabric lists
    const catId = catalogRefId(next.category);
    if (catId && typeof next.category === 'string') {
      next = {
        ...next,
        category: resolveCategoryRef(queryClient, catId, previous?.category),
      };
    }
    const fabId = catalogRefId(next.fabricType);
    if (fabId && typeof next.fabricType === 'string') {
      next = {
        ...next,
        fabricType: resolveFabricRef(queryClient, fabId, previous?.fabricType),
      };
    }

    const detailNext = {
      ...next,
      images: optimizeProductGalleryImages(next.images, 960),
    };
    queryClient.setQueryData(adminProductKeys.detail(id), next);
    queryClient.setQueryData(storefrontProductKeys.detail(id), detailNext);
  } else {
    queryClient.removeQueries({ queryKey: adminProductKeys.detail(id) });
    queryClient.removeQueries({ queryKey: storefrontProductKeys.detail(id) });
  }

  const storefrontNext = next ? toStorefrontListProduct(next) : null;

  for (const query of queryClient.getQueryCache().findAll({
    queryKey: adminProductKeys.lists(),
  })) {
    const params = paramsFromQueryKey(query.queryKey, 2);
    const listNext =
      next && !productFitsListParams(next, params) ? null : next;
    queryClient.setQueryData(
      query.queryKey,
      patchProductListData(
        query.state.data as PaginatedResponse<Product> | Product[] | undefined,
        id,
        listNext
      )
    );
  }

  queryClient.setQueriesData(
    { queryKey: storefrontProductKeys.homepage },
    (old: Product[] | undefined) =>
      (patchProductListData(old, id, storefrontNext) as Product[] | undefined)
  );

  for (const query of queryClient.getQueryCache().findAll({
    queryKey: storefrontProductKeys.shop,
  })) {
    const params = paramsFromQueryKey(query.queryKey, 1);
    const listNext =
      storefrontNext && !productFitsListParams(next as Product, params)
        ? null
        : storefrontNext;
    queryClient.setQueryData(
      query.queryKey,
      patchProductListData(
        query.state.data as PaginatedResponse<Product> | Product[] | undefined,
        id,
        listNext
      )
    );
  }
  // Recommendation / misc list caches: update-in-place or remove, never invent rows
  queryClient.setQueriesData(
    { queryKey: storefrontProductKeys.lists },
    (old: Product[] | undefined) => {
      if (!Array.isArray(old)) return old;
      if (next === null) {
        return old.filter((product) => !productMatchesId(product, id));
      }
      const storefrontNext = toStorefrontListProduct(next);
      let found = false;
      const mapped = old.map((product) => {
        if (!productMatchesId(product, id)) return product;
        found = true;
        return { ...product, ...storefrontNext };
      });
      return found ? mapped : old;
    }
  );

  // Wishlist embeds product docs — patch display fields only (keep wishlist shape)
  queryClient.setQueriesData(
    { queryKey: ['wishlist'] },
    (old: unknown) => {
      if (!Array.isArray(old)) return old;
      if (next === null) {
        return old.filter((item) => {
          const row = item as { _id?: string; id?: string };
          return row._id !== id && row.id !== id;
        });
      }
      return old.map((item) => {
        const row = item as { _id?: string; id?: string };
        if (row._id !== id && row.id !== id) return item;
        return {
          ...(item as object),
          name: next.name,
          price: next.price,
          images: storefrontNext?.images,
          description: next.description,
        };
      });
    }
  );
}

/** Overlay scalar catalog fields; hydrate category/fabric from staff lists when IDs change. */
function overlayProductPatch(
  current: Product,
  payload: Partial<AdminProductInput>,
  queryClient?: QueryClient
): Product {
  const next: Product = {
    ...current,
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.description !== undefined
      ? { description: payload.description }
      : {}),
    ...(payload.price !== undefined ? { price: payload.price } : {}),
    ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
    ...(payload.remainingInStock !== undefined
      ? { remainingInStock: payload.remainingInStock }
      : {}),
    ...(payload.location !== undefined ? { location: payload.location } : {}),
    ...(payload.images !== undefined ? { images: payload.images } : {}),
    ...(payload.sizes !== undefined ? { sizes: payload.sizes } : {}),
    ...(payload.gender !== undefined ? { gender: payload.gender } : {}),
    ...(payload.taxRate !== undefined ? { taxRate: payload.taxRate } : {}),
    ...(payload.taxExempt !== undefined ? { taxExempt: payload.taxExempt } : {}),
  };

  if (payload.category !== undefined && queryClient) {
    next.category = resolveCategoryRef(queryClient, payload.category, current.category);
  }
  if (payload.fabricType !== undefined && queryClient) {
    next.fabricType = resolveFabricRef(
      queryClient,
      payload.fabricType,
      current.fabricType
    );
  }

  return next;
}

function resolveCategoryRef(
  queryClient: QueryClient,
  categoryId: string,
  previous?: Product['category']
): Product['category'] {
  if (
    previous &&
    catalogRefId(previous) === categoryId &&
    typeof previous === 'object' &&
    previous?.name
  ) {
    return previous;
  }
  const lists = queryClient.getQueriesData<ProductCategory[]>({
    queryKey: categoryKeys.adminLists(),
  });
  for (const [, rows] of lists) {
    const match = rows?.find((c) => c._id === categoryId);
    if (match) {
      return {
        _id: match._id,
        id: match.id,
        name: match.name,
        description: match.description ?? '',
      };
    }
  }
  return categoryId;
}

function resolveFabricRef(
  queryClient: QueryClient,
  fabricId: string,
  previous?: Product['fabricType']
): Product['fabricType'] {
  if (
    previous &&
    catalogRefId(previous) === fabricId &&
    typeof previous === 'object' &&
    previous?.name
  ) {
    return previous;
  }
  const lists = queryClient.getQueriesData<Fabric[]>({
    queryKey: fabricKeys.adminLists(),
  });
  for (const [, rows] of lists) {
    const match = rows?.find((f) => f._id === fabricId);
    if (match) {
      return {
        ...match,
        _id: match._id,
        name: match.name,
      } as Product['fabricType'];
    }
  }
  return fabricId;
}

/** Prefer populated refs from API; if API returned bare ids, keep prior populated objects when ids match. */
function mergeProductCatalogRefs(
  previous: Product | undefined,
  incoming: Product
): Product {
  const categoryId = catalogRefId(incoming.category);
  const fabricId = catalogRefId(incoming.fabricType);

  let category = incoming.category;
  if (
    categoryId &&
    (typeof category === 'string' ||
      (typeof category === 'object' && category && !('name' in category && category.name)))
  ) {
    if (
      previous &&
      catalogRefId(previous.category) === categoryId &&
      typeof previous.category === 'object' &&
      previous.category?.name
    ) {
      category = previous.category;
    }
  }

  let fabricType = incoming.fabricType;
  if (
    fabricId &&
    (typeof fabricType === 'string' ||
      (typeof fabricType === 'object' &&
        fabricType &&
        !('name' in fabricType && fabricType.name)))
  ) {
    if (
      previous &&
      catalogRefId(previous.fabricType) === fabricId &&
      typeof previous.fabricType === 'object' &&
      previous.fabricType?.name
    ) {
      fabricType = previous.fabricType;
    }
  }

  return { ...incoming, category, fabricType };
}

function catalogRefId(
  value: Product['category'] | Product['fabricType']
): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value._id;
}

function productFitsListParams(
  product: Product,
  params?: { gender?: string; category?: string; fabric?: string } | null
) {
  if (!params) return true;
  // Match staff GET /api/product exact gender filter (unisex is its own value).
  if (
    params.gender &&
    params.gender !== 'all' &&
    product.gender !== params.gender
  ) {
    return false;
  }
  if (params.category && catalogRefId(product.category) !== params.category) {
    return false;
  }
  if (params.fabric && catalogRefId(product.fabricType) !== params.fabric) {
    return false;
  }
  return true;
}

function paramsFromQueryKey(
  queryKey: readonly unknown[],
  paramsIndex: number
): { gender?: string; category?: string; fabric?: string } | undefined {
  const params = queryKey[paramsIndex];
  if (!params || typeof params !== 'object') return undefined;
  return params as { gender?: string; category?: string; fabric?: string };
}

/** Instant create: detail + prepend matching admin/homepage/shop lists. */
function applyProductCreateToCaches(queryClient: QueryClient, newProduct: Product) {
  let hydrated = newProduct;
  const catId = catalogRefId(newProduct.category);
  if (catId && typeof newProduct.category === 'string') {
    hydrated = {
      ...hydrated,
      category: resolveCategoryRef(queryClient, catId),
    };
  }
  const fabId = catalogRefId(newProduct.fabricType);
  if (fabId && typeof newProduct.fabricType === 'string') {
    hydrated = {
      ...hydrated,
      fabricType: resolveFabricRef(queryClient, fabId),
    };
  }

  const id = productIdOf(hydrated);
  if (!id) return;

  const detailNext = {
    ...hydrated,
    images: optimizeProductGalleryImages(hydrated.images, 960),
  };
  const listProduct = toStorefrontListProduct(hydrated);

  queryClient.setQueryData(adminProductKeys.detail(id), hydrated);
  queryClient.setQueryData(storefrontProductKeys.detail(id), detailNext);

  const prependAdmin = (
    old: PaginatedResponse<Product> | Product[] | undefined
  ) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.some((p) => productMatchesId(p, id)) ? old : [hydrated, ...old];
    }
    if (old && typeof old === 'object' && Array.isArray(old.items)) {
      if (old.items.some((p) => productMatchesId(p, id))) return old;
      return {
        ...old,
        items: [hydrated, ...old.items],
        pagination: old.pagination
          ? { ...old.pagination, total: (old.pagination.total ?? 0) + 1 }
          : old.pagination,
      };
    }
    return old;
  };

  const prependStorefront = (
    old: PaginatedResponse<Product> | Product[] | undefined
  ) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.some((p) => productMatchesId(p, id))
        ? old
        : [listProduct, ...old];
    }
    if (old && typeof old === 'object' && Array.isArray(old.items)) {
      if (old.items.some((p) => productMatchesId(p, id))) return old;
      return {
        ...old,
        items: [listProduct, ...old.items],
        pagination: old.pagination
          ? { ...old.pagination, total: (old.pagination.total ?? 0) + 1 }
          : old.pagination,
      };
    }
    return old;
  };

  for (const query of queryClient.getQueryCache().findAll({
    queryKey: adminProductKeys.lists(),
  })) {
    const params = paramsFromQueryKey(query.queryKey, 2);
    if (!productFitsListParams(hydrated, params)) continue;
    queryClient.setQueryData(
      query.queryKey,
      prependAdmin(
        query.state.data as PaginatedResponse<Product> | Product[] | undefined
      )
    );
  }

  queryClient.setQueriesData(
    { queryKey: storefrontProductKeys.homepage },
    (old: Product[] | undefined) =>
      prependStorefront(old) as Product[] | undefined
  );

  for (const query of queryClient.getQueryCache().findAll({
    queryKey: storefrontProductKeys.shop,
  })) {
    const params = paramsFromQueryKey(query.queryKey, 1);
    if (!productFitsListParams(hydrated, params)) continue;
    queryClient.setQueryData(
      query.queryKey,
      prependStorefront(
        query.state.data as PaginatedResponse<Product> | Product[] | undefined
      )
    );
  }
}

/** Keep Zustand cart lines aligned when catalog price/name/tax changes in this browser. */
function syncLocalCartWithProduct(id: string, next: Product | null) {
  void import('@/store/cartStore')
    .then(({ useCartStore }) => {
      const { items, setItems } = useCartStore.getState();
      if (!items.some((line) => line.id === id)) return;

      if (next === null) {
        setItems(items.filter((line) => line.id !== id));
        return;
      }

      const priceNum =
        typeof next.price === 'number' ? next.price : Number(next.price);
      setItems(
        items.map((line) =>
          line.id === id
            ? {
                ...line,
                name: next.name || line.name,
                image:
                  slimCatalogImages(next.images, 720)[0] ||
                  line.image,
                price: Number.isFinite(priceNum) ? priceNum : line.price,
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

/**
 * After admin create/update/delete, refresh admin + storefront + related
 * surfaces (wishlist, dashboard, cart). Active queries refetch; inactive stay
 * invalidated until next visit.
 */
function invalidateProductCatalogQueries(queryClient: QueryClient) {
  invalidateCatalogQueries(queryClient, 'product');
}

/** Seed admin detail from any cached admin list page (instant View open). */
export function findCachedAdminProduct(
  queryClient: QueryClient,
  productId: string
): Product | undefined {
  if (!productId) return undefined;
  const cachedDetail = queryClient.getQueryData<Product>(
    adminProductKeys.detail(productId)
  );
  if (cachedDetail) return cachedDetail;

  const lists = queryClient.getQueriesData<PaginatedResponse<Product> | Product[]>(
    { queryKey: adminProductKeys.lists() }
  );
  for (const [, data] of lists) {
    if (!data) continue;
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : [];
    const found = items.find((product) => productMatchesId(product, productId));
    if (found) return found;
  }
  return undefined;
}

/**
 * Hook to fetch admin products with server-side pagination
 */
export function useAdminProducts(params?: {
  page?: number;
  limit?: number;
  sort?: string;
  gender?: string;
  category?: string;
  fabric?: string;
}) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const normalized = normalizeAdminProductListParams(params);
  const listKey = adminProductKeys.list(normalized);
  const seed = adminListSnapshotSeed<PaginatedResponse<Product>>(listKey);

  return useQuery<PaginatedResponse<Product>, Error>({
    queryKey: listKey,
    queryFn: async () => {
      const response = await adminGetProducts(normalized);

      // Ensure we always return a PaginatedResponse format
      if (Array.isArray(response)) {
        // Legacy format - convert to paginated response
        return {
          items: response,
          pagination: {
            page: normalized.page,
            limit: normalized.limit,
            total: response.length,
            totalPages: 1,
            hasMore: false,
          }
        } as PaginatedResponse<Product>;
      }

      // Already in PaginatedResponse format
      return response as PaginatedResponse<Product>;
    },
    enabled: Boolean(orgId),
    ...adminListQueryDefaults,
    initialData: seed.initialData,
    initialDataUpdatedAt: seed.initialDataUpdatedAt,
    placeholderData: (previous) => previous,
  });
}

/**
 * Hook to create a new product (admin)
 */
export function useCreateProductMutation() {
  const queryClient = useQueryClient();

  return useMutation<Product, Error, AdminProductInput>({
    mutationFn: async (payload) => {
      return await adminAddProduct(payload);
    },
    onSuccess: (newProduct) => {
      applyProductCreateToCaches(queryClient, newProduct);
      invalidateProductCatalogQueries(queryClient);
      invalidateBillingUsageQueries(queryClient);
      broadcastCatalogChange({
        kind: 'product',
        action: 'create',
        id: productIdOf(newProduct),
      });
    },
    onError: (error) => {
      console.warn('Error creating product:', error instanceof Error ? error.message : error);
    },
  });
}

/**
 * Hook to update a product (admin)
 */
export function useUpdateProductMutation() {
  const queryClient = useQueryClient();

  return useMutation<Product, Error, { id: string; payload: Partial<AdminProductInput> }>({
    mutationFn: async ({ id, payload }) => {
      return await adminUpdateProduct(id, payload);
    },
    onMutate: async ({ id, payload }) => {
      const current =
        queryClient.getQueryData<Product>(adminProductKeys.detail(id)) ??
        findCachedAdminProduct(queryClient, id);
      if (!current) return;
      applyProductCachePatch(
        queryClient,
        id,
        overlayProductPatch(current, payload, queryClient)
      );
    },
    onSuccess: (updatedProduct, variables) => {
      applyProductCachePatch(queryClient, variables.id, updatedProduct);
      syncLocalCartWithProduct(variables.id, updatedProduct);
      invalidateProductCatalogQueries(queryClient);
      broadcastCatalogChange({
        kind: 'product',
        action: 'update',
        id: variables.id,
      });
    },
    onError: (error, variables) => {
      console.warn('Error updating product:', error instanceof Error ? error.message : error);
      invalidateProductCatalogQueries(queryClient);
      void queryClient.invalidateQueries({
        queryKey: adminProductKeys.detail(variables.id),
        ...catalogRefetchActive,
      });
    },
  });
}

/**
 * Hook to delete a product (admin)
 */
export function useDeleteProductMutation() {
  const queryClient = useQueryClient();

  return useMutation<{ deleted: boolean }, Error, string>({
    mutationFn: async (id) => {
      return await adminDeleteProduct(id);
    },
    onSuccess: (_, productId) => {
      applyProductCachePatch(queryClient, productId, null);
      syncLocalCartWithProduct(productId, null);
      invalidateProductCatalogQueries(queryClient);
      invalidateBillingUsageQueries(queryClient);
      broadcastCatalogChange({
        kind: 'product',
        action: 'delete',
        id: productId,
      });
    },
    onError: (error) => {
      console.warn('Error deleting product:', error instanceof Error ? error.message : error);
    },
  });
}

/**
 * Hook to fetch products with full control over query options
 */
export function useProductsQuery(
  params?: Record<string, string | number | boolean | undefined>,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
) {
  return useQuery<Product[], Error>({
    queryKey: [...storefrontProductKeys.lists, params],
    queryFn: async () => {
      const response = await getProducts(params);
      const data = 'items' in response ? response.items : response;
      return Array.isArray(data) ? data : [];
    },
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 30 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch a single product by ID
 * Cached for 5 minutes, useful for product detail pages
 */
export function useProductByIdQuery(productId: string, enabled: boolean = true) {
  return useQuery<Product | null, Error>({
    queryKey: storefrontProductKeys.detail(productId),
    queryFn: async () => {
      return await getProductById(productId);
    },
    enabled: enabled && !!productId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Admin product detail — seeds from list cache so View opens immediately.
 */
export function useAdminProductByIdQuery(
  productId: string,
  enabled: boolean = true
) {
  const queryClient = useQueryClient();
  const cached = findCachedAdminProduct(queryClient, productId);

  return useQuery<Product | null, Error>({
    queryKey: adminProductKeys.detail(productId),
    queryFn: async () => {
      if (!productId) return null;
      return await adminGetProductById(productId);
    },
    enabled: enabled && !!productId,
    initialData: cached,
    initialDataUpdatedAt: cached ? Date.now() : undefined,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Prefetch admin product detail (e.g. on View hover).
 */
export function prefetchAdminProductDetail(
  queryClient: QueryClient,
  productId: string
) {
  if (!productId) return;
  const cached = findCachedAdminProduct(queryClient, productId);
  if (cached) {
    queryClient.setQueryData(adminProductKeys.detail(productId), cached);
  }
  void queryClient.prefetchQuery({
    queryKey: adminProductKeys.detail(productId),
    queryFn: () => adminGetProductById(productId),
    staleTime: 60_000,
  });
}

/**
 * Hook to fetch recommended products based on category
 * Automatically excludes the current product and limits to 8 items
 * Now fetches independently for parallel loading!
 */
export function useRecommendedProductsQuery(
  productId: string,
  enabled: boolean = true
) {
  const queryClient = useQueryClient();

  return useQuery<Product[], Error>({
    queryKey: [...storefrontProductKeys.lists, 'recommendations', productId],
    queryFn: async () => {
      // Reuse product detail cache — avoid a second full product round-trip.
      let product =
        queryClient.getQueryData<Product | null>(
          storefrontProductKeys.detail(productId)
        ) ?? null;
      if (!product) {
        product = await getProductById(productId);
      }
      if (!product) return [];

      const categoryId =
        typeof product.category === 'object' && product.category?._id
          ? product.category._id
          : typeof product.category === 'string'
            ? product.category
            : undefined;

      if (!categoryId) return [];

      const response = await getProducts({
        category: categoryId,
        limit: 9,
        totals: 0,
      });
      const products = 'items' in response ? response.items : response;

      if (!Array.isArray(products)) return [];

      return products.filter((p) => p._id !== productId).slice(0, 8);
    },
    enabled: enabled && !!productId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

