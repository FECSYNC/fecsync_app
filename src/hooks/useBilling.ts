'use client';

import { useEffect, useRef } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { getMe } from '@/services/auth';
import {
  getBillingPlans,
  getBillingState,
  getBillingUsage,
  startBillingCheckout,
  openBillingPortal,
  type CompanyBillingState,
} from '@/services/billing';
import { invalidateOrgSaasQueries } from '@/utils/invalidateOrgSaasQueries';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';

export const billingKeys = {
  all: ['company-billing'] as const,
  plans: (orgId: string | null | undefined) =>
    ['company-billing', 'plans', orgId ?? 'none'] as const,
  state: (orgId: string | null | undefined) =>
    ['company-billing', 'state', orgId ?? 'none'] as const,
  usage: (orgId: string | null | undefined) =>
    ['company-billing', 'usage', orgId ?? 'none'] as const,
};

/** Refresh plan meters after any mutation that consumes/frees plan quota. */
export function invalidateBillingUsageQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: ['company-billing', 'usage'],
  });
}

/**
 * After venue create / archive / reactivate — usage meters + HQ rollup.
 * Do not call from unrelated catalog/member mutates (avoids HQ refetch churn).
 */
export function invalidateVenueAndHqQueries(queryClient: QueryClient) {
  invalidateBillingUsageQueries(queryClient);
  void queryClient.invalidateQueries({
    queryKey: ['admin', 'venue-locations'],
  });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'hq'] });
}

/** Refresh plans + state + usage (checkout/portal/webhook catch-up). */
export function invalidateBillingQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: billingKeys.all });
}

async function refreshSessionBilling() {
  try {
    const { user } = await getMe({ force: true });
    useAuthStore.getState().setUser(user);
  } catch (err) {
    console.warn('[billing] /me refresh failed:', err);
  }
}

export function useBillingPlansQuery(enabled: boolean = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const key = billingKeys.plans(orgId);
  return useQuery({
    queryKey: key,
    queryFn: getBillingPlans,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
    enabled: enabled && Boolean(orgId),
  });
}

export function useBillingStateQuery(enabled: boolean = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const key = billingKeys.state(orgId);
  return useQuery({
    queryKey: key,
    queryFn: getBillingState,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
    enabled: enabled && Boolean(orgId),
  });
}

/**
 * Ops set_plan / webhook may unlock (or revoke) Enterprise HQ before the next
 * AdminLayout silentRefresh. Align session `enterpriseHqEnabled` with billing.
 *
 * Also forces billing-state refetch after /me so Billing banners and session
 * gates do not stay split (session updated, RQ still stale).
 */
export function useEnterpriseHqSessionCatchUp(enabled: boolean = true) {
  const queryClient = useQueryClient();
  const sessionHq = useAuthStore((s) => s.user?.enterpriseHqEnabled === true);
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const inFlight = useRef(false);
  /** Avoid retry storms when /me and billing disagree on the same pair. */
  const attemptedAlignRef = useRef<string | null>(null);
  const billingStateQuery = useBillingStateQuery(enabled && Boolean(orgId));

  useEffect(() => {
    if (!enabled || !orgId) return;
    const billing = billingStateQuery.data;
    if (!billing) return;
    const billingHq = billing.enterpriseHqEnabled === true;
    if (billingHq === sessionHq) {
      inFlight.current = false;
      attemptedAlignRef.current = null;
      return;
    }
    const alignKey = `${orgId}:${billingHq ? '1' : '0'}→${sessionHq ? '1' : '0'}`;
    if (attemptedAlignRef.current === alignKey) return;
    if (inFlight.current) return;
    inFlight.current = true;
    attemptedAlignRef.current = alignKey;
    void (async () => {
      try {
        await refreshSessionBilling();
        invalidateOrgSaasQueries(queryClient);
        // Pull fresh entitlement into billing RQ (Billing page banner SSOT).
        await queryClient.invalidateQueries({
          queryKey: billingKeys.state(orgId),
        });
      } catch (err) {
        console.warn('[billing] enterpriseHq session catch-up failed:', err);
        // Allow a later retry (e.g. after silentRefresh) for the same mismatch.
        attemptedAlignRef.current = null;
      } finally {
        inFlight.current = false;
      }
    })();
  }, [
    enabled,
    orgId,
    billingStateQuery.data,
    sessionHq,
    queryClient,
  ]);
}

export function useBillingUsageQuery(enabled: boolean = true) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const key = billingKeys.usage(orgId);
  return useQuery({
    queryKey: key,
    queryFn: getBillingUsage,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
    enabled: enabled && Boolean(orgId),
  });
}

export function useBillingCheckoutMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: (input: { plan: string; durationMonths?: number }) =>
      startBillingCheckout(input.plan, input.durationMonths),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: billingKeys.plans(orgId) });
    },
  });
}

export function useBillingPortalMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => openBillingPortal(),
    onSuccess: async () => {
      invalidateBillingQueries(queryClient);
      await refreshSessionBilling();
      // Portal can change plan/period — drop plan-cap list caches too.
      invalidateOrgSaasQueries(queryClient);
    },
  });
}

export type { CompanyBillingState };
