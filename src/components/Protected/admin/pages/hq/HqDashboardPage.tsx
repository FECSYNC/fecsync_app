'use client';

/**
 * Enterprise HQ multi-venue control plane (Steps 2–4).
 *
 * Tenancy: org-wide settings surface (same Layer-1 pattern as venues /
 * company profile). VenueLocation has no createdById — companyWideView does
 * not further scope HQ rollups. Non-CWV settings:manage staff still see
 * company venues when Enterprise HQ is entitled.
 *
 * Step 3: location scope filters venue items / venues list + park-stamped
 * modules (ticketing; Product/Order when venueLocationId is set). Members
 * roster and plan meters stay company-wide (see Enterprise HQ how-to guide).
 * MembershipVenueAssignment park-locks seats independently of Enterprise.
 *
 * Soft-upsell: Starter/Growth with settings:manage may open this page; APIs
 * stay fail-closed via assertEnterpriseHqEnabled (no rollup leak).
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  getAdminHqOverview,
  getAdminHqLocationContext,
  hqKeys,
  type HqOverviewDto,
  type HqLocationContextDto,
} from '@/services/hq';
import {
  listParkMarketplaceAccounts,
  marketplaceKeys,
} from '@/services/marketplace';
import { usageMeterFor } from '@/services/billing';
import { formatPlanDisplayName } from '@/lib/subscriptionPlans';
import { isStorefrontOrgSession } from '@/services/auth';
import { isPlatformSoftwareOwner } from '@/lib/platformSoftwareOwner';
import { useEnterpriseHqSessionCatchUp } from '@/hooks/useBilling';
import PlatformOpsTenantAppsPanel, {
  useIsPlatformOpsTenantAppsViewer,
} from '@/components/Protected/admin/pages/hq/PlatformOpsTenantAppsPanel';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  ENTERPRISE_HQ_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

function HqUpsellPanel() {
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Enterprise HQ
          </p>
          <h1 className="text-2xl font-semibold text-stone-900">
            Multi-venue control plane
          </h1>
          <p className="max-w-xl text-sm text-stone-600">
            Cross-park rollups and the venue switcher unlock on entitled
            Enterprise. Open the guide to learn scope, meters, and where HQ
            connects to Venues and ticketing.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </header>
      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Enterprise HQ"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={ENTERPRISE_HQ_GUIDE_STEPS}
      />
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
        <p className="font-semibold">Enterprise required</p>
        <p className="mt-1 text-amber-900/90">
          Open Billing to upgrade, or contact sales for Enterprise. This page
          does not show HQ rollup data until your workspace is entitled.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/admin/billing"
            className="inline-flex rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c4a030]"
          >
            Open Billing
          </Link>
          <Link
            href="/admin/venues"
            className="inline-flex rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            Manage venues
          </Link>
        </div>
      </div>
    </div>
  );
}

function MeterChip({
  label,
  meter,
}: {
  label: string;
  meter: { used: number; limit: number | null; unlimited: boolean } | null;
}) {
  if (!meter) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-stone-400">—</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-stone-900">
        {meter.unlimited
          ? `${meter.used}`
          : `${meter.used}/${meter.limit ?? 0}`}
      </p>
      <p className="text-[11px] text-stone-500">
        {meter.unlimited ? 'Unlimited' : 'Plan meter'}
      </p>
    </div>
  );
}

export default function HqDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const enterpriseHqEnabled = user?.enterpriseHqEnabled === true;
  const parkLocked = user?.parkLocked === true;
  // Platform software owner runs HQ on the storefront host (no company seat).
  const isCompany =
    Boolean(user) &&
    (!isStorefrontOrgSession(user) || isPlatformSoftwareOwner(user));
  const isPlatformOpsViewer = useIsPlatformOpsTenantAppsViewer();
  /** One align pass per mismatch signature — avoids invalidate storms. */
  const scopeAlignRef = useRef<string | null>(null);

  useEnterpriseHqSessionCatchUp(isCompany && !parkLocked);

  const contextQuery = useQuery({
    queryKey: hqKeys.locationContext(),
    queryFn: getAdminHqLocationContext,
    enabled: enterpriseHqEnabled && isCompany && !parkLocked,
  });

  const locationId = contextQuery.data?.locationId ?? null;

  const overviewQuery = useQuery({
    // Scope-keyed — matches server actorLocationScope on venues.items.
    queryKey: hqKeys.overview(locationId),
    queryFn: getAdminHqOverview,
    enabled:
      enterpriseHqEnabled &&
      isCompany &&
      !parkLocked &&
      contextQuery.isSuccess,
  });

  /** Honest park payout readiness counts — no Connect account ids. */
  const parkPayoutsQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: enterpriseHqEnabled && isCompany && !parkLocked,
  });

  const overview = overviewQuery.data;
  const usage = overview?.usage;
  // Match HQ venue preference: when a park is selected, show that park's
  // payout readiness only (company-wide meters stay org-wide elsewhere).
  const parkPayoutRowsAll = parkPayoutsQuery.data ?? [];
  const parkPayoutRows = locationId
    ? parkPayoutRowsAll.filter((p) => p.locationId === locationId)
    : parkPayoutRowsAll;
  const parkPayoutReadyCount = parkPayoutRows.filter((p) => p.chargeReady).length;
  const parkPayoutTotal = parkPayoutRows.length;
  const parkPayoutsHref = locationId
    ? `/admin/payouts?locationId=${encodeURIComponent(locationId)}`
    : '/admin/payouts';

  // Trust server items only when overview.locationScope matches header context.
  const overviewMatchesContext =
    overview != null &&
    (overview.locationScope?.locationId ?? null) === locationId;

  // Overview may heal/fall back mid-flight while RQ context is still scoped —
  // align Membership cache or the page spins on "Loading HQ overview…" forever.
  useEffect(() => {
    if (!enterpriseHqEnabled || !isCompany) return;
    if (!overview || overviewMatchesContext) {
      if (overviewMatchesContext) scopeAlignRef.current = null;
      return;
    }
    const serverLoc = overview.locationScope?.locationId ?? null;
    const key = `${locationId ?? 'null'}→${serverLoc ?? 'null'}`;
    if (scopeAlignRef.current === key) return;
    scopeAlignRef.current = key;

    const ctxKey = hqKeys.locationContext();
    const prev = queryClient.getQueryData<HqLocationContextDto>(ctxKey);
    if (prev) {
      queryClient.setQueryData<HqLocationContextDto>(ctxKey, {
        orgId: prev.orgId,
        locationId: serverLoc,
        location:
          serverLoc && prev.location?.id === serverLoc ? prev.location : null,
      });
    }
    // Keep showing this overview under the healed scope key (avoid empty flash).
    queryClient.setQueryData(hqKeys.overview(serverLoc), overview);
    void queryClient.invalidateQueries({ queryKey: ctxKey });
  }, [
    enterpriseHqEnabled,
    isCompany,
    overview,
    overviewMatchesContext,
    locationId,
    queryClient,
  ]);

  const focusedItems = useMemo(() => {
    if (!overviewMatchesContext || !overview) return [];
    return overview.venues.items;
  }, [overview, overviewMatchesContext]);

  if (isPlatformOpsViewer) {
    return <PlatformOpsTenantAppsPanel app="hq" />;
  }

  if (!isCompany) {
    return (
      <div className="px-4 py-10 text-sm text-stone-600">
        Enterprise HQ is for registered company workspaces only.
      </div>
    );
  }

  if (!enterpriseHqEnabled) {
    return <HqUpsellPanel />;
  }

  // Mismatch alone must not spin forever — scope-align effect heals context.
  // Context error: do not keep "Loading HQ overview…" (overview stays disabled).
  // With cached overview/context, paint immediately while soft-refreshing.
  const hasCachedHq = Boolean(overview) || Boolean(contextQuery.data);
  const loading =
    !hasCachedHq &&
    !contextQuery.isError &&
    (contextQuery.isLoading ||
      overviewQuery.isLoading ||
      (Boolean(overview) &&
        !overviewMatchesContext &&
        (contextQuery.isFetching || overviewQuery.isFetching)));
  const scopeReady = contextQuery.isSuccess;
  const error =
    (overviewQuery.error instanceof Error && overviewQuery.error.message) ||
    (contextQuery.error instanceof Error && contextQuery.error.message) ||
    null;

  const venuesMeter = usageMeterFor(usage, 'venues');
  const membersMeter = usageMeterFor(usage, 'members');
  const seatsMeter = usageMeterFor(usage, 'tailorSeats');
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Enterprise HQ
          </p>
          <h1 className="text-2xl font-semibold text-stone-900">
            Multi-venue control plane
          </h1>
          <p className="max-w-2xl text-sm text-stone-600">
            Venue health and company-wide plan meters for{' '}
            {formatPlanDisplayName(overview?.plan ?? user?.subscriptionPlan) ||
              'Enterprise'}
            . Open the guide if you are doing this for the first time.
          </p>
          {scopeReady ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="inline-flex rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                {locationId && contextQuery.data?.location
                  ? `Scope: ${contextQuery.data.location.name}`
                  : 'Scope: All locations'}
              </span>
              <span className="text-xs text-stone-500">
                Change scope from the header switcher.
              </span>
            </div>
          ) : contextQuery.isError ? (
            <p className="text-xs text-amber-800">
              Location scope unavailable — retry or use the header switcher when
              HQ context loads.
            </p>
          ) : (
            <p className="text-xs text-stone-500">Loading location scope…</p>
          )}
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </header>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Enterprise HQ"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={ENTERPRISE_HQ_GUIDE_STEPS}
      />

      {loading ? (
        <p className="text-sm text-stone-500">Loading HQ overview…</p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {overviewMatchesContext && overview ? (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-sm font-semibold text-stone-800">
                Venue health
              </h2>
              <Link
                href="/admin/venues"
                className="text-sm font-medium text-[#D4AF37] underline-offset-2 hover:underline"
              >
                Manage venues
              </Link>
            </div>
            <p className="text-xs text-stone-500">
              {locationId
                ? 'Counts below are company-wide. The list is filtered to the header scope.'
                : 'Company-wide venue counts.'}
            </p>
            <dl className="grid grid-cols-3 gap-3 text-center sm:max-w-md">
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-4">
                <dt className="text-xs uppercase tracking-wide text-stone-500">
                  Active
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-stone-900">
                  {overview.venues.active}
                </dd>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-4">
                <dt className="text-xs uppercase tracking-wide text-stone-500">
                  Archived
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-stone-900">
                  {overview.venues.archived}
                </dd>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-4">
                <dt className="text-xs uppercase tracking-wide text-stone-500">
                  Total
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-stone-900">
                  {overview.venues.total}
                </dd>
              </div>
            </dl>

            {parkPayoutTotal > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {locationId ? 'Park payouts (this park)' : 'Park payouts'}
                </span>
                <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                  {parkPayoutReadyCount} charge-ready
                </span>
                {parkPayoutTotal - parkPayoutReadyCount > 0 ? (
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-950">
                    {parkPayoutTotal - parkPayoutReadyCount} need setup
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                    {locationId
                      ? 'This franchise park ready'
                      : 'All franchise parks ready'}
                  </span>
                )}
                <Link
                  href={parkPayoutsHref}
                  className="ml-auto text-xs font-medium text-[#D4AF37] underline-offset-2 hover:underline"
                >
                  Open payouts
                </Link>
              </div>
            ) : null}

            {focusedItems.length > 0 ? (
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                {focusedItems.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-900">
                        {v.name}
                      </p>
                      <p className="font-mono text-xs text-stone-500">
                        /{v.slug}
                        {v.city ? ` · ${v.city}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${
                        v.status === 'active'
                          ? 'bg-emerald-50 text-emerald-900'
                          : 'bg-stone-100 text-stone-600'
                      }`}
                    >
                      {v.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-stone-200 px-4 py-6 text-sm text-stone-500">
                {locationId
                  ? 'Selected venue is not in the rollup (it may have been archived). Switch to All locations or pick another venue.'
                  : 'No venues yet.'}{' '}
                <Link
                  href="/admin/venues"
                  className="font-medium text-[#D4AF37] underline-offset-2 hover:underline"
                >
                  Open Venues
                </Link>
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-stone-800">
              Plan usage (company-wide)
            </h2>
            <p className="text-xs text-stone-500">
              Meters stay company-wide. Park scope filters the venue list above
              and park-stamped ticketing elsewhere — see the guide.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MeterChip label="Venues" meter={venuesMeter} />
              <MeterChip label="Team seats" meter={membersMeter} />
              <MeterChip label="Tailor seats" meter={seatsMeter} />
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/admin/users"
                className="font-medium text-stone-800 underline-offset-2 hover:underline"
              >
                Team
              </Link>
              <span className="text-stone-300">·</span>
              <Link
                href="/admin/billing"
                className="font-medium text-stone-800 underline-offset-2 hover:underline"
              >
                Billing
              </Link>
            </div>
          </section>

          <FutureModulesSection modules={overview.modules} />
        </>
      ) : null}
    </div>
  );
}

function FutureModulesSection({
  modules,
}: {
  modules: HqOverviewDto['modules'];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-stone-800">Venue modules</h2>
      <p className="text-xs text-stone-500">
        Package entitlement honesty — not fake ticket/POS figures.
      </p>
      <ul className="flex flex-wrap gap-2">
        {modules.map((m) => (
          <li
            key={m.id}
            className={
              m.status === 'enabled'
                ? 'rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800'
                : 'rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-600'
            }
            title={m.note}
          >
            {m.id}: {m.status === 'enabled' ? 'enabled' : 'not enabled'}
          </li>
        ))}
      </ul>
    </section>
  );
}
