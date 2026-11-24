'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { DEMO_FEATURE_LOCKED_MESSAGE } from '@/lib/demoPlanLock';

/** Demo dashboard callout — other admin apps stay locked until upgrade. */
export default function DemoPlanLockedBanner() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">Demo plan — apps locked</h2>
      <p className="mt-1 text-sm text-amber-900">
        You can use this company dashboard and Company profile. Public category
        switches and embed origins on Company profile stay locked on Demo.
        Catalog, orders, venues, team, Memberships, AI, and other admin apps
        stay locked too. Demo was activated through free Checkout (no charge, no card).
      </p>
      <p className="mt-2 text-xs text-amber-800/90">{DEMO_FEATURE_LOCKED_MESSAGE}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <AdminPendingLink
          href="/admin/company-profile"
          className="inline-flex rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-950 hover:border-amber-400"
        >
          Company profile
        </AdminPendingLink>
        <AdminPendingLink
          href="/admin/billing"
          className="inline-flex rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Upgrade in Billing
        </AdminPendingLink>
      </div>
    </div>
  );
}
