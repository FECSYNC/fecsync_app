'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getMe,
  isStorefrontOrgSession,
  type UserProfile,
} from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { getSubscriptionPlan } from '@/lib/subscriptionPlans';
import { isPlatformSoftwareOwner } from '@/lib/platformSoftwareOwner';
import BillingGraceCountdown from '@/components/billing/BillingGraceCountdown';
import SubscriptionEndsCountdown from '@/components/billing/SubscriptionEndsCountdown';

const SUPPORT_EMAIL = 'admin@fecsync.com';
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  'FECSYNC company account help'
)}`;

export type CompanyAccountSnapshot = Pick<
  UserProfile,
  | 'organizationName'
  | 'companyDisplayName'
  | 'orgStatus'
  | 'subscriptionPlan'
  | 'subscriptionStatus'
  | 'subscriptionEndsAt'
  | 'billingSoftHold'
  | 'billingGraceEndsAt'
  | 'requestedPlan'
>;

function planDisplayName(planId: string | null | undefined): string {
  const id = (planId || '').trim().toLowerCase();
  if (!id) return 'package';
  return getSubscriptionPlan(id)?.name ?? id;
}

function buildSnapshot(user: UserProfile): CompanyAccountSnapshot {
  return {
    organizationName: user.organizationName ?? null,
    companyDisplayName: user.companyDisplayName ?? null,
    orgStatus: user.orgStatus ?? null,
    subscriptionPlan: user.subscriptionPlan ?? null,
    subscriptionStatus: user.subscriptionStatus ?? null,
    subscriptionEndsAt: user.subscriptionEndsAt ?? null,
    billingSoftHold: user.billingSoftHold === true,
    billingGraceEndsAt: user.billingGraceEndsAt ?? null,
    requestedPlan: user.requestedPlan ?? null,
  };
}

/**
 * Realtime company workspace status for registered company admins only.
 * Never use for FECSYNC storefront / platform software-owner super admin.
 * Polls /api/auth/me so pending → active and subscriptionEndsAt stay accurate.
 */
export default function CompanyAccountStatusPanel({
  initial,
  pollMs = 15_000,
  showActions = true,
  onContinue,
  continueLabel,
  className,
}: {
  initial?: CompanyAccountSnapshot | null;
  /** How often to refresh from /me (ms). */
  pollMs?: number;
  showActions?: boolean;
  onContinue?: () => void;
  continueLabel?: string;
  className?: string;
}) {
  const setUser = useAuthStore((s) => s.setUser);
  const [snap, setSnap] = useState<CompanyAccountSnapshot | null>(
    initial ?? null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [notApplicable, setNotApplicable] = useState(false);

  const refresh = useCallback(
    async (quiet = true) => {
      if (!quiet) setRefreshing(true);
      try {
        const { user } = await getMe({ force: true });
        if (isPlatformSoftwareOwner(user) || isStorefrontOrgSession(user)) {
          setNotApplicable(true);
          setSnap(null);
          return;
        }
        if (!user?.orgStatus && !user?.subscriptionEndsAt && !user?.orgId) {
          return;
        }
        setNotApplicable(false);
        setUser(user);
        setSnap(buildSnapshot(user));
        setLastSyncedAt(Date.now());
      } catch {
        /* keep last good snapshot */
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [setUser]
  );

  useEffect(() => {
    if (initial) setSnap(initial);
  }, [initial]);

  useEffect(() => {
    void refresh(true);
    if (pollMs <= 0) return;
    const id = window.setInterval(() => void refresh(true), pollMs);
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, pollMs]);

  if (notApplicable) {
    return null;
  }

  if (!snap) {
    return (
      <div
        className={
          className ??
          'rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600'
        }
      >
        Checking your company workspace status…
      </div>
    );
  }

  const companyName =
    snap.companyDisplayName?.trim() ||
    snap.organizationName?.trim() ||
    'Your company';
  const orgStatus = (snap.orgStatus || '').trim().toLowerCase();
  const subStatus = (snap.subscriptionStatus || '').trim().toLowerCase();
  const planId =
    snap.subscriptionPlan?.trim() || snap.requestedPlan?.trim() || null;
  const planName = planDisplayName(planId);
  const softHold = snap.billingSoftHold === true;
  const isPending = orgStatus === 'pending';
  const isSuspended = orgStatus === 'suspended';
  const isActive = orgStatus === 'active' && !softHold;

  let title = 'Company workspace status';
  let body = 'Open your dashboard to manage this workspace.';
  let tone: 'stone' | 'amber' | 'emerald' | 'red' = 'stone';

  if (isPending) {
    title = 'Activation still pending';
    body =
      'Your company workspace is registered and still under review / awaiting activation. You cannot subscribe again from this page. Contact customer care for activation help, or open the waiting room to finish Checkout if payment is outstanding.';
    tone = 'amber';
  } else if (softHold) {
    title = 'Renewal grace window';
    body =
      'Your package period ended and soft hold is active. Renew from Billing before the grace timer ends, or contact customer care.';
    tone = 'amber';
  } else if (isSuspended) {
    title =
      subStatus === 'expired'
        ? 'Subscription ended — workspace suspended'
        : 'Workspace suspended';
    body =
      subStatus === 'expired'
        ? 'Your subscription ended. Renew from Billing or contact customer care to restore access. Your records are kept.'
        : 'This company workspace is suspended. Contact customer care for help unlocking it. Your records are kept.';
    tone = 'red';
  } else if (isActive) {
    title = `You already have an active ${planName} plan`;
    body =
      'If you want to upgrade or change packages, go to your dashboard Billing page or contact customer care. Registering again will not create a second company for this account.';
    tone = 'emerald';
  }

  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50/80'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50/90'
        : tone === 'red'
          ? 'border-red-200 bg-red-50/90'
          : 'border-stone-200 bg-stone-50';

  const dashboardHref = isPending || softHold || isSuspended
    ? '/company-pending'
    : '/admin';
  const billingHref = '/admin/billing';

  return (
    <div
      className={
        className ??
        `rounded-lg border px-4 py-4 text-left shadow-sm ${toneClass}`
      }
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        Live account update
        {lastSyncedAt
          ? ` · synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
          : ''}
        {refreshing ? ' · refreshing…' : ''}
      </p>
      <h2 className="mt-1 text-base font-semibold text-stone-900">{title}</h2>
      <p className="mt-1 text-sm text-stone-700">
        <span className="font-medium">{companyName}</span>
        {planId ? (
          <>
            {' '}
            · interested / entitled package:{' '}
            <span className="font-medium">{planName}</span>
          </>
        ) : null}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-stone-700">{body}</p>

      {isActive && snap.subscriptionEndsAt ? (
        <SubscriptionEndsCountdown
          endsAt={snap.subscriptionEndsAt}
          planLabel={planName}
          className="mt-4 rounded-md border border-emerald-200/80 bg-white/70 px-3 py-3"
        />
      ) : null}

      {softHold && snap.billingGraceEndsAt ? (
        <BillingGraceCountdown
          graceEndsAt={snap.billingGraceEndsAt}
          className="mt-4 rounded-md border border-amber-200 bg-white/70 px-3 py-3"
        />
      ) : null}

      {showActions ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {onContinue ? (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center justify-center rounded-lg bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030]"
            >
              {continueLabel ||
                (isPending ? 'Open waiting room' : 'Go to dashboard')}
            </button>
          ) : (
            <Link
              href={dashboardHref}
              className="inline-flex items-center justify-center rounded-lg bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030]"
            >
              {isPending ? 'Open waiting room' : 'Go to dashboard'}
            </Link>
          )}
          {!isPending ? (
            <Link
              href={billingHref}
              className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 hover:border-[#D4AF37]"
            >
              Open Billing
            </Link>
          ) : null}
          <a
            href={SUPPORT_MAILTO}
            className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 hover:border-[#D4AF37]"
          >
            Contact customer care
          </a>
          <button
            type="button"
            onClick={() => void refresh(false)}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-stone-600 underline-offset-2 hover:underline"
          >
            Refresh status
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { buildSnapshot as companyAccountSnapshotFromUser };
