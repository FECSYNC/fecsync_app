'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useAuthStore } from '@/store/authStore';
import { P, isPlatformAdminActor } from '@/lib/auth/permissions';
import { ADMIN_DASHBOARD_QUICK_LINKS } from '@/lib/adminNav';
import { useAdminTaxSettingsQuery } from '@/hooks/useTaxSettings';
import { useOrgMembersQuery } from '@/hooks/useMembers';
import { useAdminHomepageSectionsQuery } from '@/hooks/useHomepageContent';
import { useAdminAdBannersQuery } from '@/hooks/useAdBanners';
import { useAdminCompanyProfileQuery } from '@/hooks/useCompanyProfile';
import { useBillingStateQuery, useBillingUsageQuery } from '@/hooks/useBilling';
import { isStorefrontOrgSession } from '@/services/auth';
import { isPlatformSoftwareOwner } from '@/lib/platformSoftwareOwner';
import { isWithinBillingRenewWindow } from '@/lib/billingRenewal';
import {
  formatPlanDisplayName,
  resolveBillingDurationMonthsInterest,
  type BillingDurationMonths,
} from '@/lib/subscriptionPlans';
import { sessionIsDemoPlan } from '@/lib/demoPlanLock';
import BillingDurationSelect from '@/components/billing/BillingDurationSelect';
import { useEffect, useState } from 'react';
import { isAdminPageAllowed } from '@/hooks/useAdminPermission';
import AccountingFinanceSummaryCard from './AccountingFinanceSummaryCard';

