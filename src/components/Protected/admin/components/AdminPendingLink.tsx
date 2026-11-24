'use client';

import Link from 'next/link';
import {
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { hydrateAllAdminListSnapshots } from '@/lib/adminListSnapshot';
import {
  navigateAdminRoute,
  useAdminRouteTransition,
  warmAdminInstantPage,
} from '@/lib/adminInstantNav';

/** Leaves that warm list APIs on hover even under yarn-dev (ops hot paths). */
const DEV_HOVER_PREFETCH_DATA = new Set([
  '/admin/registered-companies',
  '/admin/venues',
  '/admin/memberships/plans',
  '/admin/memberships/categories',
  '/admin/ticketing/categories',
  '/admin/memberships/members',
  '/admin/memberships/redeem',
  '/admin/memberships/eligibility',
  '/admin/memberships/settings',
  '/admin/memberships/reports',
  '/admin/waivers',
  '/admin/waivers/verify',
  '/admin/waivers/new',
  '/admin/waivers/templates',
  '/admin/waivers/forms',
  '/admin/waivers/forms/responses',
  '/admin/waivers/import',
  '/admin/waivers/signage',
  '/admin/waivers/kiosk',
  '/admin/waivers/settings',
  '/admin/waivers/compliance',
  '/admin/marketing',
  '/admin/marketing/newsletter',
  '/admin/marketing/automations',
  '/admin/marketing/surveys',
  '/admin/marketing/settings',
  '/admin/parties',
  '/admin/parties/balances',
]);

/**
 * Only these may prefetch again on click. Memberships must NOT — click-time
 * API/chunk warm stampedes Turbopack and cancels soft-nav (Opening clears →
 * previous page flashes back).
 */
const CLICK_PREFETCH_DATA = new Set(['/admin/registered-companies']);

function pathOnly(href: string) {
  const q = href.indexOf('?');
  const h = href.indexOf('#');
  let end = href.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return href.slice(0, end) || href;
}

function isModifiedNavigationClick(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

type AdminPendingLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
  onNavigate?: () => void;
  title?: string;
  /** Show a corner spinner while this href is the pending soft-nav target. */
  cornerSpinner?: boolean;
  /** @deprecated Kept for call-site compatibility; ignored. */
  pendingLabel?: string;
};

/**
 * One menu / card / CTA → one destination. Latest click wins via navigateAdminRoute.
 */
export default function AdminPendingLink({
  href,
  children,
  className = '',
  trailing,
  onNavigate,
  title,
  cornerSpinner = true,
}: AdminPendingLinkProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const prefetchedRef = useRef<string | null>(null);
  const routeTransition = useAdminRouteTransition();

  const destPath = pathOnly(href);
  const isPending =
    Boolean(routeTransition.href) && routeTransition.href === destPath;

  const prefetch = () => {
    if (prefetchedRef.current === destPath) return;
    prefetchedRef.current = destPath;

    // Local snapshot hydrate is sync/cheap — paints last-visit lists instantly.
    if (user?.orgId) {
      hydrateAllAdminListSnapshots(queryClient, user.orgId);
    }
    try {
      router.prefetch(href);
    } catch {
      /* optional */
    }
    warmAdminInstantPage(destPath);

    // yarn dev: skip most hover API warm (compile stampede). Keep data warm for
    // ops-critical leaves so records paint as soon as Opening clears.
    if (
      process.env.NODE_ENV === 'development' &&
      !DEV_HOVER_PREFETCH_DATA.has(destPath)
    ) {
      return;
    }
    void import('@/lib/prefetchAdminRoute').then((mod) => {
      mod.prefetchAdminRoute(queryClient, destPath, can, user);
    });
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Never activate a parent <label>/button (e.g. membership Waiver row).
    event.stopPropagation();
    if (isModifiedNavigationClick(event)) {
      onNavigate?.();
      return;
    }
    if (event.defaultPrevented) {
      onNavigate?.();
      return;
    }

    event.preventDefault();
    // Click-time data warm only for leaves that need it. Memberships soft-nav
    // owns the compile lane alone — prefetch-on-click cancelled the RSC flight.
    if (CLICK_PREFETCH_DATA.has(destPath)) {
      prefetchedRef.current = null;
      prefetch();
    }
    navigateAdminRoute(router, href);
    onNavigate?.();
  };

  return (
    <Link
      href={href}
      title={title}
      prefetch={false}
      aria-busy={isPending || undefined}
      onClick={handleClick}
      onPointerDown={prefetch}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className={`relative cursor-pointer text-left ${className}`}
    >
      {children}
      {trailing || (cornerSpinner && isPending) ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {trailing}
          {cornerSpinner && isPending ? (
            <span
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-[#D4AF37]"
              aria-hidden
            />
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}
