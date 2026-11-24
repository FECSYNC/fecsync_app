'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addUserBlacklistEntry,
  listUserBlacklist,
  removeUserBlacklistEntry,
  type UserBlacklistType,
} from '@/services/userBlacklist';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const userBlacklistKeys = {
  all: ['admin-user-blacklist'] as const,
  list: () => [...userBlacklistKeys.all, 'list'] as const,
};

export function useUserBlacklistQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: userBlacklistKeys.list(),
    queryFn: listUserBlacklist,
    enabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(userBlacklistKeys.list()),
    placeholderData: (previous) => previous,
  });
}

export function useAddUserBlacklistMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      type: UserBlacklistType;
      value: string;
      reason?: string;
    }) => addUserBlacklistEntry(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userBlacklistKeys.all });
    },
  });
}

export function useRemoveUserBlacklistMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeUserBlacklistEntry(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userBlacklistKeys.all });
    },
  });
}
