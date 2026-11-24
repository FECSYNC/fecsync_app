'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { ADMIN_DASHBOARD_QUICK_LINKS } from '@/lib/adminNav';
import { P, type Permission } from '@/lib/auth/permissions';
import { isAdminPageAllowed } from '@/hooks/useAdminPermission';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { getMembershipDashboardKpis, membershipP4Keys } from '@/services/memberships';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';

type QuickLink = {
  title: string;
  href: string;
  permission: Permission;
  description: string;
};

function dashPerm(href: string): Permission {
  const hit = ADMIN_DASHBOARD_QUICK_LINKS.bookings.find((l) => l.href === href);
  return (hit?.permission ?? P.BookingsRead) as Permission;
}

const BOOKINGS_LINKS: QuickLink[] = [
  {
    title: 'Ticketing',
    href: '/admin/ticketing',
    permission: dashPerm('/admin/ticketing'),
    description:
      'Ticket products (optional Catalog category), sessions, resources, add-ons, passes, and settings.',
  },
  {
    title: 'Companies',
    href: '/admin/booking-accounts',
    permission: dashPerm('/admin/booking-accounts'),
    description: 'B2B booking accounts and contacts for corporate sales.',
  },
  {
    title: 'Bookings',
    href: '/admin/bookings',
    permission: dashPerm('/admin/bookings'),
    description:
      'Staff list with search/filters, CSV/JSON export, calendar, detail, payments, and invoices.',
  },
  {
    title: 'Create booking',
    href: '/admin/bookings/new',
    permission: dashPerm('/admin/bookings/new'),
    description:
      'Staff at-venue sale: Details → Product & session → Guests & add-ons → Options → Review. Payments and staff assign stay on the booking detail.',
  },
  {
    title: 'Parties',
    href: '/admin/parties',
    permission: dashPerm('/admin/parties'),
    description: 'Party bookings, invitations, run sheets, and today’s parties.',
  },
  {
    title: 'Invoices',
    href: '/admin/booking-invoices',
    permission: dashPerm('/admin/booking-invoices'),
    description: 'Booking invoices — create from a booking, then send or cancel here.',
  },
  {
    title: 'Payments',
    href: '/admin/booking-payments',
    permission: dashPerm('/admin/booking-payments'),
    description: 'Venue booking payment history (not shop orders).',
  },
  {
    title: 'Booking packages',
    href: '/admin/booking-packages',
    permission: dashPerm('/admin/booking-packages'),
    description:
      'Marketplace booking packages — publish catalog, guest Connect checkout, and refunds.',
  },
  {
    title: 'Memberships',
    href: '/admin/memberships/members',
    permission: dashPerm('/admin/memberships/members'),
    description:
      'Guest park memberships — sell, CRM, lifecycle billing, agreements, cancel (Growth+).',
  },
  {
    title: 'Membership reports',
    href: '/admin/memberships/reports',
    permission: dashPerm('/admin/memberships/reports'),
    description:
      'Sold / active / churn / past-due KPIs and dunning queue from live membership data.',
  },
  {
    title: 'Membership redeem',
    href: '/admin/memberships/redeem',
    permission: dashPerm('/admin/memberships/redeem'),
    description:
      'Verify benefits and redeem visits (CURRENT / VISITING / INELIGIBLE).',
  },
  {
    title: 'Waivers',
    href: '/admin/waivers',
    permission: dashPerm('/admin/waivers'),
    description:
      'Search, verify, void, import, and export signed waivers. A booking confirmation can include a signing link when a ticket requires one. Guests also sign from a QR, on-site, or kiosk. Check-in blocking is not live yet.',
  },
];

function MembershipKpiStrip() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const allowed = isAdminPageAllowed(
    '/admin/memberships/reports',
    can,
    user
  ).allowed;

  const query = useQuery({
    queryKey: membershipP4Keys.dashboardKpis(),
    queryFn: getMembershipDashboardKpis,
    enabled: allowed,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  if (!allowed) return null;

  const sold = query.data?.soldLast30d;
  const active = query.data?.activeMembers;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
      <AdminPendingLink
        href="/admin/memberships/reports"
        cornerSpinner
        className="rounded-lg border border-gray-200 bg-white p-4 hover:border-[#D4AF37]/40"
      >
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Memberships sold (30d)
        </p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">
          {query.isLoading ? '…' : query.isError ? '—' : sold ?? 0}
        </p>
      </AdminPendingLink>
      <AdminPendingLink
        href="/admin/memberships/reports"
        cornerSpinner
        className="rounded-lg border border-gray-200 bg-white p-4 hover:border-[#D4AF37]/40"
      >
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Active members
        </p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">
          {query.isLoading ? '…' : query.isError ? '—' : active ?? 0}
        </p>
      </AdminPendingLink>
    </div>
  );
}

export default function BookingsOverviewCards() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);

  const visible = BOOKINGS_LINKS.filter((link) =>
    isAdminPageAllowed(link.href, can, user).allowed
  );

  if (visible.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Online Booking</h2>
      <MembershipKpiStrip />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((link) => (
          <AdminPendingLink
            key={link.href}
            href={link.href}
            cornerSpinner
            className="block w-full rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-900">{link.title}</p>
            <p className="mt-1 text-sm text-gray-500">{link.description}</p>
          </AdminPendingLink>
        ))}
      </div>
    </section>
  );
}
