'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';
import { useAuthStore } from '@/store/authStore';
import { isPlatformAdminActor, P } from '@/lib/auth/permissions';
import { isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  readAdminListSnapshot,
  writeAdminListSnapshot,
} from '@/lib/adminListSnapshot';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  PAYOUTS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import {
  useAccountingDashboardQuery,
  useAccountingInitialized,
  useBankAccountsQuery,
} from '@/hooks/useAccounting';
import {
  createParkConnectLoginLink,
  getParkMarketplaceAccount,
  listMarketplaceBookings,
  listParkMarketplaceAccounts,
  marketplaceKeys,
  refreshParkConnectLink,
  startParkConnectOnboard,
  syncParkConnectAccount,
  type MarketplaceBookingListRow,
  type OrgMarketplaceAccountDto,
  type ParkMarketplaceAccountDto,
} from '@/services/marketplace';
import { invalidateMarketplacePayoutQueries } from '@/utils/invalidateMarketplacePayoutQueries';
import {
  MARKETPLACE_PAYOUTS_SYNC_KEY,
  parseMarketplacePayoutsSync,
} from '@/utils/marketplacePayoutsSync';

function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${(currency || 'usd').toUpperCase()}`;
  }
}

function ParkLedgerSection({
  locationId,
  title,
}: {
  locationId?: string | null;
  title: string;
}) {
  const ledgerQuery = useQuery({
    queryKey: marketplaceKeys.bookings(locationId ?? null),
    queryFn: () =>
      listMarketplaceBookings({
        take: 12,
        locationId: locationId ?? null,
      }),
  });
  const rows: MarketplaceBookingListRow[] = ledgerQuery.data ?? [];

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
        <p className="text-xs text-stone-500 mt-0.5">
          Recent marketplace bookings for this park scope. Sister parks and SaaS
          invoices are not shown.
        </p>
      </div>
      {ledgerQuery.isLoading && rows.length === 0 ? (
        <p className="text-sm text-stone-500">Loading recent bookings…</p>
      ) : ledgerQuery.isError ? (
        <p className="text-sm text-stone-600 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          {ledgerQuery.error instanceof Error
            ? ledgerQuery.error.message
            : 'Could not load recent bookings.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-stone-500 rounded-xl border border-dashed border-stone-200 px-3 py-4">
          No marketplace bookings yet for this park scope.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
          {rows.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-stone-900 truncate">
                  {b.packageTitle}
                </p>
                <p className="text-xs text-stone-500 truncate">
                  {b.customerEmail}
                  {b.paidAt
                    ? ` · paid ${new Date(b.paidAt).toLocaleDateString()}`
                    : ` · ${b.status}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-stone-900">
                  {formatMinor(b.amountMinor, b.currency)}
                </p>
                <p className="text-[11px] uppercase tracking-wide text-stone-500">
                  {b.status}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type StatusPill = {
  label: string;
  className: string;
};

const MARKETPLACE_SNAP_KEY = ['marketplace-account'] as const;

