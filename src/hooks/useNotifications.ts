import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  type AppNotification,
} from "@/services/notifications";
import { useAuthStore } from "@/store/authStore";
import { ADMIN_NOTIFICATIONS_LIVE_MS } from "@/utils/adminLiveRefresh";
import { ApiError } from "@/utils/api";

export const notificationKeys = {
  all: ["notifications"] as const,
  mine: () => [...notificationKeys.all, "mine"] as const,
};

function isTransientNotificationError(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return true; // timeout / network
  return error.status >= 500;
}

export function useNotificationsQuery(enabled: boolean = true) {
  const { isAuthenticated } = useAuthStore();

  return useQuery<AppNotification[], Error>({
    queryKey: notificationKeys.mine(),
    queryFn: getMyNotifications,
    enabled: enabled && isAuthenticated,
    staleTime: ADMIN_NOTIFICATIONS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: ADMIN_NOTIFICATIONS_LIVE_MS,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) =>
      isTransientNotificationError(error) ? failureCount < 2 : failureCount < 1,
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 8000),
    placeholderData: (previous) => previous,
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.mine() });
      const previous = queryClient.getQueryData<AppNotification[]>(
        notificationKeys.mine()
      );
      queryClient.setQueryData<AppNotification[]>(notificationKeys.mine(), (old = []) =>
        old.map((n) => (n._id === id ? { ...n, read: true } : n))
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(notificationKeys.mine(), ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.mine() });
    },
  });
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.mine() });
      const previous = queryClient.getQueryData<AppNotification[]>(
        notificationKeys.mine()
      );
      queryClient.setQueryData<AppNotification[]>(notificationKeys.mine(), (old = []) =>
        old.map((n) => ({ ...n, read: true }))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(notificationKeys.mine(), ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.mine() });
    },
  });
}

export function useDeleteNotificationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteNotification(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.mine() });
      const previous = queryClient.getQueryData<AppNotification[]>(
        notificationKeys.mine()
      );
      queryClient.setQueryData<AppNotification[]>(notificationKeys.mine(), (old = []) =>
        old.filter((n) => n._id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(notificationKeys.mine(), ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.mine() });
    },
  });
}
