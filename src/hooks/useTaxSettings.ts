'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTaxSettings,
  getAdminTaxSettings,
  updateTaxSettings,
  type TaxSettings,
} from '@/services/tax';
import { cartKeys } from '@/hooks/useCart';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const taxSettingsKeys = {
  all: ['tax-settings'] as const,
  public: ['tax-settings', 'public'] as const,
  admin: ['tax-settings', 'admin'] as const,
};

export function useTaxSettingsQuery() {
  return useQuery({
    queryKey: taxSettingsKeys.public,
    queryFn: getTaxSettings,
    staleTime: 60_000,
  });
}

export function useAdminTaxSettingsQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: taxSettingsKeys.admin,
    queryFn: getAdminTaxSettings,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(taxSettingsKeys.admin),
    placeholderData: (previous) => previous,
  });
}

export function useUpdateTaxSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Partial<TaxSettings>) => updateTaxSettings(payload),
    onSuccess: (settings) => {
      // Admin tax is actor.orgId; public checkout tax is storefront org —
      // never copy admin payload into the public cache (PAYMENT_POLICY.tax).
      queryClient.setQueryData(taxSettingsKeys.admin, settings);
      queryClient.invalidateQueries({ queryKey: taxSettingsKeys.public });
      // Refresh cart mappings so checkout stays aligned when orgs match.
      queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}
