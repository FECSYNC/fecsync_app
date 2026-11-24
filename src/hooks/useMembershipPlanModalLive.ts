/**
 * Live data for the Create/Edit membership plan modal — categories, org
 * settings, catalog products (free refs), and sibling-plan vocabularies.
 * Polls only while the modal is open.
 */
'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  getMembershipSettings,
  listMembershipCategories,
  listMembershipPlans,
  membershipKeys,
  type MembershipPlanDto,
  type MembershipSettingsDto,
} from '@/services/memberships';
import {
  adminGetProducts,
  type Product,
} from '@/services/products';
import { adminProductKeys } from '@/hooks/useProducts';

export type PlanFormSettingsLink = {
  /** Follow Memberships → Settings allowPause until user overrides. */
  pauseAllowed: boolean;
  /** Follow requireAgreementBeforeActive until user overrides. */
  agreementRequired: boolean;
};

export type MembershipPlanModalLive = {
  categories: { id: string; name: string }[];
  categoriesFetching: boolean;
  settings: MembershipSettingsDto | undefined;
  settingsFetching: boolean;
  products: { id: string; name: string }[];
  productsFetching: boolean;
  /** Distinct upgrade group keys from active plans. */
  upgradeGroupKeys: string[];
  /** Distinct reportingCategory GL strings from plans. */
  reportingCategories: string[];
  /** Distinct perk flags from plan entitlements. */
  perkFlags: string[];
  /** Active plan list (for concurrent-edit detection + vocab). */
  plans: MembershipPlanDto[];
  /** Sibling plans list soft-refresh (GL / upgrade vocab). */
  plansFetching: boolean;
  liveSettingsLink: PlanFormSettingsLink;
  setLiveSettingsLink: Dispatch<SetStateAction<PlanFormSettingsLink>>;
  /** Reset link flags when opening create (follow settings) or edit (detached). */
  resetSettingsLink: (mode: 'create' | 'edit') => void;
};

function productId(p: Product): string | null {
  const id = (p.id || p._id || '').toString().trim();
  return id || null;
}

function uniqSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean).sort((a, b) =>
    a.localeCompare(b)
  );
}

export function useMembershipPlanModalLive(opts: {
  enabled: boolean;
  modalOpen: boolean;
  canRead: boolean;
}): MembershipPlanModalLive {
  const { enabled, modalOpen, canRead } = opts;
  const live = enabled && modalOpen && canRead;

  const [liveSettingsLink, setLiveSettingsLink] =
    useState<PlanFormSettingsLink>({
      pauseAllowed: true,
      agreementRequired: true,
    });

  const resetSettingsLink = (mode: 'create' | 'edit') => {
    setLiveSettingsLink({
      pauseAllowed: mode === 'create',
      agreementRequired: mode === 'create',
    });
  };

  const categoriesQuery = useQuery({
    queryKey: membershipKeys.categories(false),
    queryFn: () => listMembershipCategories({ includeArchived: false }),
    enabled: canRead,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: live ? 'always' : true,
  });

  const settingsQuery = useQuery({
    queryKey: membershipKeys.settings(null),
    queryFn: () => getMembershipSettings(null),
    enabled: canRead,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: live ? 'always' : false,
  });

  const plansVocabQuery = useQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans({ includeArchived: false }),
    enabled: canRead,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: live ? 'always' : false,
  });

  const productsQuery = useQuery({
    queryKey: [...adminProductKeys.lists(), 'membership-plan-free-refs'] as const,
    queryFn: async (): Promise<Product[]> => {
      const response = await adminGetProducts({
        page: 1,
        limit: 200,
        sort: 'newest',
      });
      if (Array.isArray(response)) return response;
      if (response && typeof response === 'object') {
        const withItems = response as { items?: Product[]; data?: Product[] };
        if (Array.isArray(withItems.items)) return withItems.items;
        if (Array.isArray(withItems.data)) return withItems.data;
      }
      return [];
    },
    enabled: live,
    staleTime: 0,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
  });

  // Force a soft refresh as soon as the modal opens (bypass long stale windows).
  const openedRef = useRef(false);
  useEffect(() => {
    if (!modalOpen) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    void categoriesQuery.refetch();
    void settingsQuery.refetch();
    void plansVocabQuery.refetch();
    void productsQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open edge only
  }, [modalOpen]);

  const products = useMemo(() => {
    const rows: Product[] = productsQuery.data ?? [];
    return rows
      .map((p: Product) => {
        const id = productId(p);
        if (!id) return null;
        return { id, name: p.name || id };
      })
      .filter((x): x is { id: string; name: string } => Boolean(x))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [productsQuery.data]);

  const plans = plansVocabQuery.data ?? [];

  const upgradeGroupKeys = useMemo(
    () =>
      uniqSorted(
        plans
          .map((p) => p.upgradeGroupKey?.trim() ?? '')
          .filter(Boolean)
      ),
    [plans]
  );

  const reportingCategories = useMemo(
    () =>
      uniqSorted(
        plans
          .map((p) => p.reportingCategory?.trim() ?? '')
          .filter(Boolean)
      ),
    [plans]
  );

  const perkFlags = useMemo(() => {
    const flags: string[] = [];
    for (const p of plans) {
      const arr = p.entitlements?.perkFlags;
      if (!Array.isArray(arr)) continue;
      for (const f of arr) {
        if (typeof f === 'string' && f.trim()) flags.push(f.trim());
      }
    }
    return uniqSorted(flags);
  }, [plans]);

  return {
    categories: (categoriesQuery.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
    })),
    categoriesFetching: categoriesQuery.isFetching,
    settings: settingsQuery.data,
    settingsFetching: settingsQuery.isFetching,
    products,
    productsFetching: productsQuery.isFetching,
    upgradeGroupKeys,
    reportingCategories,
    perkFlags,
    plans,
    plansFetching: plansVocabQuery.isFetching,
    liveSettingsLink,
    setLiveSettingsLink,
    resetSettingsLink,
  };
}
