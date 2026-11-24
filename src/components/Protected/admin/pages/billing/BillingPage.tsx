'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/contexts/toast-context';
import { useCatalogActionPermissions, isStorefrontOrgSession, isStorefrontPlatformSuperAdmin } from '@/hooks/useAdminPermission';
import { isPlatformAdminActor } from '@/lib/auth/permissions';
import {
  useBillingPlansQuery,
  useBillingUsageQuery,
  useBillingCheckoutMutation,
  useBillingPortalMutation,
  useEnterpriseHqSessionCatchUp,
  invalidateBillingQueries,
} from '@/hooks/useBilling';
import { getMe } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateOrgSaasQueries } from '@/utils/invalidateOrgSaasQueries';
import {
  clearCompanyPlanHint,
  readCompanyPlanHint,
  writeCompanyPlanHint,
} from '@/utils/companyPlanHint';
import type { BillingDurationMonths, SubscriptionPlanId } from '@/lib/subscriptionPlans';
import {
  BILLING_DURATION_OPTIONS,
  computePlanTermTotalMajor,
  DEFAULT_BILLING_DURATION_MONTHS,
  isSubscriptionPlanId,
  normalizeBillingDurationMonths,
  resolveBillingDurationMonthsInterest,
} from '@/lib/subscriptionPlans';
import BillingStatusBanner from './BillingStatusBanner';
import BillingPlanCardView from './BillingPlanCard';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BILLING_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

const USAGE_LABELS: Record<string, string> = {
  venues: 'Venues',
  members: 'Team members',
  roleTemplates: 'Role templates',
  products: 'Menu items',
  fabrics: 'Catalog fabrics',
  categories: 'Catalog categories',
  tailorSeats: 'Tailor seats',
  campaigns: 'Campaigns',
  tailorClients: 'Tailor clients',
  ticketsPerMonth: 'Tickets / month',
  bookingPackages: 'Booking packages',
  posTerminals: 'POS devices',
};