export default function StoreOverviewCards({
  hideBillingCards = false,
}: {
  hideBillingCards?: boolean;
} = {}) {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const isDemo = sessionIsDemoPlan(user);
  const canHomepage = can(P.SettingsManage);
  const canPay = canHomepage && isPlatformAdminActor(user);
  const canTax = !isDemo && can(P.TaxManage);
  const canUsers = !isDemo && can(P.UsersRead);
  const isCompanyTenant = !isStorefrontOrgSession(user);
  const isStorefront = isStorefrontOrgSession(user);
  const isSuperAdmin = isPlatformSoftwareOwner(user);
  // Project owner sees company workspace cards + storefront CMS cards.
  const showCompanyWorkspaceCards = isCompanyTenant || isSuperAdmin;
  // Stripe company subscription state is registered tenants only — never DEFAULT_ORG
  // (super admin on FECSYNC must not call /api/admin/billing/state).
  // Park-locked seats never see company billing cards.
  const showCompanyBillingState =
    isCompanyTenant && !hideBillingCards && user?.parkLocked !== true;

  const homepage = useAdminHomepageSectionsQuery(canHomepage && isStorefront);
  const banners = useAdminAdBannersQuery(canHomepage && isStorefront);
  const tax = useAdminTaxSettingsQuery(canTax);
  const members = useOrgMembersQuery(canUsers);
  const companyProfile = useAdminCompanyProfileQuery(
    canHomepage && showCompanyWorkspaceCards
  );
  const billing = useBillingStateQuery(canHomepage && showCompanyBillingState);
  const usage = useBillingUsageQuery(canHomepage && showCompanyWorkspaceCards);
  const billingState = billing.data;
  const [renewDuration, setRenewDuration] = useState<BillingDurationMonths>(12);
  const [renewBusy, setRenewBusy] = useState(false);

  useEffect(() => {
    setRenewDuration(
      resolveBillingDurationMonthsInterest({
        requestedDurationMonths: billingState?.requestedDurationMonths,
        subscriptionInterval: billingState?.subscriptionInterval,
      })
    );
  }, [
    billingState?.requestedDurationMonths,
    billingState?.subscriptionInterval,
  ]);

  if (!canHomepage && !canTax && !canUsers && !can(P.AnalyticsRead)) return null;

  const publishedCount =
    homepage.data?.filter((s) => s.published).length ?? 0;
  const homepageValue = homepage.isError
    ? 'Unavailable'
    : homepage.isLoading
      ? '…'
      : `${publishedCount} published`;

  const activeBanners =
    banners.data?.filter((b) => b.active).length ?? 0;
  const bannersValue = banners.isError
    ? 'Unavailable'
    : banners.isLoading
      ? '…'
      : `${activeBanners} active`;

  const taxValue = tax.isError
    ? 'Unavailable'
    : tax.isLoading
      ? '…'
      : tax.data?.enabled
        ? `${tax.data.rate}% ${tax.data.label?.trim() || 'Tax'}`
        : 'Off';

  const activeMembers =
    members.data?.members.filter(
      (m) => m.status === 'active' || m.status === 'invited'
    ).length ?? 0;
  const membersValue = members.isError
    ? 'Unavailable'
    : members.isLoading
      ? '…'
      : `${activeMembers} live`;

  const profileCompleteness = companyProfile.isError
    ? null
    : companyProfile.isLoading
      ? null
      : (companyProfile.data?.completeness ?? 0);
  const profileValue =
    profileCompleteness == null
      ? companyProfile.isError
        ? 'Unavailable'
        : '…'
      : `${profileCompleteness}%`;

  const profileLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/company-profile'
  )!;
  const venuesLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/venues'
  )!;
  const hqLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/hq'
  )!;
  const billingLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/billing'
  )!;
  const payoutsLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/payouts'
  )!;
  const homepageLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/homepage-content'
  )!;
  const bannersLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/ad-banners'
  )!;
  const taxLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/tax-settings'
  )!;
  const usersLink = ADMIN_DASHBOARD_QUICK_LINKS.store.find(
    (l) => l.href === '/admin/users'
  )!;

  const billingEntitled = billingState?.billingEntitled ?? false;
  const billingValue = billing.isError
    ? 'Unavailable'
    : billing.isLoading
      ? '…'
      : billingState?.pastDue && billingState?.plan
        ? `${formatPlanDisplayName(billingState.plan)} · past due`
        : billingState?.plan
          ? formatPlanDisplayName(billingState.plan)
          : billingEntitled
            ? `${formatPlanDisplayName(billingState?.planResolved ?? 'starter')} floors`
            : 'No package';
  const billingHint =
    billingState?.billingSoftHold ||
    (billingState?.pastDue && !billingEntitled)
    ? billingState?.billingGraceEndsAt
      ? 'Renewal grace — renew before countdown ends or workspace moves to Demo.'
      : 'Billing hold — renew to restore access (Checkout from waiting room).'
    : billingState?.pastDue
    ? canPay
      ? 'Payment past due — update billing soon.'
      : 'Payment past due — ask your company platform admin to update billing.'
    : isWithinBillingRenewWindow(billingState?.daysUntilRenewal)
      ? canPay
        ? `Renews in ${billingState?.daysUntilRenewal} day(s) — open Billing to renew.`
        : `Renews in ${billingState?.daysUntilRenewal} day(s) — ask your platform admin to renew.`
    : billingState?.daysUntilRenewal != null
      ? `Renews in ${billingState.daysUntilRenewal} day(s).`
      : billingState?.plan === 'demo'
        ? canPay
          ? 'Demo trial — limited caps; upgrade to Starter, Growth, or Enterprise in Billing.'
          : 'Demo trial — limited caps; ask your platform admin to upgrade.'
      : billingState?.plan
        ? canPay
          ? 'Manage your package in Billing.'
          : 'View plan details in Billing.'
        : billingEntitled
          ? canPay
            ? 'Entitled with starter floors — choose a named package in Billing when ready.'
            : 'Entitled with starter floors — ask your platform admin to choose a package.'
          : canPay
            ? 'Subscribe in Billing to unlock venues, catalog, team seats, booking packages, and role templates.'
            : 'Waiting on platform admin to subscribe before creates unlock.';

  const showRenewBanner =
    showCompanyWorkspaceCards &&
    !isStorefront &&
    canHomepage &&
    billingEntitled &&
    !billingState?.billingSoftHold &&
    isWithinBillingRenewWindow(billingState?.daysUntilRenewal);

  const billingCardHref =
    billingState?.billingSoftHold ||
    (billingState?.pastDue && !billingEntitled)
      ? '/company-pending'
      : billingLink.href;

  const venueMeter = usage.data?.meters.find((m) => m.resource === 'venues');
  const usageEntitled = usage.data?.billingEntitled ?? billingEntitled;
  const venuesValue = usage.isError
    ? 'Unavailable'
    : usage.isLoading
      ? '…'
      : !usageEntitled
        ? `${venueMeter?.used ?? 0} · locked`
        : venueMeter?.unlimited
          ? `${venueMeter.used} · unlimited`
          : venueMeter
            ? `${venueMeter.used} / ${venueMeter.limit ?? 0}`
            : '0';
  const venuesHint = !usageEntitled
    ? 'Subscribe in Billing before creating parks or sites.'
    : (usage.data?.overLimitResources?.includes('venues')
        ? 'Over venue plan limit — archive a site or upgrade. Creates stay blocked.'
        : 'Active parks and sites under this company (plan-capped).');

  const overLimitHint =
    usageEntitled && (usage.data?.overLimitResources?.length ?? 0) > 0
      ? `Over plan limit on ${(usage.data?.overLimitResources ?? []).join(', ')}. Existing data kept; creates blocked until upgrade or cleanup.`
      : null;

  return (
    <section className="space-y-3">
      {showRenewBanner ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/10 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm text-stone-800">
              <span className="font-semibold text-stone-900">Renew soon — </span>
              {billingState?.daysUntilRenewal === 0
                ? 'your package ends today.'
                : billingState?.daysUntilRenewal === 1
                  ? 'your package ends tomorrow.'
                  : `your package ends in ${billingState?.daysUntilRenewal} days.`}{' '}
              Keep venues and plan tools unlocked.
            </p>
            {!canPay ? (
              <AdminPendingLink
                href="/admin/billing"
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37] px-3.5 text-xs font-semibold text-stone-900 hover:bg-[#c4a030]"
              >
                View billing
              </AdminPendingLink>
            ) : null}
          </div>
          {canPay ? (
            <div className="flex flex-col gap-2 sm:max-w-sm">
              <BillingDurationSelect
                id="dashboard-renew-duration"
                planId={billingState?.plan}
                value={renewDuration}
                onChange={setRenewDuration}
                disabled={renewBusy}
              />
              <button
                type="button"
                disabled={renewBusy}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-[#D4AF37] px-3.5 text-xs font-semibold text-stone-900 hover:bg-[#c4a030] disabled:opacity-50"
                onClick={() => {
                  void (async () => {
                    setRenewBusy(true);
                    try {
                      const res = await fetch("/api/auth/company-billing-renew", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ durationMonths: renewDuration }),
                      });
                      const json = (await res.json().catch(() => ({}))) as {
                        error?: string;
                        message?: string;
                        data?: { url?: string };
                      };
                      if (!res.ok) {
                        window.location.href = "/admin/billing";
                        return;
                      }
                      const url = json.data?.url;
                      if (url?.startsWith("http")) {
                        window.location.href = url;
                        return;
                      }
                      window.location.href = "/admin/billing";
                    } catch {
                      window.location.href = "/admin/billing";
                    } finally {
                      setRenewBusy(false);
                    }
                  })();
                }}
              >
                {renewBusy ? 'Opening…' : 'Renew package'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {overLimitHint ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {overLimitHint}{' '}
          <AdminPendingLink href="/admin/billing" className="font-medium underline">
            Billing
          </AdminPendingLink>
        </p>
      ) : null}
      <h2 className="text-sm font-semibold text-gray-700">
        {isStorefront ? 'Platform store settings' : 'Workspace settings'}
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {canHomepage && showCompanyWorkspaceCards && (
          <AdminPendingLink
            href={profileLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{profileLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{profileValue}</p>
            <p className="mt-1 text-sm text-gray-500">
              {profileCompleteness != null && profileCompleteness < 60
                ? 'Profile incomplete — add logo, legal name, contact, and bank details for invoices.'
                : 'Legal name, logo, and bank details for invoices and emails.'}
            </p>
          </AdminPendingLink>
        )}
        {canHomepage && showCompanyWorkspaceCards && !isDemo && (
          <AdminPendingLink
            href={venuesLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{venuesLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{venuesValue}</p>
            <p className="mt-1 text-sm text-gray-500">
              {venuesHint}
            </p>
          </AdminPendingLink>
        )}
        {canHomepage &&
          showCompanyWorkspaceCards &&
          !isDemo &&
          user?.enterpriseHqEnabled === true && (
          <AdminPendingLink
            href={hqLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{hqLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {venuesValue}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Venue switcher + cross-park rollup; scope filters venues and
              park-stamped modules (ticketing, stamped products/orders).
            </p>
          </AdminPendingLink>
        )}
        {canHomepage &&
          showCompanyWorkspaceCards &&
          !isDemo &&
          user?.enterpriseHqEnabled !== true && (
          <AdminPendingLink
            href="/admin/hq"
            className="rounded-lg border border-amber-200 bg-amber-50/60 p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-amber-950">Enterprise HQ</p>
            <p className="mt-1 text-2xl font-bold text-stone-900">Upgrade</p>
            <p className="mt-1 text-sm text-amber-900/80">
              Cross-park HQ dashboard unlocks on entitled Enterprise. Growth
              already includes a park filter and park-lock seats — open for
              upgrade details (no rollup leak until entitled).
            </p>
          </AdminPendingLink>
        )}
        {canHomepage && showCompanyBillingState && (
          <AdminPendingLink
            href={billingCardHref}
            className={`rounded-lg border bg-white p-6 transition-colors hover:border-[#D4AF37]/40 ${
              billingState?.pastDue
                ? 'border-red-300'
                : 'border-gray-200'
            }`}
          >
            <p className="text-sm font-medium text-gray-600">{billingLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 capitalize">
              {billingValue}
            </p>
            <p
              className={`mt-1 text-sm ${
                billingState?.pastDue ? 'text-red-700' : 'text-gray-500'
              }`}
            >
              {billingHint}
            </p>
          </AdminPendingLink>
        )}
        {(canHomepage || can(P.AnalyticsRead)) &&
          showCompanyWorkspaceCards &&
          !isDemo && (
          <AdminPendingLink
            href={payoutsLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{payoutsLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">Connect</p>
            <p className="mt-1 text-sm text-gray-500">
              Stripe Express for marketplace booking package payouts (not SaaS
              Billing).
            </p>
          </AdminPendingLink>
        )}
        {canHomepage && isStorefront && isPlatformAdminActor(user) && !isSuperAdmin && (
          <AdminPendingLink
            href="/admin/venues"
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">Venues</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">Ops</p>
            <p className="mt-1 text-sm text-gray-500">
              Monitor active parks across company workspaces. Tenant create /
              archive runs inside each company admin.
            </p>
          </AdminPendingLink>
        )}
        {canHomepage && isStorefront && isPlatformAdminActor(user) && !isSuperAdmin && (
          <AdminPendingLink
            href="/admin/hq"
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">Enterprise HQ</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">Ops</p>
            <p className="mt-1 text-sm text-gray-500">
              See which companies have HQ unlocked. Full switcher + rollup runs
              in each entitled Enterprise workspace.
            </p>
          </AdminPendingLink>
        )}
        {canHomepage &&
          isStorefront &&
          isAdminPageAllowed(homepageLink.href, can, user).allowed && (
          <AdminPendingLink
            href={homepageLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{homepageLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{homepageValue}</p>
            <p className="mt-1 text-sm text-gray-500">
              Hero, What We Offer, New Arrivals title, and Fashion Journey —
              edit and publish to the live store.
            </p>
          </AdminPendingLink>
        )}
        {canHomepage &&
          isStorefront &&
          isAdminPageAllowed(bannersLink.href, can, user).allowed && (
          <AdminPendingLink
            href={bannersLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{bannersLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{bannersValue}</p>
            <p className="mt-1 text-sm text-gray-500">
              Trending Fashion sidebar slider — image, heading, and paragraph.
              Add as many banners as you need.
            </p>
          </AdminPendingLink>
        )}
        <AccountingFinanceSummaryCard />
        {canTax && (
          <AdminPendingLink
            href={taxLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{taxLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{taxValue}</p>
            <p className="mt-1 text-sm text-gray-500">
              Workspace tax rate used at Stripe checkout. Catalog items and fabrics can
              override it.
            </p>
          </AdminPendingLink>
        )}
        {canUsers && (
          <AdminPendingLink
            href={usersLink.href}
            className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">{usersLink.title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{membersValue}</p>
            <p className="mt-1 text-sm text-gray-500">
              {isStorefront
                ? 'Storefront staff seats — search or suspend any platform user from Company workspaces.'
                : 'Roles, invites, and permission overrides for your organization.'}
            </p>
          </AdminPendingLink>
        )}
      </div>
    </section>
  );
}
