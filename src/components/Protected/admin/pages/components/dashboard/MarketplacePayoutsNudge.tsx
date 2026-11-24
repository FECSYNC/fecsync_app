'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useAuthStore } from '@/store/authStore';
import { isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import { P } from '@/lib/auth/permissions';
import { sessionIsDemoPlan } from '@/lib/demoPlanLock';
import {
  getOrgMarketplaceAccount,
  listParkMarketplaceAccounts,
  marketplaceKeys,
} from '@/services/marketplace';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import {
  MARKETPLACE_PAYOUTS_SYNC_KEY,
  parseMarketplacePayoutsSync,
} from '@/utils/marketplacePayoutsSync';

/**
 * Amber dashboard nudge when published catalog exists but Connect payouts are
 * not charge-ready. Org Connect for company-wide seats; park Connect for
 * franchise park managers (and company-wide when a published franchise park
 * is not park charge-ready). Distinct from SaaS renew banners.
 */
export default function MarketplacePayoutsNudge() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const isStorefront = isStorefrontOrgSession(user);
  const isDemo = sessionIsDemoPlan(user);
  const isFranchiseManager =
    user?.parkLocked === true && user?.franchiseParkManager === true;
  const canManagePayouts = can(P.PayoutsManage);
  const canSee =
    !isStorefront &&
    !isDemo &&
    (canManagePayouts ||
      can(P.BookingPackagesManage) ||
      can(P.PayoutsRead));
  const orgId = user?.orgId ?? null;

  const orgAccountQuery = useQuery({
    queryKey: marketplaceKeys.account(),
    queryFn: getOrgMarketplaceAccount,
    enabled: canSee && !isFranchiseManager,
  });

  const parkAccountsQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: canSee,
  });

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('hq', null),
    queryFn: () => listAdminVenueLocations({ scope: 'hq' }),
    enabled: canSee,
  });

  useEffect(() => {
    if (!canSee || !orgId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== MARKETPLACE_PAYOUTS_SYNC_KEY || !e.newValue) return;
      const payload = parseMarketplacePayoutsSync(e.newValue);
      if (!payload || payload.orgId !== orgId) return;
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
      void queryClient.invalidateQueries({ queryKey: venueLocationKeys.all });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [canSee, orgId, queryClient]);

  const [show, setShow] = useState(false);
  const [href, setHref] = useState('/admin/payouts');
  const [parkName, setParkName] = useState<string | null>(null);
  const [mode, setMode] = useState<'org' | 'park'>('org');

  useEffect(() => {
    if (!canSee) {
      setShow(false);
      return;
    }

    const parks = parkAccountsQuery.data ?? [];
    const venues = venuesQuery.data ?? [];
    const publishedById = new Set(
      venues
        .filter((v) => v.isFranchise && v.publicBookingEnabled)
        .map((v) => v.id)
    );
    const blockedPark = parks.find(
      (p) => !p.chargeReady && publishedById.has(p.locationId)
    );

    if (isFranchiseManager) {
      if (parkAccountsQuery.isLoading || venuesQuery.isLoading) return;
      if (blockedPark) {
        setShow(true);
        setMode('park');
        setHref(
          `/admin/payouts?locationId=${encodeURIComponent(blockedPark.locationId)}`
        );
        setParkName(blockedPark.locationName);
      } else {
        setShow(false);
        setParkName(null);
      }
      return;
    }

    if (
      orgAccountQuery.isLoading ||
      parkAccountsQuery.isLoading ||
      venuesQuery.isLoading
    ) {
      return;
    }

    // Prefer park gap when a published franchise park is not charge-ready.
    if (blockedPark) {
      setShow(true);
      setMode('park');
      setHref(
        `/admin/payouts?locationId=${encodeURIComponent(blockedPark.locationId)}`
      );
      setParkName(blockedPark.locationName);
      return;
    }

    const account = orgAccountQuery.data;
    if (!account) {
      setShow(false);
      setParkName(null);
      return;
    }
    if (account.chargeReady) {
      setShow(false);
      setParkName(null);
      return;
    }
    const published = (account.publishedActivePackageCount ?? 0) > 0;
    setShow(published);
    setMode('org');
    setHref('/admin/payouts');
    setParkName(null);
  }, [
    canSee,
    isFranchiseManager,
    orgAccountQuery.data,
    orgAccountQuery.isLoading,
    parkAccountsQuery.data,
    parkAccountsQuery.isLoading,
    venuesQuery.data,
    venuesQuery.isLoading,
  ]);

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 sm:px-5">
      <p className="text-sm font-semibold text-amber-950">
        Online booking pay is blocked
      </p>
      <p className="mt-1 text-sm text-amber-900">
        {mode === 'park' && parkName ? (
          <>
            {parkName} has published booking catalog, but park payouts are not
            ready yet. Guests cannot complete card checkout until Connect
            onboarding finishes.
          </>
        ) : (
          <>
            You have published booking packages, but payouts are not ready yet.
            Guests cannot complete card checkout until Connect onboarding
            finishes.
            {!canManagePayouts
              ? ' Ask a company platform admin to complete Payouts setup.'
              : ''}
          </>
        )}
      </p>
      {canManagePayouts || isFranchiseManager ? (
        <AdminPendingLink
          href={href}
          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-[#D4AF37] px-3 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030]"
        >
          Set up payouts
        </AdminPendingLink>
      ) : (
        <AdminPendingLink
          href="/admin/booking-packages"
          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 shadow-sm hover:border-amber-400"
        >
          View booking packages
        </AdminPendingLink>
      )}
    </div>
  );
}
