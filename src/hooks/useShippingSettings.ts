'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminShippingSettings,
  updateShippingSettings,
  testShippingConnection,
  type ShippingSettings,
} from '@/services/shippingSettings';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const shippingSettingsKeys = {
  admin: ['shipping-settings', 'admin'] as const,
};

export function useAdminShippingSettingsQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: shippingSettingsKeys.admin,
    queryFn: getAdminShippingSettings,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(shippingSettingsKeys.admin),
    placeholderData: (previous) => previous,
  });
}

export function useUpdateShippingSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Parameters<typeof updateShippingSettings>[0]) =>
      updateShippingSettings(payload),
    onSuccess: (settings: ShippingSettings) => {
      queryClient.setQueryData(shippingSettingsKeys.admin, settings);
    },
  });
}

export function useTestShippingConnectionMutation() {
  return useMutation({
    mutationFn: (payload?: { destinationState?: string }) =>
      testShippingConnection(payload),
  });
}
