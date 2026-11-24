'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listAdminFashionChats,
  getAdminFashionChat,
  replyAdminFashionChat,
  patchAdminFashionChat,
  deleteAdminFashionChat,
  deleteAdminFashionChats,
  type AdminFashionChatsResponse,
} from '@/services/fashionChat';
import { ApiError } from '@/utils/api';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';

export const FASHION_CHAT_PAGE_SIZE = 5;

export const fashionChatAdminKeys = {
  all: ['admin-fashion-chats'] as const,
  list: (filters: Record<string, unknown>) =>
    [...fashionChatAdminKeys.all, 'list', filters] as const,
  detail: (id: string) => [...fashionChatAdminKeys.all, 'detail', id] as const,
};

function removeChatsFromListCaches(
  qc: ReturnType<typeof useQueryClient>,
  ids: string[]
) {
  const remove = new Set(ids);
  qc.setQueriesData<AdminFashionChatsResponse>(
    {
      queryKey: fashionChatAdminKeys.all,
      predicate: (query) => query.queryKey[1] === 'list',
    },
    (old) => {
      if (!old?.chats) return old;
      const nextChats = old.chats.filter((chat) => !remove.has(chat.id));
      const removed = old.chats.length - nextChats.length;
      if (removed === 0) return old;
      return {
        ...old,
        chats: nextChats,
        stats: {
          ...old.stats,
          total: Math.max(0, (old.stats.total ?? 0) - removed),
          returned: nextChats.length,
        },
      };
    }
  );
}

export function useAdminFashionChatsQuery(
  enabled: boolean,
  filters: {
    handoff?: boolean;
    status?: string;
    q?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : FASHION_CHAT_PAGE_SIZE;
  const queryFilters = { ...filters, page, limit };
  const key = fashionChatAdminKeys.list(queryFilters);

  return useQuery({
    queryKey: key,
    queryFn: () => listAdminFashionChats(queryFilters),
    enabled: enabled && Boolean(orgId),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    refetchInterval: enabled ? 45_000 : false,
    placeholderData: (previous) => previous,
  });
}

export function useAdminFashionChatQuery(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: fashionChatAdminKeys.detail(id || ''),
    queryFn: () => getAdminFashionChat(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 5_000,
    refetchInterval: (query) => {
      if (!id || !enabled) return false;
      const err = query.state.error;
      if (err instanceof ApiError && err.status === 404) return false;
      return 12_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

export function useReplyFashionChatMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      replyAdminFashionChat(id, content),
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: fashionChatAdminKeys.all });
      qc.setQueryData(fashionChatAdminKeys.detail(chat.id), chat);
    },
  });
}

export function usePatchFashionChatMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { status?: string; handoffRequired?: boolean };
    }) => patchAdminFashionChat(id, patch),
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: fashionChatAdminKeys.all });
      qc.setQueryData(fashionChatAdminKeys.detail(chat.id), chat);
    },
  });
}

export function useDeleteFashionChatMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAdminFashionChat(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: fashionChatAdminKeys.all });
      await qc.cancelQueries({ queryKey: fashionChatAdminKeys.detail(id) });

      const previousLists = qc.getQueriesData<AdminFashionChatsResponse>({
        queryKey: fashionChatAdminKeys.all,
        predicate: (query) => query.queryKey[1] === 'list',
      });

      removeChatsFromListCaches(qc, [id]);
      qc.removeQueries({ queryKey: fashionChatAdminKeys.detail(id) });

      return { previousLists };
    },
    onError: (_err, _id, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (_data, _err, id) => {
      void qc.invalidateQueries({ queryKey: fashionChatAdminKeys.all });
      qc.removeQueries({ queryKey: fashionChatAdminKeys.detail(id) });
    },
  });
}

export function useBulkDeleteFashionChatsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => deleteAdminFashionChats(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: fashionChatAdminKeys.all });
      await Promise.all(
        ids.map((id) =>
          qc.cancelQueries({ queryKey: fashionChatAdminKeys.detail(id) })
        )
      );

      const previousLists = qc.getQueriesData<AdminFashionChatsResponse>({
        queryKey: fashionChatAdminKeys.all,
        predicate: (query) => query.queryKey[1] === 'list',
      });

      removeChatsFromListCaches(qc, ids);
      for (const id of ids) {
        qc.removeQueries({ queryKey: fashionChatAdminKeys.detail(id) });
      }

      return { previousLists };
    },
    onError: (_err, _ids, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (_data, _err, ids) => {
      void qc.invalidateQueries({ queryKey: fashionChatAdminKeys.all });
      for (const id of ids) {
        qc.removeQueries({ queryKey: fashionChatAdminKeys.detail(id) });
      }
    },
  });
}
