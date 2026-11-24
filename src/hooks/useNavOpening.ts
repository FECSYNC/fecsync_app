'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useNavigationFeedbackOptional } from '@/contexts/navigation-feedback';

const NAV_FALLBACK_MS = 5_000;

function pathOnly(href: string): string {
  const bare = href.split('?')[0]?.split('#')[0] || '/';
  return bare.startsWith('/') ? bare : `/${bare}`;
}

/**
 * Pending navigation feedback for storefront links (slow networks / soft navigations).
 * Syncs with the global NavigationFeedbackProvider when available.
 */
export function useNavOpening() {
  const router = useRouter();
  const pathname = usePathname();
  const globalNav = useNavigationFeedbackOptional();
  const pathnameRef = useRef(pathname);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const navigating = Boolean(pendingKey) || isPending || Boolean(globalNav?.navigating);

  const finishSoon = useCallback((delayMs = 180) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setPendingKey(null);
    }, delayMs);
  }, []);

  useEffect(() => {
    pathnameRef.current = pathname;
    finishSoon(120);
  }, [pathname, finishSoon]);

  useEffect(() => {
    if (!pendingKey) return;
    const safety = setTimeout(() => setPendingKey(null), 12_000);
    return () => clearTimeout(safety);
  }, [pendingKey]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  const isBusy = useCallback(
    (key: string) => pendingKey === key,
    [pendingKey]
  );

  const navigate = useCallback(
    (key: string, href: string) => {
      const target = pathOnly(href);
      const current = pathOnly(pathname);

      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      setPendingKey(key);

      if (target === current) {
        finishSoon(220);
        return;
      }

      if (globalNav) {
        globalNav.begin(href);
      }

      try {
        void router.prefetch(href);
      } catch {
        /* prefetch optional */
      }

      startTransition(() => {
        router.push(href);
      });

      // Dev Turbopack / slow RSC: fall back to full navigation if soft routing stalls.
      fallbackTimerRef.current = setTimeout(() => {
        fallbackTimerRef.current = null;
        if (pathOnly(window.location.pathname) === target) return;
        window.location.assign(href);
      }, NAV_FALLBACK_MS);
    },
    [pathname, router, finishSoon, globalNav]
  );

  const prefetch = useCallback(
    (href: string) => {
      try {
        void router.prefetch(href);
      } catch {
        /* ignore */
      }
    },
    [router]
  );

  return { pendingKey, navigating, isBusy, navigate, prefetch };
}
