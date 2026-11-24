'use client';

/**
 * Legacy ops guide panel for Venues / HQ / Online Booking.
 * Platform software owner now uses live park apps on the storefront host —
 * {@link useIsPlatformOpsTenantAppsViewer} is always false so this panel is unused.
 * Kept for reference / future non-owner storefront tips.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';
import { adminListQueryDefaults } from '@/lib/adminListCache';

type CompanyMetrics = {
  pendingCount: number;
  activeCompanyCount: number;
  suspendedCount: number;
  subscribedCount: number;
  expiringWithin7Days: number;
  offboardRequestedCount: number;
};

type CompanyRow = {
  id: string;
  name: string;
  status: string;
  subscriptionPlan?: string | null;
  venuesActive?: number;
  enterpriseHqEligible?: boolean;
};

async function fetchMetrics(): Promise<CompanyMetrics> {
  const raw = await api<MaybeWrapped<{ metrics: CompanyMetrics }>>(
    '/api/admin/registered-companies/metrics'
  );
  return unwrap(raw).metrics;
}

async function fetchCompanies(): Promise<CompanyRow[]> {
  const raw = await api<MaybeWrapped<{ companies: CompanyRow[] }>>(
    '/api/admin/registered-companies?status=active'
  );
  return unwrap(raw).companies ?? [];
}

export type PlatformOpsTenantApp = 'venues' | 'hq' | 'online-booking';

export function useIsPlatformOpsTenantAppsViewer(): boolean {
  // Platform software owner uses live Venues / HQ / Online Booking on the
  // storefront host org — do not hijack those routes into the ops guide.
  return false;
}

/** Paths where storefront Admin sees the ops guide instead of tenant CRUD. */
export function isPlatformOpsOnlineBookingPath(pathname: string): boolean {
  const p =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  return (
    p === '/admin/ticketing' ||
    p.startsWith('/admin/ticketing/') ||
    p === '/admin/bookings' ||
    p.startsWith('/admin/bookings/') ||
    p === '/admin/parties' ||
    p.startsWith('/admin/parties/') ||
    p === '/admin/booking-accounts' ||
    p.startsWith('/admin/booking-accounts/') ||
    p === '/admin/booking-invoices' ||
    p.startsWith('/admin/booking-invoices/') ||
    p === '/admin/booking-payments' ||
    p.startsWith('/admin/booking-payments/')
  );
}

export default function PlatformOpsTenantAppsPanel({
  app,
}: {
  app: PlatformOpsTenantApp;
}) {
  const enabled = useIsPlatformOpsTenantAppsViewer();
  const metricsQuery = useQuery({
    queryKey: ['registered-companies-metrics', 'ops-tenant-apps'],
    queryFn: fetchMetrics,
    enabled,
    ...adminListQueryDefaults,
  });
  const companiesQuery = useQuery({
    queryKey: ['registered-companies', 'active', 'ops-tenant-apps'],
    queryFn: fetchCompanies,
    enabled,
    ...adminListQueryDefaults,
    placeholderData: (previous) => previous,
  });

  if (!enabled) return null;

  const copy =
    app === 'hq'
      ? {
          title: 'Enterprise HQ',
          blurb:
            'Cross-park HQ dashboard and venue switcher run inside each entitled Enterprise company workspace — not on the platform storefront host. Entitle a company with Approve / Set plan, then open that company admin to use HQ.',
        }
      : app === 'online-booking'
        ? {
            title: 'Online Booking',
            blurb:
              'Ticketing products, bookings, parties, B2B companies, invoices, and payments run inside each registered company workspace (Starter / Growth / Enterprise — Demo stays locked until upgrade). The storefront Admin seat does not host park bookings here — approve or set a company plan, then sign in to that company’s Admin to use Online Booking.',
          }
        : {
            title: 'Venues',
            blurb:
              'Multi-park Venues (create, edit, archive, restore) run inside each registered company workspace within their plan caps. The platform storefront does not host tenant parks here — use Company workspaces to entitle and monitor active venue counts.',
          };

  const rows = companiesQuery.data ?? [];
  const withVenues = rows.filter((c) => (c.venuesActive ?? 0) > 0);
  const hqReady = rows.filter((c) => c.enterpriseHqEligible === true);
  const bookingReady = rows.filter((c) => {
    const plan = (c.subscriptionPlan || '').toLowerCase();
    return plan === 'starter' || plan === 'growth' || plan === 'enterprise';
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
          Platform ops
        </p>
        <h1 className="text-2xl font-semibold text-stone-900">{copy.title}</h1>
        <p className="max-w-2xl text-sm text-stone-600">{copy.blurb}</p>
        <p className="text-sm text-stone-600">
          <Link
            href="/admin/registered-companies"
            className="font-medium text-[#D4AF37] underline-offset-2 hover:underline"
          >
            Open Company workspaces
          </Link>{' '}
          to Approve, Set plan, or check HQ badges and venue counts.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Active companies
          </p>
          <p className="mt-1 text-2xl font-semibold text-stone-900">
            {metricsQuery.isError
              ? '—'
              : metricsQuery.isLoading && !metricsQuery.data
                ? '…'
                : (metricsQuery.data?.activeCompanyCount ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            {app === 'online-booking'
              ? 'Booking plans (paid)'
              : 'Companies with venues'}
          </p>
          <p className="mt-1 text-2xl font-semibold text-stone-900">
            {companiesQuery.isError
              ? '—'
              : companiesQuery.isLoading && rows.length === 0
                ? '…'
                : app === 'online-booking'
                  ? bookingReady.length
                  : withVenues.length}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            {app === 'online-booking' ? 'With venues' : 'HQ console available'}
          </p>
          <p className="mt-1 text-2xl font-semibold text-stone-900">
            {companiesQuery.isError
              ? '—'
              : companiesQuery.isLoading && rows.length === 0
                ? '…'
                : app === 'online-booking'
                  ? withVenues.length
                  : hqReady.length}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-stone-800">
          {app === 'online-booking'
            ? 'Active companies (Online Booking)'
            : 'Active companies (venues / HQ)'}
        </h2>
        {companiesQuery.isError ? (
          <p className="text-sm text-red-700">Could not load company list.</p>
        ) : companiesQuery.isLoading && rows.length === 0 ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-stone-500">No active company workspaces yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
            {rows.slice(0, 25).map((c) => {
              const plan = (c.subscriptionPlan || '—').toString();
              const planLc = plan.toLowerCase();
              const bookingUnlocked =
                planLc === 'starter' ||
                planLc === 'growth' ||
                planLc === 'enterprise';
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-stone-900">{c.name}</p>
                    <p className="text-xs text-stone-500">
                      {plan} · {c.venuesActive ?? 0} active venue
                      {(c.venuesActive ?? 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      app === 'online-booking'
                        ? bookingUnlocked
                          ? 'bg-[#D4AF37]/15 text-stone-800'
                          : 'bg-amber-100 text-amber-900'
                        : c.enterpriseHqEligible
                          ? 'bg-[#D4AF37]/15 text-stone-800'
                          : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {app === 'online-booking'
                      ? bookingUnlocked
                        ? 'Booking unlocked'
                        : 'Upgrade plan'
                      : c.enterpriseHqEligible
                        ? 'HQ available'
                        : 'HQ locked'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 25 ? (
          <p className="text-xs text-stone-500">
            Showing 25 of {rows.length}.{' '}
            <Link
              href="/admin/registered-companies?status=active"
              className="font-medium underline-offset-2 hover:underline"
            >
              View all
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
