import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { 
  getAllCustomizations, 
  getCustomization, 
  getUserCustomizationsById, 
  getCurrentUserCustomizations,
  createCustomization,
  updateCustomization,
  deleteCustomization,
  type CustomizationResponse,
  type CustomizationInput
} from '@/services/customization';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { adminListSnapshotSeed } from '@/lib/adminListSnapshot';

/** Query Keys */
export const customizationKeys = {
  all: ['customizations'] as const,
  admin: () => [...customizationKeys.all, 'admin'] as const,
  byId: (id: string) => [...customizationKeys.all, id] as const,
  currentUser: () => [...customizationKeys.all, 'current-user'] as const,
};

function findCachedCustomization(
  queryClient: QueryClient,
  id: string
): CustomizationResponse | undefined {
  if (!id) return undefined;
  const detail = queryClient.getQueryData<CustomizationResponse>(
    customizationKeys.byId(id)
  );
  if (detail) return detail;

  const lists = queryClient.getQueriesData<CustomizationResponse[]>({
    queryKey: customizationKeys.admin(),
  });
  for (const [, data] of lists) {
    if (!Array.isArray(data)) continue;
    const found = data.find((item) => item._id === id || item.id === id);
    if (found) return found;
  }

  const mine = queryClient.getQueryData<CustomizationResponse[]>(
    customizationKeys.currentUser()
  );
  return mine?.find((item) => item._id === id || item.id === id);
}

/**
 * Hook to fetch all customizations (admin)
 * Used for admin dashboard and customizations management
 */
