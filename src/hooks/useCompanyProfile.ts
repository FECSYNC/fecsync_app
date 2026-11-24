'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { getMe } from '@/services/auth';
import { followRenamedCompanySignIn } from '@/utils/authRedirect';
import {
  getAdminCompanyProfile,
  updateCompanyProfile,
  uploadCompanyLogo,
  clearCompanyLogo,
  uploadSigninBackground,
  clearSigninBackground,
  type CompanyProfile,
  type CompanyProfileUpdatePayload,
} from '@/services/companyProfile';
import { COMPANY_PROFILE_SESSION_SYNC_KEY } from '@/utils/orgSaasSessionSync';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import {
  broadcastCatalogChange,
  invalidateCatalogQueries,
} from '@/lib/catalogSync';

export const companyProfileKeys = {
  all: ['company-profile'] as const,
  admin: (orgId: string | null | undefined) =>
    ['company-profile', 'admin', orgId ?? 'none'] as const,
};

/** @deprecated Prefer importing from `@/utils/orgSaasSessionSync`. */
export { COMPANY_PROFILE_SESSION_SYNC_KEY };

function applySessionCompanyPatch(patch: {
  legalName?: string | null;
  tradingName?: string | null;
  companyDisplayName?: string | null;
  profileCompleteness?: number | null;
  hasLogo?: boolean;
  companyLogoUrl?: string | null;
  organizationSlug?: string | null;
}) {
  useAuthStore.getState().updateUser(patch);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(
        COMPANY_PROFILE_SESSION_SYNC_KEY,
        JSON.stringify({ ...patch, t: Date.now() })
      );
    } catch {
      /* ignore quota */
    }
  }
}

/** Prefer mutation profile (always available); optionally reconcile via /me. */
async function syncSessionFromProfile(profile: CompanyProfile) {
  applySessionCompanyPatch({
    legalName: profile.legalName ?? null,
    tradingName: profile.tradingName ?? null,
    companyDisplayName: profile.displayName ?? null,
    profileCompleteness: profile.completeness,
    hasLogo: Boolean(profile.logoUrl),
    companyLogoUrl: profile.logoUrl ?? null,
    organizationSlug: profile.organizationSlug ?? null,
  });
  try {
    const { user } = await getMe({ force: true });
    // Full /me merge keeps orgStatus + billing fields aligned with ops/webhook.
    useAuthStore.getState().setUser(user);
  } catch (err) {
    // Mutation profile already applied — header stays consistent with saved DTO.
    console.warn('[company-profile] /me reconcile after save failed:', err);
  }
}

export function useAdminCompanyProfileQuery(
  enabled: boolean = true,
  options?: { freshForPrint?: boolean }
) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const queryClient = useQueryClient();
  const fresh = Boolean(options?.freshForPrint);

  // Other tabs broadcast profile saves — drop stale print/brand cache.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COMPANY_PROFILE_SESSION_SYNC_KEY || !event.newValue) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: companyProfileKeys.all });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  return useQuery({
    queryKey: companyProfileKeys.admin(orgId),
    queryFn: getAdminCompanyProfile,
    enabled: enabled && Boolean(orgId),
    ...(fresh
      ? {
          staleTime: 0,
          refetchOnMount: 'always' as const,
          refetchOnWindowFocus: false,
        }
      : {
          ...adminListQueryDefaults,
          ...withAdminListSnapshot(companyProfileKeys.admin(orgId)),
          placeholderData: (previous: CompanyProfile | undefined) => previous,
        }),
    gcTime: 30 * 60 * 1000,
  });
}

export function useUpdateCompanyProfileMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);

  return useMutation({
    mutationFn: (payload: CompanyProfileUpdatePayload) =>
      updateCompanyProfile(payload),
    onSuccess: async (result: { profile: CompanyProfile; wrote: boolean }) => {
      const previous = queryClient.getQueryData<CompanyProfile>(
        companyProfileKeys.admin(orgId)
      );
      const previousSlug = previous?.organizationSlug?.trim() || '';
      const sessionSlugBefore = useAuthStore.getState().user?.organizationSlug ?? null;
      queryClient.setQueryData(
        companyProfileKeys.admin(orgId),
        result.profile
      );
      await syncSessionFromProfile(result.profile);
      const nextSlug = result.profile.organizationSlug?.trim() || '';
      followRenamedCompanySignIn(previousSlug || sessionSlugBefore, nextSlug);
      if (previous && previousSlug !== nextSlug) {
        invalidateCatalogQueries(queryClient, 'public-category-links');
        broadcastCatalogChange({
          kind: 'public-category-links',
          action: 'update',
        });
      }
    },
  });
}

export function useUploadCompanyLogoMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);

  return useMutation({
    mutationFn: (file: File) => uploadCompanyLogo(file),
    onSuccess: async (profile: CompanyProfile) => {
      queryClient.setQueryData(companyProfileKeys.admin(orgId), profile);
      await syncSessionFromProfile(profile);
    },
  });
}

export function useClearCompanyLogoMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);

  return useMutation({
    mutationFn: () => clearCompanyLogo(),
    onSuccess: async (profile: CompanyProfile) => {
      queryClient.setQueryData(companyProfileKeys.admin(orgId), profile);
      await syncSessionFromProfile(profile);
    },
  });
}

export function useUploadSigninBackgroundMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);

  return useMutation({
    mutationFn: (file: File) => uploadSigninBackground(file),
    onSuccess: async (profile: CompanyProfile) => {
      queryClient.setQueryData(companyProfileKeys.admin(orgId), profile);
      await syncSessionFromProfile(profile);
    },
  });
}

export function useClearSigninBackgroundMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);

  return useMutation({
    mutationFn: () => clearSigninBackground(),
    onSuccess: async (profile: CompanyProfile) => {
      queryClient.setQueryData(companyProfileKeys.admin(orgId), profile);
      await syncSessionFromProfile(profile);
    },
  });
}
