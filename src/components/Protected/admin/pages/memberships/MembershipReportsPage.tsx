'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import { MEMBERSHIPS_REPORTS_GUIDE_STEPS } from '@/components/Protected/admin/pages/memberships/membershipsGuides';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import {
  getMembershipDunningQueue,
  getMembershipReports,
  membershipP4Keys,
} from '@/services/memberships';
import { listAdminVenueLocations } from '@/services/venueLocations';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function endOfDayIso(day: string): string {
  return new Date(`${day}T23:59:59.999Z`).toISOString();
}

export default function MembershipReportsPage() {
  const can = useAuthStore((s) => s.can);
  const canRead =
    can(P.MembershipsRead) ||
    can(P.MembershipsWrite) ||
    can(P.MembershipsSell) ||
    can(P.MembershipsBilling) ||
    can(P.MembershipsCancel) ||
    can(P.MembershipsRedeem) ||
    can(P.MembershipsAdmin);
  const canDunning =
    can(P.MembershipsBilling) || can(P.MembershipsRead) || can(P.MembershipsAdmin);
  const [guideOpen, setGuideOpen] = useState(false);

  const today = new Date();
  const [fromDay, setFromDay] = useState(isoDay(new Date(today.getTime() - 30 * 86_400_000)));
  const [toDay, setToDay] = useState(isoDay(today));
  const [locationId, setLocationId] = useState('');
  const [hqRollup, setHqRollup] = useState(false);
  const [applied, setApplied] = useState({ fromDay, toDay, locationId, hqRollup });

  const venuesQuery = useQuery({
    queryKey: ['admin', 'venue-locations', 'memberships-reports'],
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: canRead,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const reportQuery = useQuery({
    queryKey: membershipP4Keys.reports(
      applied.fromDay,
      applied.toDay,
      applied.locationId,
      applied.hqRollup
    ),
    queryFn: () =>
      getMembershipReports({
        from: new Date(`${applied.fromDay}T00:00:00.000Z`).toISOString(),
        to: endOfDayIso(applied.toDay),
        locationId: applied.hqRollup ? undefined : applied.locationId || undefined,
        hqRollup: applied.hqRollup,
      }),
    enabled: canRead,
  });

  const dunningQuery = useQuery({
    queryKey: membershipP4Keys.dunningQueue(),
    queryFn: getMembershipDunningQueue,
    enabled: canDunning,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  if (!canRead) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You do not have permission to view Memberships reports.
      </div>
    );
  }

  const report = reportQuery.data;
  const venues = venuesQuery.data ?? [];
  const queue = dunningQuery.data;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Sold, active, churn, past due, and failed payments — counted live from
            membership records for the selected range and park.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </header>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Membership reports"
          subtitle="Live membership KPIs and the dunning work queue."
          steps={MEMBERSHIPS_REPORTS_GUIDE_STEPS}
        />
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3 border border-stone-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ fromDay, toDay, locationId, hqRollup });
        }}
      >
        <label className="block text-sm">
          <span className="text-stone-700">From</span>
          <input
            type="date"
            className={fieldClass}
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-700">To</span>
          <input
            type="date"
            className={fieldClass}
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-700">Park</span>
          <select
            className={fieldClass}
            value={locationId}
            disabled={hqRollup}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All parks in my scope</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {queue?.advanced ? (
          <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={hqRollup}
              onChange={(e) => setHqRollup(e.target.checked)}
            />
            Enterprise HQ rollup (all parks)
          </label>
        ) : null}
        <button type="submit" className={btnPrimaryClass}>
          Apply
        </button>
      </form>

      {reportQuery.isLoading ? (
        <p className="text-sm text-stone-500">Loading report…</p>
      ) : reportQuery.isError ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {reportQuery.error instanceof Error
            ? reportQuery.error.message
            : 'Could not load report'}
        </p>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Sold in range" value={report.soldInRange} />
            <Kpi label="Active members" value={report.activeMembers} hint="Current snapshot" />
            <Kpi label="Cancelled in range" value={report.churnCancelledInRange} />
            <Kpi label="Past due" value={report.pastDueCount} hint="Current snapshot" />
            <Kpi
              label="Failed payments"
              value={report.failedPayments.count}
              hint={`Amount ${report.failedPayments.amountMajor.toFixed(2)}`}
            />
          </div>
          <p className="text-xs text-stone-500">
            Scope:{' '}
            {report.scope === 'hq_rollup'
              ? 'Enterprise HQ rollup'
              : report.scope === 'park'
                ? 'Park'
                : 'Company'}{' '}
            · {new Date(report.range.from).toLocaleDateString()} –{' '}
            {new Date(report.range.to).toLocaleDateString()}
          </p>
          {report.activeByReportingCategory?.length ? (
            <div className="border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-stone-800">
                Active by membership category
              </h2>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {report.activeByReportingCategory.map((row) => (
                  <li
                    key={row.category}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="text-stone-700">{row.category}</span>
                    <span className="font-medium text-stone-900">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {canDunning ? (
        <section className="space-y-3 border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-stone-800">Dunning work queue</h2>
            {queue ? (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  queue.advanced
                    ? 'bg-[#D4AF37]/15 text-stone-900'
                    : 'bg-stone-100 text-stone-700'
                }`}
              >
                {queue.advanced ? 'Advanced dunning (Enterprise)' : 'Standard dunning'}
              </span>
            ) : null}
          </div>
          {queue ? (
            <p className="text-xs text-stone-500">
              Retry schedule (days after first failure): {queue.retryDays.join(', ')}.
              {queue.advanced
                ? ' Finance seats are emailed from the 4th failed retry.'
                : ' Upgrade to Enterprise for the extended retry schedule and finance escalation.'}
            </p>
          ) : null}
          {dunningQuery.isLoading ? (
            <p className="text-sm text-stone-500">Loading queue…</p>
          ) : dunningQuery.isError ? (
            <p className="text-sm text-red-700">
              {dunningQuery.error instanceof Error
                ? dunningQuery.error.message
                : 'Could not load dunning queue'}
            </p>
          ) : !queue || queue.items.length === 0 ? (
            <p className="text-sm text-stone-500">No past-due memberships.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-stone-200 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="py-2 pr-4">Member</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Failures</th>
                    <th className="py-2 pr-4">Next retry</th>
                    <th className="py-2 pr-4">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {queue.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-4">
                        <p className="font-medium text-stone-900">{i.customMembershipId}</p>
                        <p className="text-xs text-stone-500">
                          {i.guestName}
                          {i.guestEmail ? ` · ${i.guestEmail}` : ''}
                        </p>
                      </td>
                      <td className="py-2 pr-4">{i.planName}</td>
                      <td className="py-2 pr-4">{i.dunningFailCount}</td>
                      <td className="py-2 pr-4">
                        {i.dunningNextAt ? new Date(i.dunningNextAt).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {i.cancelAtPeriodEnd
                          ? 'Retries exhausted — cancels at period end'
                          : 'Retrying'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="border border-stone-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}
