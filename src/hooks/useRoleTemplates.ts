'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateBillingUsageQueries } from '@/hooks/useBilling';
import {
  createRoleTemplate,
  deleteRoleTemplate,
  listRoleTemplates,
  updateRoleTemplate,
  type RoleTemplate,
} from '@/services/roleTemplates';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const roleTemplateKeys = {
  all: ['admin-role-templates'] as const,
  list: () => [...roleTemplateKeys.all, 'list'] as const,
};

export function useRoleTemplatesQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: roleTemplateKeys.list(),
    queryFn: listRoleTemplates,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(roleTemplateKeys.list()),
    placeholderData: (previous) => previous,
  });
}

export function useCreateRoleTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRoleTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roleTemplateKeys.all });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}

export function useUpdateRoleTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      name?: string;
      description?: string;
      permissions?: string[];
    }) => updateRoleTemplate(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roleTemplateKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['admin-members'] });
    },
  });
}

export function useDeleteRoleTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRoleTemplate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roleTemplateKeys.all });
      invalidateBillingUsageQueries(queryClient);
    },
  });
}

export type { RoleTemplate };
