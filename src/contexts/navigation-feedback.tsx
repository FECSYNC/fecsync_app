'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

type PendingTarget = {
  href: string;
  top: number;
  left: number;
  width: number;
  height: number;
};

type NavigationFeedbackContextValue = {
  navigating: boolean;
  pendingHref: string | null;
  /** Start feedback + soft-navigate (for buttons / programmatic nav). */
  navigate: (href: string, opts?: { key?: string; replace?: boolean }) => void;
  /** Show feedback only (for Next.js <Link> clicks that already navigate). */
  begin: (href: string, el?: Element | null) => void;
  isBusyHref: (href: string) => boolean;
};

const NavigationFeedbackContext =
  createContext<NavigationFeedbackContextValue | null>(null);

function normalizePath(href: string): string {
  try {
    if (href.startsWith('http://') || href.startsWith('https://')) {
      const url = new URL(href);
      return `${url.pathname}${url.search}` || '/';
    }
  } catch {
    /* fall through */
  }
  const bare = href.split('#')[0] || '/';
  return bare.startsWith('/') ? bare : `/${bare}`;
}

function pathOnly(href: string): string {
  return normalizePath(href).split('?')[0] || '/';
}

/** `/` rewrites to the marketing home — treat them as one surface for nav feedback. */
function isSameAppPath(a: string, b: string): boolean {
  const left = pathOnly(a);
  const right = pathOnly(b);
  if (left === right) return true;
  const landing = new Set(['/', '/home']);
  return landing.has(left) && landing.has(right);
}

function isInternalHref(href: string): boolean {
  if (
    !href ||
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:')
  ) {
    return false;
  }
  if (href.startsWith('//')) return false;
  if (href.startsWith('http://') || href.startsWith('https://')) {
    if (typeof window === 'undefined') return false;
    try {
      return new URL(href).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  return href.startsWith('/');
}

function isModifiedClick(event: MouseEvent): boolean {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  );
}

function rectFromElement(el: Element): Omit<PendingTarget, 'href'> {
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: Math.max(rect.width, 44),
    height: Math.max(rect.height, 28),
  };
}

/** Soft RSC/Turbopack nav can stall; hard-navigate before the UI just “stops”. */
const NAV_FALLBACK_MS = 5_000;

