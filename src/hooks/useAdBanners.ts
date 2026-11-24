'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPublicAdBanners,
  getAdminAdBanners,
  createAdminAdBanner,
  updateAdminAdBanner,
  deleteAdminAdBanner,
} from '@/services/adBanners';
import { sortAdBanners, type AdBannerDto, type AdBannerInput } from '@/lib/adBanners.shared';
import { broadcastCatalogChange } from '@/lib/catalogSync';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const adBannerKeys = {
  all: ['ad-banners'] as const,
  public: ['ad-banners', 'public'] as const,
  admin: ['ad-banners', 'admin'] as const,
};

function syncAdBannerCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  bannersAdmin: AdBannerDto[] | undefined
) {
  if (bannersAdmin) {
    queryClient.setQueryData(adBannerKeys.admin, bannersAdmin);
    const publicList = sortAdBanners(
      bannersAdmin.filter((b) => b.active && b.image)
    );
    const existingPublic = queryClient.getQueryData<AdBannerDto[]>(
      adBannerKeys.public
    );
    if (existingPublic) {
      queryClient.setQueryData(adBannerKeys.public, publicList);
    }
  }

  void queryClient.invalidateQueries({
    queryKey: adBannerKeys.public,
    refetchType: 'all',
  });
  void queryClient.invalidateQueries({
    queryKey: adBannerKeys.admin,
    refetchType: 'active',
  });
}

function notifyBannerChange(action: 'create' | 'update' | 'delete', id?: string) {
  broadcastCatalogChange({ kind: 'banner', action, id });
}

/** Storefront — active banners only. */
export function usePublicAdBannersQuery() {
  return useQuery({
    queryKey: adBannerKeys.public,
    queryFn: getPublicAdBanners,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useAdminAdBannersQuery(enabled = true) {
  return useQuery({
    queryKey: adBannerKeys.admin,
    queryFn: getAdminAdBanners,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(adBannerKeys.admin),
    placeholderData: (previous) => previous,
  });
}

export function useCreateAdBannerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdBannerInput) => createAdminAdBanner(payload),
    onSuccess: (banner) => {
      const prev =
        queryClient.getQueryData<AdBannerDto[]>(adBannerKeys.admin) ?? [];
      syncAdBannerCaches(queryClient, sortAdBanners([...prev, banner]));
      notifyBannerChange('create', banner._id);
    },
  });
}

export function useUpdateAdBannerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdBannerInput }) =>
      updateAdminAdBanner(id, payload),
    onSuccess: (banner) => {
      const prev =
        queryClient.getQueryData<AdBannerDto[]>(adBannerKeys.admin) ?? [];
      const next = sortAdBanners(
        prev.map((row) => (row._id === banner._id ? banner : row))
      );
      if (!prev.some((row) => row._id === banner._id)) {
        next.push(banner);
      }
      syncAdBannerCaches(queryClient, sortAdBanners(next));
      notifyBannerChange('update', banner._id);
    },
  });
}

export function useDeleteAdBannerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAdminAdBanner(id),
    onSuccess: (_void, id) => {
      const prev =
        queryClient.getQueryData<AdBannerDto[]>(adBannerKeys.admin) ?? [];
      syncAdBannerCaches(
        queryClient,
        prev.filter((row) => row._id !== id)
      );
      notifyBannerChange('delete', id);
    },
  });
}
