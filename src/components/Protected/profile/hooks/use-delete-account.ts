import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { deleteCurrentUser } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { clearUserQueries } from '@/utils/clearUserQueries';

function isPolicyBlockedDelete(status: number, message: string): boolean {
  if (status !== 403) return false;
  const msg = message.toLowerCase();
  return (
    msg.includes('platform_admin') ||
    msg.includes('storefront or studio history') ||
    msg.includes('cannot delete') ||
    msg.includes('cannot permanently delete') ||
    msg.includes('orders') ||
    msg.includes('forbidden')
  );
}

export function useDeleteAccount() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();

  const handleDeleteAccount = async () => {
    setIsPending(true);
    setError(null);

    try {
      const response = await deleteCurrentUser();
      void response;

      // Success: cookies cleared by DELETE /api/auth/me; finish client cleanup.
      await new Promise((resolve) => setTimeout(resolve, 500));
      clearUserQueries(queryClient);
      await logout();
      router.replace('/home');
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : 0;
      const message =
        err instanceof Error
          ? err.message
          : err &&
              typeof err === 'object' &&
              'message' in err &&
              typeof (err as { message?: unknown }).message === 'string'
            ? String((err as { message: string }).message)
            : '';

      // Policy refusals (last admin, order history, etc.) must keep the session —
      // never treat 403 as a successful delete.
      if (isPolicyBlockedDelete(status, message)) {
        setError(
          message ||
            'Your account cannot be deleted right now. Please contact support.'
        );
        return;
      }

      // Ambiguous success shapes (legacy clients).
      if (
        message.toLowerCase().includes('deleted successfully') ||
        status === 200 ||
        status === 204
      ) {
        clearUserQueries(queryClient);
        await logout();
        router.replace('/home');
        return;
      }

      if (status === 401 || status === 404) {
        // Session already gone / user already removed — finish client logout.
        clearUserQueries(queryClient);
        await logout();
        router.replace('/home');
        return;
      }

      if (status >= 500) {
        setError('Server error. Please try again later.');
      } else {
        setError(message || 'Failed to delete account. Please try again.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return {
    isPending,
    error,
    handleDeleteAccount,
  };
}