function statusPill(status: string): StatusPill {
  switch (status) {
    case 'complete':
      return {
        label: 'Ready',
        className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'pending':
      return {
        label: 'Pending',
        className: 'bg-amber-50 text-amber-900 border-amber-200',
      };
    case 'restricted':
      return {
        label: 'Restricted',
        className: 'bg-orange-50 text-orange-900 border-orange-200',
      };
    case 'disabled':
      return {
        label: 'Disabled',
        className: 'bg-red-50 text-red-800 border-red-200',
      };
    default:
      return {
        label: 'Not started',
        className: 'bg-stone-100 text-stone-700 border-stone-200',
      };
  }
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

function ChargeReadyBadge({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
      Charge-ready
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-600">
      Not charge-ready
    </span>
  );
}

export default function PayoutsPage() {
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const isStorefront = isStorefrontOrgSession(user);
  const orgId = user?.orgId ?? null;
  const isFranchiseManager =
    user?.parkLocked === true && user?.franchiseParkManager === true;
  const parkLocked = user?.parkLocked === true;
  /** Company org Connect CTAs stay platform_admin; franchise managers never see them. */
  const canManageOrg =
    isPlatformAdminActor(user) &&
    !isStorefront &&
    !isFranchiseManager &&
    !parkLocked &&
    can(P.PayoutsManage);
  /** Park Connect: company-wide with manage, or franchise managers on assigned parks. */
  const canManagePark =
    !isStorefront &&
    can(P.PayoutsManage) &&
    (!parkLocked || isFranchiseManager);
  const canReadParks =
    !isStorefront && (can(P.PayoutsRead) || can(P.PayoutsManage));
  const softHold = user?.billingSoftHold === true;
  const locationIdParam = searchParams.get('locationId')?.trim() || null;
  const canAcctRead = can(P.AccountingRead);
  const { initialized: acctReady } = useAccountingInitialized(canAcctRead);
  const bankQuery = useBankAccountsQuery({}, canAcctRead && acctReady);
  const dashQuery = useAccountingDashboardQuery({}, canAcctRead && acctReady);
  const banks = Array.isArray(bankQuery.data) ? bankQuery.data : [];
  const stripeBank = banks.find(
    (b: { stripeAccountId?: string | null }) => Boolean(b.stripeAccountId)
  ) as { id?: string; name?: string; stripeAccountId?: string } | undefined;
  const unreconciled =
    (dashQuery.data as { alerts?: { unreconciledBankLines?: number } })?.alerts
      ?.unreconciledBankLines ?? null;

  const [account, setAccount] = useState<OrgMarketplaceAccountDto | null>(() => {
    if (isStorefront || isFranchiseManager) return null;
    const snap = readAdminListSnapshot<OrgMarketplaceAccountDto>(
      orgId,
      MARKETPLACE_SNAP_KEY
    );
    return snap ?? null;
  });
  const [loading, setLoading] = useState(
    () => !isStorefront && !isFranchiseManager && account === null
  );
  const [busy, setBusy] = useState<
    'onboard' | 'refresh' | 'login' | 'sync' | null
  >(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const connectHandled = useRef(false);

  const refreshPayoutCaches = useCallback(
    (opts?: { broadcast?: boolean }) => {
      invalidateMarketplacePayoutQueries(queryClient, {
        orgId,
        locationId: locationIdParam,
        broadcast: opts?.broadcast === true,
      });
    },
    [queryClient, orgId, locationIdParam]
  );

  // Webhook/account.updated updates DB only — refresh caches when the tab
  // becomes visible so charge-ready flips without a full reload.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshPayoutCaches();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshPayoutCaches]);

  // Cross-tab: Connect sync / archive / guest checkout ledger bump.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MARKETPLACE_PAYOUTS_SYNC_KEY && e.newValue) {
        const payload = parseMarketplacePayoutsSync(e.newValue);
        if (!payload || (orgId && payload.orgId !== orgId)) return;
        refreshPayoutCaches();
        return;
      }
      // Legacy guest-checkout bump (MarketplaceBookSuccessClient).
      if (e.key === 'fecsync:marketplace-ledger-bump' && e.newValue) {
        refreshPayoutCaches();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [orgId, refreshPayoutCaches]);

  const loadAccount = useCallback(async () => {
    if (
      isStorefrontOrgSession(useAuthStore.getState().user) ||
      isFranchiseManager
    ) {
      setAccount(null);
      return;
    }
    const raw = await api<MaybeWrapped<{ account: OrgMarketplaceAccountDto }>>(
      '/api/admin/marketplace/account'
    );
    const data = unwrap(raw);
    const next = data?.account ?? null;
    setAccount(next);
    if (next && orgId) {
      writeAdminListSnapshot(orgId, MARKETPLACE_SNAP_KEY, next);
    }
    void queryClient.invalidateQueries({ queryKey: marketplaceKeys.account() });
  }, [orgId, isFranchiseManager, queryClient]);

  const parksQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: canReadParks && !locationIdParam,
  });

  const parkDetailQuery = useQuery({
    queryKey: marketplaceKeys.parkAccount(locationIdParam ?? ''),
    queryFn: () => getParkMarketplaceAccount(locationIdParam!),
    enabled: Boolean(locationIdParam) && canReadParks,
  });

  useEffect(() => {
    if (isStorefront || isFranchiseManager) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!account) setLoading(true);
      try {
        await loadAccount();
      } catch (err) {
        if (!cancelled) {
          addToast(errMessage(err, 'Failed to load payouts status'), 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + org change only
  }, [addToast, loadAccount, orgId, isStorefront, isFranchiseManager]);

  useEffect(() => {
    if (isStorefront) return;
    const flag = searchParams.get('connect');
    if (flag !== 'return' && flag !== 'refresh') return;
    if (connectHandled.current) return;
    connectHandled.current = true;

    let cancelled = false;
    (async () => {
      setBusy('sync');
      try {
        if (locationIdParam) {
          const next = await syncParkConnectAccount(locationIdParam);
          if (!cancelled) {
            queryClient.setQueryData(marketplaceKeys.parkAccount(locationIdParam), {
              account: next,
              chargeReadyReason: null,
            });
            refreshPayoutCaches({ broadcast: true });
            addToast('Park payouts status synced from Stripe.', 'success');
            router.replace(
              `/admin/payouts?locationId=${encodeURIComponent(locationIdParam)}`
            );
          }
        } else if (!isFranchiseManager) {
          const raw = await api<
            MaybeWrapped<{
              account: OrgMarketplaceAccountDto;
              chargeReady: boolean;
            }>
          >('/api/admin/marketplace/connect/sync', { method: 'POST' });
          const data = unwrap(raw);
          if (!cancelled) {
            if (data?.account) setAccount(data.account);
            refreshPayoutCaches({ broadcast: true });
            addToast('Payouts status synced from Stripe.', 'success');
            router.replace('/admin/payouts');
          }
        } else {
          router.replace('/admin/payouts');
        }
      } catch (err) {
        if (!cancelled) {
          addToast(errMessage(err, 'Failed to sync payouts status'), 'error');
          router.replace(
            locationIdParam
              ? `/admin/payouts?locationId=${encodeURIComponent(locationIdParam)}`
              : '/admin/payouts'
          );
        }
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    addToast,
    router,
    searchParams,
    isStorefront,
    isFranchiseManager,
    locationIdParam,
    queryClient,
    refreshPayoutCaches,
  ]);

  if (isStorefront) {
    const canSeeCompanies = can(P.UsersManageRoles);
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
          <p className="text-sm text-stone-600 mt-1">
            Stripe Connect for registered company marketplace bookings.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950 space-y-3">
          <p className="font-semibold">Wrong workspace for this feature</p>
          <p>
            FECSYNC storefront cannot be a Connect merchant. Complete payouts
            onboarding inside a registered company workspace.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {canSeeCompanies ? (
              <Link
                href="/admin/registered-companies"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030]"
              >
                Company workspaces
              </Link>
            ) : null}
            <Link
              href="/register-company"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-950"
            >
              Register a company
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const redirectToUrl = async (
    path: string,
    action: 'onboard' | 'refresh' | 'login'
  ) => {
    setBusy(action);
    try {
      const raw = await api<MaybeWrapped<{ url: string }>>(path, {
        method: 'POST',
      });
      const data = unwrap(raw);
      if (!data?.url) throw new Error('Redirect URL missing');
      window.location.href = data.url;
    } catch (err) {
      addToast(errMessage(err, 'Request failed'), 'error');
      setBusy(null);
    }
  };

  const redirectPark = async (
    action: 'onboard' | 'refresh' | 'login',
    locationId: string
  ) => {
    setBusy(action);
    try {
      const result =
        action === 'onboard'
          ? await startParkConnectOnboard(locationId)
          : action === 'refresh'
            ? await refreshParkConnectLink(locationId)
            : await createParkConnectLoginLink(locationId);
      window.location.href = result.url;
    } catch (err) {
      addToast(errMessage(err, 'Request failed'), 'error');
      setBusy(null);
    }
  };

  // ── Park detail (?locationId=) ──────────────────────────────────────────
  if (locationIdParam) {
    const park = parkDetailQuery.data?.account ?? null;
    const parkLoading = parkDetailQuery.isLoading && !park;
    const parkErr =
      parkDetailQuery.error instanceof Error
        ? parkDetailQuery.error.message
        : null;
    const pill = statusPill(park?.onboardingStatus ?? 'not_started');
    const isComplete = park?.onboardingStatus === 'complete';
    const hasAccount = Boolean(park?.hasConnectedAccount);

    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              <Link
                href="/admin/payouts"
                className="hover:text-stone-800 underline-offset-2 hover:underline"
              >
                Payouts
              </Link>
              {' / '}
              Park
            </p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              {park?.locationName || 'Park payouts'}
            </h1>
            <p className="text-sm text-stone-600 mt-1">
              Guest booking payments for this franchise park settle to its own
              Stripe Express account — not company SaaS billing.
            </p>
          </div>
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
        </div>

        <AdminHowToGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Payouts"
          subtitle="Follow these steps in order — written for first-time admins."
          steps={PAYOUTS_GUIDE_STEPS}
        />

        {softHold && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Billing soft-hold is active — park Connect refresh is locked.
            {!isFranchiseManager ? (
              <>
                {' '}
                Contact FECSYNC or renew under{' '}
                <Link href="/admin/billing" className="font-semibold underline">
                  Billing
                </Link>
                .
              </>
            ) : (
              <> Contact your company admin or FECSYNC.</>
            )}
          </div>
        )}

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          {parkLoading ? (
            <div className="flex items-center gap-3 text-sm text-stone-500">
              <div className="w-5 h-5 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
              Loading park payouts status…
            </div>
          ) : parkErr ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {parkErr}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${pill.className}`}
                >
                  {pill.label}
                </span>
                <ChargeReadyBadge ready={Boolean(park?.chargeReady)} />
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-stone-500">Charges enabled</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {park?.chargesEnabled ? 'Yes' : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Payouts enabled</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {park?.payoutsEnabled ? 'Yes' : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Payout bank</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {park?.payoutBankName || park?.payoutBankLast4
                      ? `${park.payoutBankName ?? 'Bank'}${
                          park.payoutBankLast4
                            ? ` •••• ${park.payoutBankLast4}`
                            : ''
                        }`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Currency</dt>
                  <dd className="font-medium text-stone-900 mt-0.5 uppercase">
                    {park?.defaultCurrency || '—'}
                  </dd>
                </div>
              </dl>

              {park?.disabledReason ? (
                <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  {park.disabledReason}
                </p>
              ) : null}

              {!park?.chargeReady && !softHold ? (
                <p className="text-sm text-stone-600 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                  Guests cannot complete card checkout for this park until status
                  is Ready.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                {!hasAccount && !isComplete && canManagePark && !softHold && (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      void redirectPark('onboard', locationIdParam)
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                  >
                    {busy === 'onboard' && <ButtonSpinner />}
                    Set up park payouts
                  </button>
                )}

                {hasAccount && !isComplete && canManagePark && !softHold && (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      void redirectPark('refresh', locationIdParam)
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                  >
                    {busy === 'refresh' && <ButtonSpinner />}
                    Refresh link
                  </button>
                )}

                {isComplete && canManagePark && (
                  <button
                    type="button"
                    disabled={busy != null || softHold}
                    onClick={() => void redirectPark('login', locationIdParam)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-400 disabled:opacity-50"
                  >
                    {busy === 'login' && <ButtonSpinner />}
                    Open Express Dashboard
                  </button>
                )}

                {canManagePark && (
                  <button
                    type="button"
                    disabled={busy != null || softHold || !hasAccount}
                    onClick={async () => {
                      setBusy('sync');
                      try {
                        const next =
                          await syncParkConnectAccount(locationIdParam);
                        queryClient.setQueryData(
                          marketplaceKeys.parkAccount(locationIdParam),
                          { account: next, chargeReadyReason: null }
                        );
                        refreshPayoutCaches({ broadcast: true });
                        addToast('Park status refreshed', 'success');
                      } catch (err) {
                        addToast(errMessage(err, 'Sync failed'), 'error');
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-400 disabled:opacity-50"
                  >
                    {busy === 'sync' && <ButtonSpinner />}
                    Sync status
                  </button>
                )}
              </div>

              {!canManagePark && (
                <p className="text-xs text-stone-500">
                  You can view this park&apos;s payout status. Only a franchise
                  park manager or company admin with payouts manage can continue
                  Connect onboarding.
                </p>
              )}
            </>
          )}
        </section>

        <ParkLedgerSection
          locationId={locationIdParam}
          title="Recent park bookings"
        />

        <p className="text-sm text-stone-600">
          <Link
            href="/admin/payouts"
            className="font-semibold text-stone-900 underline-offset-2 hover:underline"
          >
            ← All payouts
          </Link>
        </p>
      </div>
    );
  }

  // ── List view (company + franchise parks) ───────────────────────────────
  const pill = statusPill(account?.onboardingStatus ?? 'not_started');
  const isComplete = account?.onboardingStatus === 'complete';
  const hasAccount = Boolean(account?.hasConnectedAccount);
  const parks: ParkMarketplaceAccountDto[] = parksQuery.data ?? [];
  const parksLoading = parksQuery.isLoading && parks.length === 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
          <p className="text-sm text-stone-600 mt-1">
            {isFranchiseManager
              ? 'Connect Stripe Express so guest payments settle to your franchise park bank. Company SaaS billing stays with HQ.'
              : 'Connect Stripe Express so guest booking payments settle to your company or franchise park bank. Open the guide if you are doing this for the first time.'}
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Payouts"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={PAYOUTS_GUIDE_STEPS}
      />

      {acctReady && stripeBank?.id ? (
        <section className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 px-4 py-3 text-sm text-stone-800">
          <p className="font-medium text-stone-900">Accounting clearing account</p>
          <p className="mt-1 text-stone-700">
            Stripe Connect maps to{' '}
            <Link
              href={`/admin/accounting/banking/${stripeBank.id}`}
              className="font-semibold text-[#8a7320] underline"
            >
              {stripeBank.name ?? 'Clearing bank account'}
            </Link>
            {unreconciled != null ? (
              <>
                {' '}
                · {unreconciled} unreconciled line{unreconciled === 1 ? '' : 's'}
              </>
            ) : null}
          </p>
        </section>
      ) : null}

      {softHold && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Billing soft-hold is active — marketplace checkout and Connect refresh
          are locked.
          {!isFranchiseManager ? (
            <>
              {' '}
              Contact FECSYNC or renew under{' '}
              <Link href="/admin/billing" className="font-semibold underline">
                Billing
              </Link>
              .
            </>
          ) : (
            <> Contact your company admin or FECSYNC.</>
          )}
        </div>
      )}

      {/* Company org Connect — hidden for franchise park managers */}
      {!isFranchiseManager ? (
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">
              Company payouts
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Org Connect for non-franchise catalog and null-location packages.
            </p>
          </div>
          {loading && !account ? (
            <div className="flex items-center gap-3 text-sm text-stone-500">
              <div className="w-5 h-5 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
              Loading payouts status…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${pill.className}`}
                >
                  {pill.label}
                </span>
                <ChargeReadyBadge ready={Boolean(account?.chargeReady)} />
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-stone-500">Charges enabled</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {account?.chargesEnabled ? 'Yes' : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Payouts enabled</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {account?.payoutsEnabled ? 'Yes' : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Payout bank</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {account?.payoutBankName || account?.payoutBankLast4
                      ? `${account.payoutBankName ?? 'Bank'}${
                          account.payoutBankLast4
                            ? ` •••• ${account.payoutBankLast4}`
                            : ''
                        }`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Currency</dt>
                  <dd className="font-medium text-stone-900 mt-0.5 uppercase">
                    {account?.defaultCurrency || '—'}
                  </dd>
                </div>
              </dl>

              {account?.disabledReason ? (
                <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  {account.disabledReason}
                </p>
              ) : null}

              {!account?.chargeReady && !softHold ? (
                <p className="text-sm text-stone-600 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                  Guests cannot complete card checkout until status is Ready. See
                  the guide for details.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                {!hasAccount && !isComplete && canManageOrg && !softHold && (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      void redirectToUrl(
                        '/api/admin/marketplace/connect/onboard',
                        'onboard'
                      )
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                  >
                    {busy === 'onboard' && <ButtonSpinner />}
                    Set up payouts
                  </button>
                )}

                {hasAccount && !isComplete && canManageOrg && !softHold && (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      void redirectToUrl(
                        '/api/admin/marketplace/connect/refresh',
                        'refresh'
                      )
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
                  >
                    {busy === 'refresh' && <ButtonSpinner />}
                    Refresh link
                  </button>
                )}

                {isComplete && canManageOrg && (
                  <button
                    type="button"
                    disabled={busy != null || softHold}
                    onClick={() =>
                      void redirectToUrl(
                        '/api/admin/marketplace/connect/login-link',
                        'login'
                      )
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-400 disabled:opacity-50"
                  >
                    {busy === 'login' && <ButtonSpinner />}
                    Open Express Dashboard
                  </button>
                )}

                {canManageOrg && (
                  <button
                    type="button"
                    disabled={busy != null || softHold || !hasAccount}
                    onClick={async () => {
                      setBusy('sync');
                      try {
                        const raw = await api<
                          MaybeWrapped<{ account: OrgMarketplaceAccountDto }>
                        >('/api/admin/marketplace/connect/sync', {
                          method: 'POST',
                        });
                        const data = unwrap(raw);
                        if (data?.account) setAccount(data.account);
                        refreshPayoutCaches({ broadcast: true });
                        addToast('Status refreshed', 'success');
                      } catch (err) {
                        addToast(errMessage(err, 'Sync failed'), 'error');
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-400 disabled:opacity-50"
                  >
                    {busy === 'sync' && <ButtonSpinner />}
                    Sync status
                  </button>
                )}
              </div>

              {!canManageOrg && (
                <p className="text-xs text-stone-500">
                  Only the company platform admin can start or continue company
                  Connect onboarding.
                </p>
              )}
            </>
          )}
        </section>
      ) : null}

      {/* Franchise park list */}
      {canReadParks ? (
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">
              Franchise park payouts
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {isFranchiseManager
                ? 'Your assigned franchise parks — guest money settles per park when charge-ready.'
                : 'Each franchise park has its own Connect account. Non-franchise parks use company payouts above.'}
            </p>
          </div>

          {parksLoading ? (
            <div className="flex items-center gap-3 text-sm text-stone-500">
              <div className="w-5 h-5 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
              Loading park payouts…
            </div>
          ) : parksQuery.isError ? (
            <p className="text-sm text-stone-600 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
              {parksQuery.error instanceof Error
                ? parksQuery.error.message
                : 'Could not load park payouts.'}
            </p>
          ) : parks.length === 0 ? (
            <p className="text-sm text-stone-500 rounded-xl border border-dashed border-stone-200 px-3 py-4">
              {isFranchiseManager
                ? 'No franchise parks assigned for payouts yet.'
                : 'No franchise parks yet. Mark a venue as franchise under Venues, then set up park payouts here.'}
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
              {parks.map((park) => {
                const parkPill = statusPill(park.onboardingStatus);
                return (
                  <li
                    key={park.locationId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-stone-900 truncate">
                        {park.locationName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${parkPill.className}`}
                        >
                          {parkPill.label}
                        </span>
                        <ChargeReadyBadge ready={park.chargeReady} />
                        <span className="text-xs text-stone-500">
                          {park.payoutBankName || park.payoutBankLast4
                            ? `${park.payoutBankName ?? 'Bank'}${
                                park.payoutBankLast4
                                  ? ` •••• ${park.payoutBankLast4}`
                                  : ''
                              }`
                            : 'No bank linked'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Link
                        href={`/admin/payouts?locationId=${encodeURIComponent(park.locationId)}`}
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-[#D4AF37] px-3 text-xs font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030]"
                      >
                        {park.hasConnectedAccount ? 'Manage' : 'Onboard'}
                      </Link>
                      {canManagePark && park.hasConnectedAccount && !softHold ? (
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={async () => {
                            setBusy('sync');
                            try {
                              await syncParkConnectAccount(park.locationId);
                              refreshPayoutCaches({ broadcast: true });
                              addToast(
                                `${park.locationName} status refreshed`,
                                'success'
                              );
                            } catch (err) {
                              addToast(errMessage(err, 'Sync failed'), 'error');
                            } finally {
                              setBusy(null);
                            }
                          }}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-800 hover:border-stone-400 disabled:opacity-50"
                        >
                          {busy === 'sync' && <ButtonSpinner />}
                          Sync
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* Franchise managers: park-scoped API (no sister parks). Company admins
          open a park detail for that park's ledger. */}
      {canReadParks && isFranchiseManager ? (
        <ParkLedgerSection
          locationId={null}
          title="Recent bookings (your parks)"
        />
      ) : null}

      {!isFranchiseManager ? (
        <p className="text-sm text-stone-600">
          Next:{' '}
          <Link
            href="/admin/booking-packages"
            className="font-semibold text-stone-900 underline-offset-2 hover:underline"
          >
            Booking packages
          </Link>{' '}
          to publish packages guests can book and pay for.
        </p>
      ) : (
        <p className="text-sm text-stone-600">
          Company SaaS subscription stays with HQ — this page only manages park
          guest payouts.
        </p>
      )}
    </div>
  );
}