export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null);
  const [isPending, startTransition] = useTransition();
  const navigating = Boolean(pendingHref) || isPending;

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const clearSoon = useCallback((delayMs = 160) => {
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    clearFallbackTimer();
    finishTimerRef.current = setTimeout(() => {
      finishTimerRef.current = null;
      setPendingHref(null);
      setPendingTarget(null);
    }, delayMs);
  }, [clearFallbackTimer]);

  const armHardNavFallback = useCallback(
    (href: string) => {
      clearFallbackTimer();
      const target = pathOnly(href);
      fallbackTimerRef.current = setTimeout(() => {
        fallbackTimerRef.current = null;
        if (pathOnly(window.location.pathname) === target) return;
        window.location.assign(href);
      }, NAV_FALLBACK_MS);
    },
    [clearFallbackTimer]
  );

  const begin = useCallback(
    (href: string, el?: Element | null) => {
      if (!isInternalHref(href)) return;
      const next = normalizePath(href);
      if (pathOnly(next).startsWith('/admin')) return;

      setPendingHref(next);
      if (el) {
        setPendingTarget({ href: next, ...rectFromElement(el) });
      } else {
        setPendingTarget(null);
      }

      // Hash / landing rewrites (/ ↔ /home) — no soft-nav stall to recover from.
      if (isSameAppPath(next, pathname)) {
        clearSoon(220);
        return;
      }

      // Link soft-nav can hang in dev (cold compile / RSC). Hard-nav if stalled.
      armHardNavFallback(next);
    },
    [pathname, clearSoon, armHardNavFallback]
  );

  const navigate = useCallback(
    (href: string, opts?: { key?: string; replace?: boolean }) => {
      if (!isInternalHref(href)) return;
      const next = normalizePath(href);
      if (pathOnly(next).startsWith('/admin')) {
        startTransition(() => {
          if (opts?.replace) router.replace(next);
          else router.push(next);
        });
        return;
      }

      setPendingHref(next);
      setPendingTarget(null);

      if (isSameAppPath(next, pathname)) {
        clearSoon(220);
        return;
      }

      armHardNavFallback(next);
      startTransition(() => {
        if (opts?.replace) router.replace(next);
        else router.push(next);
      });
    },
    [pathname, router, clearSoon, armHardNavFallback]
  );

  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    clearSoon(120);
  }, [pathname, clearSoon]);

  useEffect(() => {
    if (!pendingHref) return;
    const safety = setTimeout(() => {
      setPendingHref(null);
      setPendingTarget(null);
    }, 10000);
    return () => clearTimeout(safety);
  }, [pendingHref]);

  useEffect(() => {
    return () => {
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.body.style.cursor;
    if (navigating) document.body.style.cursor = 'progress';
    else document.body.style.cursor = previous || '';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [navigating]);

  useEffect(() => {
    const onClickCapture = (event: MouseEvent) => {
      if (isModifiedClick(event)) return;
      if (pathname.startsWith('/admin')) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const ignored = target.closest(
        '[data-nav-ignore], [download], a[target="_blank"], button[type="submit"]'
      );
      if (ignored) return;

      const marked = target.closest('[data-nav-href]') as HTMLElement | null;
      if (marked) {
        const href = marked.getAttribute('data-nav-href');
        if (!href || !isInternalHref(href)) return;
        event.preventDefault();
        begin(href, marked);
        const next = normalizePath(href);
        if (isSameAppPath(next, pathname)) {
          clearSoon(220);
          return;
        }
        startTransition(() => router.push(next));
        return;
      }

      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.hasAttribute('download') || anchor.target === '_blank') return;

      const href = anchor.getAttribute('href');
      if (!href || !isInternalHref(href)) return;
      begin(href, anchor);
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [pathname, begin, clearSoon, router]);

  const isBusyHref = useCallback(
    (href: string) => {
      if (!pendingHref) return false;
      return pathOnly(pendingHref) === pathOnly(href);
    },
    [pendingHref]
  );

  const value = useMemo(
    () => ({ navigating, pendingHref, navigate, begin, isBusyHref }),
    [navigating, pendingHref, navigate, begin, isBusyHref]
  );

  return (
    <NavigationFeedbackContext.Provider value={value}>
      {children}
      <NavigationFeedbackChrome
        navigating={navigating}
        pendingTarget={pendingTarget}
        hide={pathname.startsWith('/admin')}
      />
    </NavigationFeedbackContext.Provider>
  );
}

function NavigationFeedbackChrome({
  navigating,
  pendingTarget,
  hide,
}: {
  navigating: boolean;
  pendingTarget: PendingTarget | null;
  hide: boolean;
}) {
  if (hide) return null;

  return (
    <>
      <div
        className="pointer-events-none fixed left-0 right-0 top-0 z-[9998] h-0.5 overflow-hidden"
        aria-hidden={!navigating}
      >
        {navigating && (
          <div className="h-full w-full bg-[#D4AF37] animate-[navFeedbackProgress_1.1s_ease-in-out_infinite]" />
        )}
      </div>

      {navigating && pendingTarget && (
        <div
          className="pointer-events-none fixed z-[9999] flex items-center justify-center rounded-md bg-black/55 px-2 shadow-lg backdrop-blur-[1px]"
          style={{
            top: pendingTarget.top,
            left: pendingTarget.left,
            width: pendingTarget.width,
            height: pendingTarget.height,
            minWidth: 88,
          }}
          role="status"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FFE181]">
            <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
            Opening…
          </span>
        </div>
      )}

      <style jsx global>{`
        @keyframes navFeedbackProgress {
          0% {
            transform: translateX(-100%) scaleX(0.35);
          }
          50% {
            transform: translateX(15%) scaleX(0.55);
          }
          100% {
            transform: translateX(120%) scaleX(0.35);
          }
        }
      `}</style>
    </>
  );
}

export function useNavigationFeedback(): NavigationFeedbackContextValue {
  const ctx = useContext(NavigationFeedbackContext);
  if (!ctx) {
    throw new Error(
      'useNavigationFeedback must be used within NavigationFeedbackProvider'
    );
  }
  return ctx;
}

export function useNavigationFeedbackOptional(): NavigationFeedbackContextValue | null {
  return useContext(NavigationFeedbackContext);
}

type PendingLinkProps = React.ComponentProps<typeof Link> & {
  pendingLabel?: string;
};

/** Link whose label switches to Opening… while that route is pending. */
export function PendingLink({
  href,
  children,
  className,
  pendingLabel = 'Opening…',
  onClick,
  ...rest
}: PendingLinkProps) {
  const { isBusyHref, begin } = useNavigationFeedback();
  const hrefString = typeof href === 'string' ? href : href.pathname || '/';
  const busy = isBusyHref(hrefString);

  return (
    <Link
      href={href}
      className={className}
      aria-busy={busy}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        begin(hrefString, event.currentTarget);
      }}
      {...rest}
    >
      {busy ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </Link>
  );
}
