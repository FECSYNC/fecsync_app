'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useAuthStore } from '@/store/authStore';
import { P, isPlatformAdminActor } from '@/lib/auth/permissions';
import { isStorefrontOrgSession } from '@/services/auth';
import { useAdminCompanyProfileQuery } from '@/hooks/useCompanyProfile';
import { useBillingStateQuery, useBillingUsageQuery } from '@/hooks/useBilling';
import { isWithinBillingRenewWindow } from '@/lib/billingRenewal';
import { formatPlanDisplayName } from '@/lib/subscriptionPlans';

const RESOURCE_LABELS: Record<string, string> = {
  venues: 'Venues',
  members: 'Team members',
  roleTemplates: 'Role templates',
  products: 'Menu items',
  fabrics: 'Catalog fabrics',
  categories: 'Menu categories',
  tailorSeats: 'Tailor seats',
  campaigns: 'Campaigns',
  tailorClients: 'Tailor clients',
  ticketsPerMonth: 'Tickets / month',
  bookingPackages: 'Booking packages',
  posTerminals: 'POS devices',
};

export default function CompanyPlanUsageCards() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const isCompany = !isStorefrontOrgSession(user);
  const canUsage =
    isCompany &&
    (can(P.SettingsManage) ||
      can(P.BillingRead) ||
      can(P.AnalyticsRead) ||
      can(P.UsersInvite) ||
      can(P.UsersManageRoles) ||
      can(P.ProductsWrite) ||
      can(P.FabricsWrite) ||
      can(P.CategoriesWrite) ||
      can(P.TailorsManage) ||
      can(P.BookingPackagesManage) ||
      can(P.BookingPackagesRead));
  const canSettings =
    isCompany && (can(P.SettingsManage) || can(P.BillingRead));
  const canPay =
    isCompany &&
    (can(P.BillingManage) || can(P.SettingsManage)) &&
    isPlatformAdminActor(user);

  const usage = useBillingUsageQuery(canUsage);
  const profile = useAdminCompanyProfileQuery(canSettings);
  const billing = useBillingStateQuery(canSettings);

  if (!isCompany || (!canUsage && !canSettings)) return null;

  const completeness = profile.data?.completeness;
  const billingState = billing.data;
  const planLabelResolved = formatPlanDisplayName(
    usage.data?.planResolved ??
      billingState?.planResolved ??
      billingState?.plan ??
      'starter'
  );
  const entitled =
    billingState?.billingEntitled ?? usage.data?.billingEntitled ?? false;
  const namedPlan = billingState?.plan || usage.data?.plan;
  const planLabel =
    !entitled
      ? 'No package'
      : !namedPlan
        ? `${planLabelResolved} floors`
        : formatPlanDisplayName(namedPlan);

  const softHoldPastDue = Boolean(
    billingState?.billingSoftHold ??
      (billingState?.pastDue && !entitled)
  );
  const renewSoon =
    entitled &&
    !softHoldPastDue &&
    isWithinBillingRenewWindow(billingState?.daysUntilRenewal);
  const billingCta = !canPay
    ? renewSoon
      ? 'View renew'
      : 'View billing'
    : softHoldPastDue
      ? 'Billing hold'
      : renewSoon
        ? 'Renew package'
        : !entitled || billingState?.pastDue
          ? billingState?.pastDue
            ? 'Fix billing'
            : 'Choose a plan'
          : 'Manage billing';
  const billingHref = softHoldPastDue ? '/company-pending' : '/admin/billing';

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700">
          Workspace plan & profile
        </h2>
        {canSettings ? (
          <AdminPendingLink
            href={billingHref}
            className={
              canPay
                ? 'inline-flex items-center rounded-md bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#B8941F]'
                : 'inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#D4AF37]/40'
            }
          >
            {billingCta}
          </AdminPendingLink>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-600">Plan</p>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {planLabel}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {softHoldPastDue
              ? 'Billing hold — contact FECSYNC to reactivate (Checkout locked)'
              : billingState?.pastDue
                ? canPay
                  ? 'Past due — update payment soon'
                  : 'Past due — ask your platform admin'
                : !entitled
                  ? canPay
                    ? 'Subscribe in Billing to unlock venues, catalog, seats, and role templates'
                    : 'Waiting on platform admin to subscribe'
                  : namedPlan === 'demo'
                    ? canPay
                      ? 'Demo trial — upgrade in Billing to unlock full packages'
                      : 'Demo trial — limited caps; modules locked'
                  : billingState?.subscriptionStatus
                    ? `Status: ${billingState.subscriptionStatus}`
                    : usage.data?.subscriptionStatus
                      ? `Status: ${usage.data.subscriptionStatus}`
                      : canPay
                        ? 'Choose a package in Billing'
                        : 'View plan details in Billing'}
          </p>
        </div>

        {canSettings ? (
          <AdminPendingLink
            href="/admin/company-profile"
            className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-[#D4AF37]/40"
          >
            <p className="text-sm font-medium text-gray-600">
              Profile completeness
            </p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {profile.isError
                ? '—'
                : profile.isLoading
                  ? '…'
                  : `${completeness ?? 0}%`}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Logo, legal name, contact, and bank for invoices
            </p>
          </AdminPendingLink>
        ) : null}

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-600">Renewal</p>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {billingState?.daysUntilRenewal != null
              ? `${billingState.daysUntilRenewal}d`
              : usage.data?.subscriptionEndsAt
                ? new Date(usage.data.subscriptionEndsAt).toLocaleDateString()
                : '—'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Based on subscriptionEndsAt
          </p>
        </div>
      </div>

      {canUsage ? (
        <div className="space-y-3">
          {!entitled ? (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Creates locked until Billing — meters show 0 remaining until Checkout
              or an ops plan stamp.
            </p>
          ) : null}
          {entitled &&
          (usage.data?.overLimitResources?.length ?? 0) > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              Over plan limit on{" "}
              {(usage.data?.overLimitResources ?? [])
                .map((r) => RESOURCE_LABELS[r] ?? r)
                .join(", ")}
              . Existing data is kept; new creates stay blocked until you upgrade
              or remove / archive items (including venues).
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(usage.data?.meters ?? []).map((m) => {
            const pct =
              m.unlimited || m.limit == null || m.limit <= 0
                ? 0
                : Math.min(100, Math.round((m.used / m.limit) * 100));
            return (
              <div
                key={m.resource}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <p className="text-sm font-medium text-gray-600">
                  {RESOURCE_LABELS[m.resource] ?? m.resource}
                </p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {m.used}
                  <span className="text-sm font-normal text-gray-500">
                    {' '}
                    / {m.unlimited ? '∞' : m.limit}
                  </span>
                </p>
                {!entitled ? (
                  <p className="mt-2 text-xs text-amber-800">Locked</p>
                ) : !m.unlimited && m.limit != null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-[#D4AF37]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">Unlimited</p>
                )}
              </div>
            );
          })}
          {usage.isLoading && !usage.data ? (
            <p className="text-sm text-gray-500">Loading usage…</p>
          ) : null}
          {usage.isError ? (
            <p className="text-sm text-gray-500">Usage unavailable</p>
          ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