export function useAdminCustomizationsQuery(enabled: boolean = true) {
  const can = useAuthStore((state) => state.can);
  const orgId = useAuthStore((state) => state.user?.orgId ?? null);
  const seed = adminListSnapshotSeed<CustomizationResponse[]>(
    customizationKeys.admin()
  );

  return useQuery<CustomizationResponse[], Error>({
    queryKey: customizationKeys.admin(),
    queryFn: async () => {
      const customizations = await getAllCustomizations();
      return customizations ?? [];
    },
    enabled: enabled && Boolean(orgId) && can(P.CustomizationsRead),
    ...adminListQueryDefaults,
    initialData: seed.initialData,
    initialDataUpdatedAt: seed.initialDataUpdatedAt,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

/**
 * Hook to fetch a single customization by ID (profile owner or admin staff).
 * Requires a session — API is owner OR customizations:read.
 * Seeds from list cache so View opens immediately.
 */
export function useCustomizationByIdQuery(id: string | null, enabled: boolean = true) {
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();
  const cached = id ? findCachedCustomization(queryClient, id) : undefined;

  return useQuery<CustomizationResponse, Error>({
    queryKey: customizationKeys.byId(id ?? ''),
    queryFn: async () => {
      if (!id) throw new Error('Customization ID is required');
      const customization = await getCustomization(id);
      return customization;
    },
    enabled: enabled && !!id && isAuthenticated,
    initialData: cached,
    initialDataUpdatedAt: cached ? Date.now() : undefined,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function prefetchAdminCustomizationDetail(
  queryClient: QueryClient,
  id: string
) {
  if (!id) return;
  const cached = findCachedCustomization(queryClient, id);
  if (cached) {
    queryClient.setQueryData(customizationKeys.byId(id), cached);
  }
  void queryClient.prefetchQuery({
    queryKey: customizationKeys.byId(id),
    queryFn: () => getCustomization(id),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch all customizations for a specific user (admin)
 * Used for customer history and insights
 */
export function useUserCustomizationsQuery(userId: string | null, enabled: boolean = true) {
  const isStaff = useAuthStore((state) => state.isStaff);

  return useQuery<CustomizationResponse[], Error>({
    queryKey: [...customizationKeys.all, 'user', userId],
    queryFn: async () => {
      if (!userId) throw new Error('User ID is required');
      const customizations = await getUserCustomizationsById(userId);
      return customizations ?? [];
    },
    enabled: enabled && !!userId && isStaff(),
    staleTime: 5 * 60 * 1000, // 5 minutes (customer data changes less frequently)
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Hook to fetch current user's customizations (user profile)
 * Used for user profile customizations section
 */
export function useCurrentUserCustomizationsQuery(enabled: boolean = true) {
  const { isAuthenticated } = useAuthStore();

  return useQuery<CustomizationResponse[], Error>({
    queryKey: customizationKeys.currentUser(),
    queryFn: async () => {
      const customizations = await getCurrentUserCustomizations();
      return customizations ?? [];
    },
    enabled: enabled && isAuthenticated,
    staleTime: 2 * 60 * 1000, // 2 minutes (user's own data)
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Hook to create a new customization (user-facing)
 * Used for creating customization requests
 */
export function useCreateCustomizationMutation() {
  const queryClient = useQueryClient();

  return useMutation<CustomizationResponse, Error, CustomizationInput>({
    mutationFn: async (data) => {
      return await createCustomization(data);
    },
    onSuccess: (newCustomization) => {
      // Invalidate and refetch current user customizations
      queryClient.invalidateQueries({ queryKey: customizationKeys.currentUser() });
      queryClient.invalidateQueries({ queryKey: customizationKeys.admin() });
      
      // Optimistically add to cache
      queryClient.setQueryData<CustomizationResponse[]>(customizationKeys.currentUser(), (old = []) => {
        // Add new customization to the beginning of the list
        return [newCustomization, ...old];
      });
    },
    onError: (error) => {
      console.error('Error creating customization:', error);
    },
  });
}

/**
 * Hook to update a customization (user profile)
 * Used for editing customization requests
 */
export function useUpdateCustomizationMutation() {
  const queryClient = useQueryClient();

  return useMutation<CustomizationResponse, Error, { id: string; data: Partial<CustomizationInput> }>({
    mutationFn: async ({ id, data }) => {
      return await updateCustomization(id, data);
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: customizationKeys.currentUser() });
      await queryClient.cancelQueries({ queryKey: customizationKeys.byId(id) });

      // Snapshot previous values for rollback
      const previousCustomizations = queryClient.getQueryData<CustomizationResponse[]>(customizationKeys.currentUser());
      const previousCustomization = queryClient.getQueryData<CustomizationResponse>(customizationKeys.byId(id));

      // Optimistically update the cache
      queryClient.setQueryData<CustomizationResponse[]>(customizationKeys.currentUser(), (old = []) => {
        return old.map(c => 
          (c._id === id || c.id === id) 
            ? { ...c, ...data }
            : c
        );
      });

      queryClient.setQueryData<CustomizationResponse>(customizationKeys.byId(id), (old) => {
        return old ? { ...old, ...data } : old;
      });

      // Return context for rollback
      return { previousCustomizations, previousCustomization };
    },
    onError: (error, variables, context) => {
      console.error('Error updating customization:', error);
      // Rollback on error
      if (context?.previousCustomizations) {
        queryClient.setQueryData(customizationKeys.currentUser(), context.previousCustomizations);
      }
      if (context?.previousCustomization) {
        queryClient.setQueryData(customizationKeys.byId(variables.id), context.previousCustomization);
      }
    },
    onSuccess: (updatedCustomization, { id }) => {
      // Update cache with server response
      queryClient.setQueryData<CustomizationResponse[]>(customizationKeys.currentUser(), (old = []) => {
        return old.map(c => 
          (c._id === id || c.id === id) 
            ? updatedCustomization
            : c
        );
      });

      queryClient.setQueryData(customizationKeys.byId(id), updatedCustomization);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: customizationKeys.currentUser() });
      queryClient.invalidateQueries({ queryKey: customizationKeys.byId(id) });
      queryClient.invalidateQueries({ queryKey: customizationKeys.admin() });
    },
  });
}

/**
 * Hook to delete a customization (admin or owner)
 * Invalidates admin list, detail, and current-user caches.
 */
export function useDeleteCustomizationMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await deleteCustomization(id);
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: customizationKeys.byId(id) });
      queryClient.setQueryData<CustomizationResponse[]>(customizationKeys.admin(), (old = []) =>
        old.filter((c) => c._id !== id && c.id !== id)
      );
      queryClient.setQueryData<CustomizationResponse[]>(customizationKeys.currentUser(), (old = []) =>
        old.filter((c) => c._id !== id && c.id !== id)
      );
      queryClient.invalidateQueries({ queryKey: customizationKeys.all });
    },
    onError: (error) => {
      console.error('Error deleting customization:', error);
    },
  });
}

