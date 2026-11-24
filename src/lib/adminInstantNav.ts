'use client';

import {
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import {
  ADMIN_INSTANT_HREFS,
  getAdminInstantMeta,
} from '@/lib/adminInstantRegistry';

type InstantState = {
  href: string | null;
  /** Resolved page component; null while the chunk is still loading. */
  Comp: ComponentType | null;
};

type Loader = () => Promise<{ default: ComponentType }>;

/**
 * Legacy create-booking chunk overlay (unused by sidebar Links now).
 * Kept so HMR / old callers do not crash.
 */
const OVERLAY_LOADERS: Record<string, Loader> = {
  '/admin/bookings/new': () =>
    import(
      '@/components/Protected/admin/pages/bookings/CreateBookingQuickEntry'
    ),
};

let state: InstantState = { href: null, Comp: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getSnapshot(): InstantState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_INSTANT_SNAPSHOT: InstantState = { href: null, Comp: null };

/** Soft-nav Opening… until pathname catches up (overlay on top — never unmount). */
type TransitionState = {
  href: string | null;
  startedAt: number;
};

let transition: TransitionState = { href: null, startedAt: 0 };
const transitionListeners = new Set<() => void>();
let transitionSafetyTimer: ReturnType<typeof setTimeout> | null = null;

const TRANSITION_MAX_MS = 90_000;

/** Soft-nav intent for Marketing — AdminLayout paints shell without waiting on RSC. */
let marketingNavIntent: string | null = null;
const marketingIntentListeners = new Set<() => void>();

function emitMarketingIntent() {
  for (const l of marketingIntentListeners) l();
}

export function setMarketingNavIntent(href: string | null): void {
  const next = href ? adminNavPathOnly(href) : null;
  if (marketingNavIntent === next) return;
  marketingNavIntent = next;
  emitMarketingIntent();
}

export function getMarketingNavIntent(): string | null {
  return marketingNavIntent;
}

export function useMarketingNavIntent(): string | null {
  return useSyncExternalStore(
    (listener) => {
      marketingIntentListeners.add(listener);
      return () => marketingIntentListeners.delete(listener);
    },
    getMarketingNavIntent,
    () => null
  );
}

function emitTransition() {
  for (const l of transitionListeners) l();
}

function getTransitionSnapshot(): TransitionState {
  return transition;
}

function subscribeTransition(listener: () => void) {
  transitionListeners.add(listener);
  return () => transitionListeners.delete(listener);
}

function clearTransitionTimers() {
  if (transitionSafetyTimer) {
    clearTimeout(transitionSafetyTimer);
    transitionSafetyTimer = null;
  }
}

const SERVER_TRANSITION_SNAPSHOT: TransitionState = {
  href: null,
  startedAt: 0,
};

/** Path without query/hash — Opening chrome + clear must ignore ?create=1 etc. */
export function adminNavPathOnly(href: string): string {
  if (!href) return href;
  const q = href.indexOf('?');
  const h = href.indexOf('#');
  let end = href.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return href.slice(0, end) || href;
}

/** True when this href paints an optimistic overlay (Create booking only). */
export function isAdminInstantHref(href: string): boolean {
  return Object.prototype.hasOwnProperty.call(OVERLAY_LOADERS, href);
}

/** Prefetch a page chunk on hover (does not show an overlay). */
export function warmAdminInstantPage(href: string): void {
  if (href === '/admin/bookings/new') {
    void OVERLAY_LOADERS[href]?.()
      .then(() =>
        import(
          '@/components/Protected/admin/pages/bookings/NewBookingWizardPage'
        )
      )
      .catch(() => {});
    return;
  }
  const meta = getAdminInstantMeta(href);
  if (!meta) return;
  void meta.load().catch(() => {});
}

/** @deprecated Prefer warming a single hovered leaf — avoid group stampede. */
export function warmAdminInstantPages(hrefs: string[]): void {
  for (const href of hrefs) {
    warmAdminInstantPage(href);
  }
}

/**
 * Optimistic overlay — Create booking only (legacy).
 */
export function beginAdminInstantNav(href: string): boolean {
  const load = OVERLAY_LOADERS[href];
  if (!load) return false;

  clearAdminRouteTransition(undefined, { immediate: true });

  state = { href, Comp: state.href === href ? state.Comp : null };
  emit();

  void load()
    .then((mod) => {
      if (state.href !== href) return;
      state = { href, Comp: mod.default };
      emit();
      void import(
        '@/components/Protected/admin/pages/bookings/NewBookingWizardPage'
      ).catch(() => {});
    })
    .catch(() => {
      /* Real route navigation will still proceed. */
    });

  return true;
}

export function clearAdminInstantNav(matchedHref?: string): void {
  if (matchedHref && state.href && state.href !== matchedHref) return;
  if (!state.href) return;
  state = { href: null, Comp: null };
  emit();
}

/** Sync read for click handlers (avoid stale “already on this page” skips). */
export function getAdminInstantHref(): string | null {
  return state.href;
}

export function getAdminInstantTitle(href: string | null): string {
  if (!href) return 'page';
  if (href === '/admin/bookings/new') return 'Create booking';
  const meta = getAdminInstantMeta(href);
  if (meta?.title) return meta.title;
  // Fallback label from path so Opening… is never a vague "page".
  const leaf = href.replace(/^\/admin\/?/, '').split('/').filter(Boolean).pop();
  if (!leaf) return 'dashboard';
  return leaf.replace(/-/g, ' ');
}

export function useAdminInstantNav(): InstantState {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_INSTANT_SNAPSHOT
  );
}

/**
 * Show main-pane Opening spinner for sidebar soft-nav.
 * Clears only when the destination pathname arrives — never on a short timer
 * (that revealed the previous page while the new leaf was still compiling).
 */
export function beginAdminRouteTransition(href: string): void {
  if (!href) return;
  const dest = adminNavPathOnly(href);
  clearTransitionTimers();
  transition = { href: dest, startedAt: Date.now() };
  emitTransition();
  if (dest === '/admin/marketing' || dest.startsWith('/admin/marketing/')) {
    setMarketingNavIntent(dest);
  }
  // Fail-open only after a long wait (dev compile can exceed 60s).
  // Hard-navigate without clearing Opening first — clearing revealed the
  // previous leaf (dashboard) while the assign was still in flight.
  transitionSafetyTimer = setTimeout(() => {
    if (transition.href !== dest) return;
    clearTransitionTimers();
    if (typeof window !== 'undefined') {
      window.location.assign(dest);
    }
  }, TRANSITION_MAX_MS);
}

/** Clear once the real route is mounted. */
export function clearAdminRouteTransition(
  matchedHref?: string,
  opts?: { immediate?: boolean }
): void {
  if (!transition.href) return;
  if (
    matchedHref &&
    adminNavPathOnly(transition.href) !== adminNavPathOnly(matchedHref)
  ) {
    return;
  }
  void opts;
  clearTransitionTimers();
  const wasMarketing =
    transition.href === '/admin/marketing' ||
    transition.href.startsWith('/admin/marketing/');
  transition = { href: null, startedAt: 0 };
  emitTransition();
  // Keep marketing intent until pathname catches up so the shell can keep
  // painting the storefront notice (clearing Opening alone used to flash dashboard).
  if (!wasMarketing) {
    setMarketingNavIntent(null);
  }
}

export function getAdminRouteTransitionHref(): string | null {
  return transition.href;
}

export function useAdminRouteTransition(): TransitionState {
  return useSyncExternalStore(
    subscribeTransition,
    getTransitionSnapshot,
    () => SERVER_TRANSITION_SNAPSHOT
  );
}

/**
 * Shared admin navigate — address bar updates immediately, Opening chrome
 * covers the previous leaf until App Router settles on the destination.
 */
/** Marketing leaf URLs → single desk + ?tab= (modal panels, no extra RSC). */
function rewriteMarketingDeskHref(href: string): string {
  const path = adminNavPathOnly(href);
  const map: Record<string, string> = {
    '/admin/marketing/newsletter': '/admin/marketing?tab=newsletter',
    '/admin/marketing/campaigns': '/admin/marketing?tab=campaigns',
    '/admin/marketing/automations': '/admin/marketing?tab=automations',
    '/admin/marketing/surveys': '/admin/marketing?tab=surveys',
    '/admin/marketing/settings': '/admin/marketing?tab=settings',
  };
  return map[path] ?? href;
}

export function navigateAdminRoute(
  router: {
    push: (href: string) => void;
    replace: (href: string) => void;
  },
  href: string
): void {
  if (!href) return;
  href = rewriteMarketingDeskHref(href);
  const dest = adminNavPathOnly(href);

  // Create booking: paint QuickEntry overlay while the route settles.
  // Other leaves use Opening chrome only (no overlay).
  if (dest === '/admin/bookings/new') {
    beginAdminInstantNav(dest);
  } else {
    clearAdminInstantNav();
  }

  if (typeof window === 'undefined') {
    beginAdminRouteTransition(dest);
    router.push(href);
    return;
  }

  const here = window.location.pathname;
  const pending = getAdminRouteTransitionHref();
  const hereFull = `${window.location.pathname}${window.location.search}`;
  const targetFull = href.split('#')[0] || href;
  const targetHash = href.includes('#') ? href.slice(href.indexOf('#')) : '';

  // Same leaf already settled — only apply search/hash changes (e.g. ?create=1).
  // Do not start Opening or hard-reload; that left the browser tab spinning.
  if (here === dest && !pending) {
    if (hereFull === targetFull && window.location.hash === targetHash) return;
    router.replace(href);
    // Hash-only jumps (e.g. Forms → #requirements) need an explicit scroll;
    // App Router may not re-fire hashchange when pushState already set it.
    if (targetHash && typeof document !== 'undefined') {
      const id = targetHash.slice(1);
      window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    }
    return;
  }

  beginAdminRouteTransition(dest);

  // Drive App Router to that URL without stacking a second history entry.
  // Soft router.push alone can leave the tab URL on the previous leaf until
  // the RSC flight finishes (10–60s under compile). Commit the destination to
  // history now so the address bar + sidebar active state match the click.
  if (here !== dest) {
    try {
      const state =
        window.history.state && typeof window.history.state === 'object'
          ? { ...window.history.state, __fecAdminNav: dest }
          : { __fecAdminNav: dest };
      window.history.pushState(state, '', href);
    } catch {
      /* ignore quota / SecurityError — replace still runs */
    }
  }

  // Drive App Router to that URL without stacking a second history entry.
  router.replace(href);

}

/** Href list still used for idle warm of common destinations. */
export { ADMIN_INSTANT_HREFS };
