'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import { listAdminVenueLocations, venueLocationKeys } from '@/services/venueLocations';
import HqScopePolicyBanner from '@/components/Protected/admin/pages/hq/HqScopePolicyBanner';
import OnlineBookingStorefrontBanner from '@/components/Protected/admin/pages/bookings/OnlineBookingStorefrontBanner';
import { PARTIES_DESK_TABS, useInPartiesDesk, usePartiesDesk } from './partiesDesk';

export {
  fieldClass,
  btnPrimaryClass,
  btnSecondaryClass,
  btnDangerClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';

function isModifiedClick(e: React.MouseEvent) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/**
 * Parties tabs. Inside the /admin/parties layout they open the sub-page as an
 * in-place desk modal (instant, no route load); modified clicks still open the real route.
 */
export function PartiesSubnav() {
  const pathname = usePathname() ?? '';
  const desk = usePartiesDesk();
  const inDesk = useInPartiesDesk();
  if (inDesk) return null;
  return (
    <nav className="flex flex-wrap gap-2 border-b border-stone-200 pb-3 text-sm">
      {PARTIES_DESK_TABS.map((t) => {
        const onRoute =
          t.href === '/admin/parties'
            ? pathname === '/admin/parties'
            : pathname === t.href || pathname.startsWith(`${t.href}/`);
        const active = desk?.panel ? desk.panel === t.panel : onRoute;
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            onMouseEnter={() => (t.panel ? desk?.warmPanel(t.panel) : undefined)}
            onFocus={() => (t.panel ? desk?.warmPanel(t.panel) : undefined)}
            onClick={(e) => {
              if (!desk || isModifiedClick(e)) return;
              if (t.panel && !onRoute) {
                e.preventDefault();
                desk.openPanel(t.panel);
                return;
              }
              if (onRoute) {
                e.preventDefault();
                if (desk.panel) desk.closePanel();
              }
            }}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              active
                ? 'bg-[#D4AF37]/15 text-stone-900 ring-1 ring-[#D4AF37]/50'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PartiesPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <OnlineBookingStorefrontBanner />
      <PartiesSubnav />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
          {description ? <div className="mt-1 max-w-2xl text-sm text-stone-600">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function PartyScopeBanner({
  locationScoped,
  locationName,
}: {
  locationScoped: boolean;
  locationName?: string | null;
}) {
  if (!locationScoped) return null;
  return <HqScopePolicyBanner locationScoped locationName={locationName} />;
}

/** Module / plan / Demo errors come back as 403 messages — show them as a soft gate. */
export function PartiesErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Could not load parties data';
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">Parties are not available right now</p>
      <p className="mt-1 text-amber-900/90">{message}</p>
      {/subscription|package|Billing|plan/i.test(message) ? (
        <Link href="/admin/billing" className="mt-2 inline-block font-semibold text-[#D4AF37] hover:underline">
          Open Billing
        </Link>
      ) : null}
    </div>
  );
}

export function useActiveVenues(scopedLocationId?: string | null) {
  const query = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    staleTime: ADMIN_LIST_STALE_MS,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  const venues = (query.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });
  return { venues, query };
}

export function usePartyCatalogPermissions() {
  const can = useAuthStore((s) => s.can);
  return {
    canPackages: can(P.TicketingProductsWrite) || can(P.TicketingWrite) || can(P.PartiesManage),
    canSessions: can(P.TicketingSessionsWrite) || can(P.TicketingWrite) || can(P.PartiesManage),
    canRooms: can(P.TicketingResourcesWrite) || can(P.TicketingWrite) || can(P.PartiesManage),
    canMenu: can(P.PartiesManage),
    canSettings: can(P.PartiesManage),
  };
}

export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

export function inputToCents(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function formatCents(cents: number | null | undefined, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-700">{message}</p>;
}
