'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminAiSettings,
  importAdminAiFromEnv,
  testAdminAiConnection,
  updateAiSettings,
  type TestAiSettingsPayload,
  type UpdateAiSettingsPayload,
} from '@/services/aiSettings';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const aiSettingsKeys = {
  all: ['ai-settings'] as const,
  admin: ['ai-settings', 'admin'] as const,
};

export function useAdminAiSettingsQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: aiSettingsKeys.admin,
    queryFn: getAdminAiSettings,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(aiSettingsKeys.admin),
    placeholderData: (previous) => previous,
  });
}

export function useUpdateAiSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateAiSettingsPayload) => updateAiSettings(payload),
    onSuccess: (settings) => {
      queryClient.setQueryData(aiSettingsKeys.admin, settings);
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
    },
  });
}

export function useImportAiFromEnvMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => importAdminAiFromEnv(),
    onSuccess: (settings) => {
      queryClient.setQueryData(aiSettingsKeys.admin, settings);
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
    },
  });
}

export function useTestAiConnectionMutation() {
  return useMutation({
    mutationFn: (payload?: TestAiSettingsPayload) =>
      testAdminAiConnection(payload),
  });
}
