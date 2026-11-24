'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P, isPlatformAdminActor } from '@/lib/auth/permissions';
import { isStorefrontOrgSession } from '@/services/auth';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';

type CompanyMetrics = {
  pendingCount: number;
  activeCompanyCount: number;
  suspendedCount: number;
  subscribedCount: number;
  expiringWithin7Days: number;
  offboardRequestedCount: number;
};

async function fetchCompanyMetrics(): Promise<CompanyMetrics> {
  const raw = await api<MaybeWrapped<{ metrics: CompanyMetrics }>>(
    '/api/admin/registered-companies/metrics'
  );
  const data = unwrap(raw);
  return data.metrics;
}

export default function CompaniesOverviewCards() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  // Match GET /api/admin/registered-companies/metrics (assertStorefrontPlatformAdmin).
  const enabled =
    can(P.UsersManageRoles) &&
    isStorefrontOrgSession(user) &&
    isPlatformAdminActor(user);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['registered-companies-metrics', user?.orgId ?? 'none'],
    queryFn: fetchCompanyMetrics,
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;

  const cards = [
    {
      title: 'Pending workspaces',
      value: data?.pendingCount,
      hint: 'Awaiting FECSYNC approval',
      href: '/admin/registered-companies?status=pending',
    },
    {
      title: 'Active workspaces',
      value: data?.activeCompanyCount,
      hint: 'Unlocked for /admin',
      href: '/admin/registered-companies?status=active',
    },
    {
      title: 'Suspended',
      value: data?.suspendedCount,
      hint: 'ops_hold, soft-hold, or billing expiry',
      href: '/admin/registered-companies?status=suspended',
    },
    {
      title: 'Subscribed',
      value: data?.subscribedCount,
      hint: 'Live paid period (active/trialing/past_due with endsAt)',
      href: '/admin/registered-companies?status=active',
    },
    {
      title: 'Expiring in 7 days',
      value: data?.expiringWithin7Days,
      hint: 'subscriptionEndsAt window',
      href: '/admin/registered-companies?status=active',
    },
    {
      title: 'Offboard requested',
      value: data?.offboardRequestedCount,
      hint: 'Soft offboard — no hard-delete',
      href: '/admin/registered-companies?status=offboard',
    },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700">
          Company workspaces
        </h2>
        <AdminPendingLink
          href="/admin/registered-companies"
          className="text-xs font-medium text-[#B8941F] hover:underline"
        >
          Manage all companies
        </AdminPendingLink>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <AdminPendingLink
            key={card.title}
            href={card.href}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-[#D4AF37]/60 transition-colors"
          >
            <p className="text-sm font-medium text-gray-600">{card.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {isError
                ? '—'
                : isLoading
                  ? '…'
                  : (card.value ?? 0)}
            </p>
            <p className="mt-1 text-xs text-gray-500">{card.hint}</p>
          </AdminPendingLink>
        ))}
      </div>
    </section>
  );
}
