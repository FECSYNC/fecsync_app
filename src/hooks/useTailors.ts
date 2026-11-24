'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminTailors,
  createAdminTailor,
  updateAdminTailor,
  patchAdminTailorStatus,
  getMyTailorProfile,
  updateMyTailorProfile,
  uploadTailorPortfolioImage,
  getPublicTailors,
  getPublicTailorBySlug,
  getPublicTailorReviews,
  submitTailorReview,
  type PublicTailorQuery,
  type PublicTailorReviewsResult,
} from '@/services/tailors';
import { jobKeys } from '@/hooks/useTailoringJobs';
import { notificationKeys } from '@/hooks/useNotifications';
import { invalidateBillingUsageQueries } from '@/hooks/useBilling';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';
import type {
  PublicTailorDto,
  PublicTailorListResult,
  TailorAdminInput,
  TailorProfileDto,
  TailorSelfInput,
  TailorStatus,
} from '@/lib/tailors.shared';

export const tailorKeys = {
  all: (orgId?: string | null) => ['tailors', orgId ?? 'none'] as const,
  admin: (orgId: string | null | undefined, q?: string, status?: string) =>
    [...tailorKeys.all(orgId), 'admin', q ?? '', status ?? ''] as const,
  me: (orgId?: string | null) => [...tailorKeys.all(orgId), 'me'] as const,
  public: (opts: PublicTailorQuery = {}) =>
    [
      'tailors',
      'public',
      opts.q ?? '',
      opts.specialty ?? '',
      opts.location ?? '',
      opts.country ?? '',
      opts.city ?? '',
      opts.page ?? 1,
      opts.limit ?? 12,
    ] as const,
  publicDetail: (slug: string) => ['tailors', 'public', 'detail', slug] as const,
  publicReviews: (slug: string) => ['tailors', 'public', 'reviews', slug] as const,
  featured: ['tailors', 'public', 'featured'] as const,
};

export function usePublicTailorsQuery(
  opts: PublicTailorQuery & { enabled?: boolean } = {}
) {
  const { enabled = true, ...query } = opts;
  return useQuery<PublicTailorListResult, Error>({
    queryKey: tailorKeys.public(query),
    queryFn: () => getPublicTailors(query),
    staleTime: 60_000,
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function usePublicTailorQuery(
  slug: string,
  enabled = true,
  initialData?: PublicTailorDto
) {
  return useQuery<PublicTailorDto, Error>({
    queryKey: tailorKeys.publicDetail(slug),
    queryFn: () => getPublicTailorBySlug(slug),
    initialData,
    staleTime: 60_000,
    enabled: enabled && Boolean(slug),
    retry: false,
  });
}

export function usePublicTailorReviewsQuery(slug: string, enabled = true) {
  return useQuery<PublicTailorReviewsResult, Error>({
    queryKey: tailorKeys.publicReviews(slug),
    queryFn: () => getPublicTailorReviews(slug),
    staleTime: 60_000,
    enabled: enabled && Boolean(slug),
    retry: false,
  });
}

export function useFeaturedTailorsQuery(limit = 4) {
  return useQuery<PublicTailorListResult, Error>({
    queryKey: tailorKeys.featured,
    queryFn: () => getPublicTailors({ page: 1, limit }),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useAdminTailorsQuery(
  opts?: { q?: string; status?: TailorStatus | ''; enabled?: boolean }
) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const q = opts?.q ?? '';
  const status = opts?.status ?? '';
  const key = tailorKeys.admin(orgId, q, status);
  return useQuery({
    queryKey: key,
    queryFn: () => getAdminTailors({ q, status }),
    enabled: opts?.enabled !== false && Boolean(orgId),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

export function useCreateTailorMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: (payload: TailorAdminInput) => createAdminTailor(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tailorKeys.all(orgId) });
      void queryClient.invalidateQueries({ queryKey: ['admin-members'] });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}

export function useUpdateTailorMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: TailorAdminInput;
    }) => updateAdminTailor(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tailorKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: ["measurement-campaigns"],
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-members'] });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}

export function usePatchTailorStatusMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TailorStatus }) =>
      patchAdminTailorStatus(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tailorKeys.all(orgId) });
      // Joinability of active campaigns depends on tailor approval status.
      void queryClient.invalidateQueries({
        queryKey: ["measurement-campaigns"],
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-members'] });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}

export function useMyTailorQuery(enabled = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useQuery({
    queryKey: tailorKeys.me(orgId),
    queryFn: getMyTailorProfile,
    staleTime: 10_000,
    enabled,
    retry: false,
  });
}

export function useUpdateMyTailorMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: (payload: TailorSelfInput) => updateMyTailorProfile(payload),
    onSuccess: (tailor: TailorProfileDto) => {
      queryClient.setQueryData(tailorKeys.me(orgId), tailor);
      void queryClient.invalidateQueries({ queryKey: tailorKeys.all(orgId) });
    },
  });
}

export function useUploadTailorPortfolioMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: (file: File) => uploadTailorPortfolioImage(file),
    onSuccess: ({ tailor }) => {
      queryClient.setQueryData(tailorKeys.me(orgId), tailor);
      void queryClient.invalidateQueries({ queryKey: tailorKeys.all(orgId) });
    },
  });
}

export function useSubmitTailorReviewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitTailorReview,
    onSuccess: (_review, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['tailors'] });
      void queryClient.invalidateQueries({
        queryKey: tailorKeys.publicDetail(variables.slug),
      });
      void queryClient.invalidateQueries({
        queryKey: tailorKeys.publicReviews(variables.slug),
      });
      void queryClient.invalidateQueries({
        queryKey: jobKeys.detail(variables.jobId),
      });
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: notificationKeys.mine() });
    },
  });
}
