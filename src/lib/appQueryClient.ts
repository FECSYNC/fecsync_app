import type { QueryClient } from '@tanstack/react-query';

/** App QueryClient for non-React paths (logout, cross-tab auth). */
let appQueryClient: QueryClient | null = null;

export function setAppQueryClient(client: QueryClient): void {
  appQueryClient = client;
}

export function clearAppQueryClient(): void {
  appQueryClient = null;
}

export function getAppQueryClient(): QueryClient | null {
  return appQueryClient;
}
