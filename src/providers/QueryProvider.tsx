'use client';

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactNode, useEffect, useState } from 'react';
import {
  invalidateCatalogQueries,
  subscribeCatalogChange,
  syncOpenCartWithCatalogChange,
} from '@/lib/catalogSync';
import {
  invalidateMembershipQueries,
  subscribeMembershipChange,
} from '@/lib/membershipsSync';
import { clearAppQueryClient, setAppQueryClient } from '@/lib/appQueryClient';
import type { ClientSyncMode } from '@/lib/clientSync/constants';
import { reportUserError } from '@/lib/userErrorBus';
import { isExpectedClientError } from '@/lib/userFacingError';
import { isTransientApiError } from '@/utils/api';
import { persistAdminQuerySuccess } from '@/lib/adminListSnapshot';

const isDev = process.env.NODE_ENV === 'development';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onSuccess: (data, query) => {
            persistAdminQuerySuccess(query.queryKey, data);
          },
          onError: (error, query) => {
            if (query.meta?.suppressErrorBanner === true) return;
            // Background list/prefetch timeouts are common on the remote pooler —
            // never flash the global "could not reach FECSYNC" banner for them.
            if (isTransientApiError(error) || isExpectedClientError(error)) {
              return;
            }
            reportUserError(error);
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            if (mutation.meta?.suppressErrorBanner === true) return;
            reportUserError(error);
          },
        }),
        defaultOptions: {
          queries: {
            // Admin list tables paint from prefetch/cache. Live surfaces
            // (orders bell, dashboard) opt into their own intervals.
            staleTime: isDev ? 5 * 60 * 1000 : 5 * 60 * 1000,
            gcTime: isDev ? 30 * 60 * 1000 : 30 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            // Prefetch + hover warm — do not re-hit the network on every mount.
            refetchOnMount: false,
            // One retry is enough; a second attempt doubles pool pressure.
            retry: (failureCount, error) => {
              if (isTransientApiError(error) && failureCount < 1) return true;
              return false;
            },
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  useEffect(() => {
    setAppQueryClient(queryClient);
    return () => clearAppQueryClient();
  }, [queryClient]);

  useEffect(() => {
    return subscribeCatalogChange((msg) => {
      invalidateCatalogQueries(queryClient, msg.kind);
      void syncOpenCartWithCatalogChange(msg);
    });
  }, [queryClient]);

  useEffect(() => {
    return subscribeMembershipChange((msg) => {
      invalidateMembershipQueries(queryClient, msg.kind);
    });
  }, [queryClient]);

  useEffect(() => {
    const onClientSync = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: ClientSyncMode }>).detail?.mode;
      if (mode === 'hard') {
        queryClient.clear();
      } else {
        void queryClient.invalidateQueries({ refetchType: 'none' });
      }
    };
    window.addEventListener('harewa:client-sync', onClientSync);
    return () => window.removeEventListener('harewa:client-sync', onClientSync);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
