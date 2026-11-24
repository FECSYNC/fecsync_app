'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPublicHomepageContent,
  getAdminHomepageSections,
  updateAdminHomepageSection,
  resetAdminHomepageSection,
} from '@/services/homepageContent';
import type {
  HomepageSectionDto,
  HomepageSectionKey,
} from '@/lib/homepageContent.shared';
import { HOMEPAGE_SECTION_KEYS } from '@/lib/homepageContent.shared';
import { broadcastCatalogChange } from '@/lib/catalogSync';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const homepageContentKeys = {
  all: ['homepage-content'] as const,
  public: ['homepage-content', 'public'] as const,
  admin: ['homepage-content', 'admin'] as const,
  adminSection: (key: HomepageSectionKey) =>
    ['homepage-content', 'admin', key] as const,
};

type PublicHomepagePayload = {
  sections: HomepageSectionDto[];
  byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>>;
};

/** Storefront — no placeholder defaults (avoids flashing unpublished/custom CMS). */
export function usePublicHomepageContentQuery() {
  return useQuery({
    queryKey: homepageContentKeys.public,
    queryFn: getPublicHomepageContent,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 800,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useAdminHomepageSectionsQuery(enabled = true) {
  return useQuery({
    queryKey: homepageContentKeys.admin,
    queryFn: getAdminHomepageSections,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(homepageContentKeys.admin),
    placeholderData: (previous) => previous,
  });
}

function patchAdminList(
  sections: HomepageSectionDto[] | undefined,
  next: HomepageSectionDto
): HomepageSectionDto[] {
  if (!sections?.length) return [next];
  return sections.map((row) => (row.key === next.key ? next : row));
}

/**
 * Patch public cache only when it already exists.
 * Never invent defaults into the public cache (that poisons same-tab /home).
 */
function patchPublicCache(
  current: PublicHomepagePayload | undefined,
  next: HomepageSectionDto
): PublicHomepagePayload | undefined {
  if (!current) return current;

  const without = current.sections.filter((s) => s.key !== next.key);
  const sections = next.published ? [...without, next] : without;
  sections.sort(
    (a, b) =>
      HOMEPAGE_SECTION_KEYS.indexOf(a.key) -
      HOMEPAGE_SECTION_KEYS.indexOf(b.key)
  );
  const byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>> = {};
  for (const section of sections) {
    byKey[section.key] = section;
  }
  return { sections, byKey };
}

function syncHomepageCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  section: HomepageSectionDto
) {
  queryClient.setQueryData(homepageContentKeys.admin, (prev) =>
    patchAdminList(prev as HomepageSectionDto[] | undefined, section)
  );
  queryClient.setQueryData(
    homepageContentKeys.adminSection(section.key),
    section
  );

  const existingPublic = queryClient.getQueryData<PublicHomepagePayload>(
    homepageContentKeys.public
  );
  if (existingPublic) {
    queryClient.setQueryData(
      homepageContentKeys.public,
      patchPublicCache(existingPublic, section)
    );
  }

  // Refetch even inactive queries so next /home visit is accurate
  // (QueryProvider sets refetchOnMount: false globally).
  void queryClient.invalidateQueries({
    queryKey: homepageContentKeys.public,
    refetchType: 'all',
  });
  void queryClient.invalidateQueries({
    queryKey: homepageContentKeys.admin,
    refetchType: 'active',
  });

  broadcastCatalogChange({
    kind: 'homepage',
    action: 'update',
    id: section.key,
  });
}

export function useUpdateHomepageSectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      key,
      payload,
    }: {
      key: HomepageSectionKey;
      payload: { published?: boolean; content?: unknown; label?: string };
    }) => updateAdminHomepageSection(key, payload),
    onSuccess: (section) => {
      syncHomepageCaches(queryClient, section);
    },
  });
}

export function useResetHomepageSectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: HomepageSectionKey) => resetAdminHomepageSection(key),
    onSuccess: (section) => {
      syncHomepageCaches(queryClient, section);
    },
  });
}