export default function BillingPage() {
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const { canManageHomepage } = useCatalogActionPermissions();
  const canManage = canManageHomepage;
  const orgStatus = useAuthStore((s) => s.user?.orgStatus ?? null);
  const subscriptionStatus = useAuthStore(
    (s) => s.user?.subscriptionStatus ?? null
  );
  const opsHold =
    orgStatus === 'suspended' &&
    (subscriptionStatus || '').trim().toLowerCase() === 'ops_hold';
  const isPlatformAdmin = isPlatformAdminActor(user);
  const isStorefront = isStorefrontOrgSession(user);
  const superAdmin = isStorefrontPlatformSuperAdmin(user);
  // Project owner may open the full Billing shell on the storefront host for QA.
  // Checkout / portal APIs still refuse DEFAULT_ORG.
  const billingConsole = canManage && (!isStorefront || superAdmin);

  useEnterpriseHqSessionCatchUp(billingConsole && !isStorefront);

  const { data, isLoading, isError, refetch } = useBillingPlansQuery(
    billingConsole
  );
  const usageQuery = useBillingUsageQuery(billingConsole);
  const checkoutMutation = useBillingCheckoutMutation();
  const portalMutation = useBillingPortalMutation();

  // Landing /register-company?plan= or /admin/billing?plan= hint — visual only (not entitlement).
  const [planHint, setPlanHint] = useState<SubscriptionPlanId | null>(null);
  const [durationMonths, setDurationMonths] = useState<BillingDurationMonths>(
    DEFAULT_BILLING_DURATION_MONTHS
  );
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    const fromUrl = searchParams.get('plan')?.trim().toLowerCase() ?? '';
    if (isSubscriptionPlanId(fromUrl)) {
      writeCompanyPlanHint(fromUrl);
      setPlanHint(fromUrl);
      return;
    }
    setPlanHint(readCompanyPlanHint());
  }, [searchParams]);

  useEffect(() => {
    const fromUrl = normalizeBillingDurationMonths(
      searchParams.get('months') ?? searchParams.get('duration')
    );
    if (searchParams.get('months') || searchParams.get('duration')) {
      setDurationMonths(fromUrl);
      return;
    }
    setDurationMonths(
      resolveBillingDurationMonthsInterest({
        requestedDurationMonths: data?.billing?.requestedDurationMonths,
        subscriptionInterval: data?.billing?.subscriptionInterval,
      })
    );
  }, [
    searchParams,
    data?.billing?.requestedDurationMonths,
    data?.billing?.subscriptionInterval,
  ]);

  useEffect(() => {
    const flag = searchParams.get('billing');
    if (!flag) return;

    const syncSessionFromMe = async () => {
      try {
        const { user } = await getMe({ force: true });
        setUser(user);
      } catch (err) {
        console.warn('[billing] session sync failed:', err);
      }
      // Stripe webhooks may have updated plan/limits — refresh billing + plan-cap lists.
      invalidateBillingQueries(queryClient);
      invalidateOrgSaasQueries(queryClient);
      await refetch();
    };

    if (flag === 'success') {
      addToast(
        'Subscription checkout completed. Status updates shortly.',
        'success'
      );
      clearCompanyPlanHint();
      setPlanHint(null);
      void syncSessionFromMe();
    } else if (flag === 'cancel') {
      addToast('Checkout canceled — no charge was made.', 'info');
    } else if (flag === 'portal') {
      void syncSessionFromMe();
    }
    router.replace('/admin/billing');
  }, [searchParams, addToast, router, refetch, setUser, queryClient]);

  const handleCheckout = async (planId: string) => {
    if (!isPlatformAdmin) {
      addToast('Only the company platform admin can change the plan', 'error');
      return;
    }
    try {
      const url = await checkoutMutation.mutateAsync({
        plan: planId,
        durationMonths: planId === 'demo' ? 1 : durationMonths,
      });
      // Hint served its purpose once Checkout starts.
      clearCompanyPlanHint();
      setPlanHint(null);
      window.location.href = url;
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to start checkout',
        'error'
      );
    }
  };

  const handlePortal = async () => {
    if (!isPlatformAdmin) {
      addToast('Only the company platform admin can manage billing', 'error');
      return;
    }
    try {
      const url = await portalMutation.mutateAsync();
      window.location.href = url;
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to open portal',
        'error'
      );
    }
  };

  if (!canManage) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You need settings permission to manage billing.
      </div>
    );
  }

  if (isStorefront && !superAdmin) {
    return (
      <div className="p-6 max-w-xl space-y-2">
        <h1 className="text-xl font-semibold text-stone-900">Billing</h1>
        <p className="text-sm text-stone-600">
          Company subscription billing is for registered companies only. Use
          Companies to approve tenants; the FECSYNC storefront is not billed here.
        </p>
      </div>
    );
  }

  if (orgStatus === 'pending' || orgStatus === 'suspended') {
    return (
      <div className="p-6 max-w-xl space-y-2">
        <h1 className="text-xl font-semibold text-stone-900">Billing</h1>
        <p className="text-sm text-stone-600">
          {orgStatus === 'pending'
            ? 'Billing unlocks after FECSYNC approves your company.'
            : opsHold
              ? 'Your company workspace is on an ops hold. Self-serve renew is blocked — contact the developers or IT team to unlock, then choose a package here after reactivation.'
              : 'Your company workspace is suspended for billing. Ask FECSYNC to Approve or Set plan (reactivate), then choose a package here. Soft-hold overdue billing may also renew from the waiting room when allowed.'}
        </p>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    if (superAdmin && isStorefront) {
      return (
        <div className="p-6 max-w-xl space-y-3">
          <h1 className="text-xl font-semibold text-stone-900">Billing</h1>
          <p className="text-sm text-amber-950 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            Platform host QA — Billing stays in your sidebar. This org is not a
            billed tenant, so plan Checkout APIs refuse it. Open a registered
            company admin seat to exercise live Checkout / portal.
          </p>
          <p className="text-sm text-stone-600">
            Could not load billing plans for the storefront host. That is
            expected — money rails stay fail-closed on DEFAULT_ORG.
          </p>
        </div>
      );
    }
    return (
      <div className="p-6 text-sm text-stone-600">
        Could not load billing. Refresh and try again.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Billing</h1>
          <p className="text-sm text-stone-600 mt-1">
            Choose a FECSYNC package for your company. Checkout runs on Stripe.
            Open the guide if you are doing this for the first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Billing"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BILLING_GUIDE_STEPS}
      />

      {superAdmin && isStorefront ? (
        <p className="text-sm text-amber-950 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          Platform host QA — full Billing UI is unlocked for you. Checkout and
          portal APIs still refuse the storefront org as a billed tenant.
        </p>
      ) : null}

      {!isPlatformAdmin ? (
        <p className="text-sm text-stone-600 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
          View only — ask your company platform admin to change plans or open
          Stripe billing.
        </p>
      ) : null}

      <BillingStatusBanner
        billing={data.billing}
        onManage={
          isPlatformAdmin && data.billing.hasCustomer ? handlePortal : undefined
        }
        onRenew={
          isPlatformAdmin
            ? data.billing.hasCustomer || data.billing.hasSubscription
              ? handlePortal
              : data.billing.plan
                ? () => void handleCheckout(data.billing.plan as string)
                : undefined
            : undefined
        }
        manageBusy={portalMutation.isPending}
        renewBusy={
          portalMutation.isPending || checkoutMutation.isPending
        }
        overLimitResources={usageQuery.data?.overLimitResources}
      />

      {data.billing.enterpriseHqEnabled ? (
        <p className="rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-2 text-sm text-stone-800">
          Enterprise HQ unlocked —{' '}
          <Link
            href="/admin/hq"
            className="font-semibold text-stone-900 underline-offset-2 hover:underline"
          >
            Open HQ
          </Link>
          .
        </p>
      ) : data.billing.plan === 'enterprise' && !data.billing.billingEntitled ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Enterprise is stamped but not entitled yet — renew or clear billing
          hold before HQ unlocks.
        </p>
      ) : data.billing.plan === 'starter' || data.billing.plan === 'growth' ? (
        <p className="text-sm text-stone-600">
          Enterprise HQ unlocks on Enterprise. See the guide for Starter/Growth
          park tools without HQ.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">Plan usage</h2>
        <p className="text-sm text-stone-600">
          {data.billing.billingEntitled
            ? 'Live meters for this workspace. Creating capped resources updates these counts.'
            : 'Creates stay locked until Checkout or an ops plan stamp.'}
        </p>
        {usageQuery.isLoading && !usageQuery.data ? (
          <p className="text-sm text-stone-500">Loading usage…</p>
        ) : usageQuery.isError && !usageQuery.data ? (
          <p className="text-sm text-stone-500">Usage unavailable</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {(usageQuery.data?.meters ?? []).map((m) => (
              <div
                key={m.resource}
                className="rounded-md border border-stone-200 bg-white px-3 py-2"
              >
                <p className="text-xs text-stone-500">
                  {USAGE_LABELS[m.resource] ?? m.resource}
                </p>
                <p className="text-sm font-semibold text-stone-900 mt-0.5">
                  {m.used}
                  <span className="font-normal text-stone-500">
                    {' '}
                    / {m.unlimited ? '∞' : m.limit}
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">Packages</h2>
        <p className="text-sm text-stone-600">
          Pick a package and subscription length. Demo is free. Active paid
          Stripe plans change via Manage billing — see the guide.
        </p>
        {!data.billing.hasSubscription || data.billing.plan === 'demo' ? (
          <div className="max-w-sm">
            <label
              htmlFor="billing-duration"
              className="mb-1.5 block text-xs font-medium text-stone-600"
            >
              Subscription length
            </label>
            <select
              id="billing-duration"
              value={durationMonths}
              onChange={(e) =>
                setDurationMonths(
                  normalizeBillingDurationMonths(Number(e.target.value))
                )
              }
              className="w-full cursor-pointer rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            >
              {(data.durationOptions?.length
                ? data.durationOptions
                : BILLING_DURATION_OPTIONS
              ).map((d) => (
                <option key={d.months} value={d.months}>
                  {d.label}
                </option>
              ))}
            </select>
            {data.billing.subscriptionInterval ? (
              <p className="mt-1 text-xs text-stone-500">
                Current term on file: {data.billing.subscriptionInterval}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {data.plans.map((plan) => (
            <BillingPlanCardView
              key={plan.id}
              plan={plan}
              currentPlan={data.billing.plan}
              hasSubscription={data.billing.hasSubscription}
              preferHighlight={planHint === plan.id}
              durationMonths={durationMonths}
              termTotalMajor={
                plan.durationQuotes?.find((q) => q.months === durationMonths)
                  ?.totalMajor ??
                computePlanTermTotalMajor(plan.id, durationMonths)
              }
              disabled={!isPlatformAdmin || checkoutMutation.isPending}
              busy={
                checkoutMutation.isPending &&
                checkoutMutation.variables?.plan === plan.id
              }
              onCheckout={handleCheckout}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
