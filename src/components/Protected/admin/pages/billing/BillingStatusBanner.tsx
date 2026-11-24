'use client';

import Link from 'next/link';
import type { CompanyBillingState } from '@/services/billing';
import { isWithinBillingRenewWindow } from '@/lib/billingRenewal';
import { formatPlanDisplayName } from '@/lib/subscriptionPlans';
import BillingGraceCountdown from '@/components/billing/BillingGraceCountdown';

function formatEndsAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function BillingStatusBanner({
  billing,
  onManage,
  onRenew,
  manageBusy,
  renewBusy,
  overLimitResources,
}: {
  billing: CompanyBillingState;
  onManage?: () => void;
  /** Opens Stripe Portal (live sub) or Checkout (ops grant / no portal yet). */
  onRenew?: () => void;
  manageBusy?: boolean;
  renewBusy?: boolean;
  overLimitResources?: string[];
}) {
  const resolved = formatPlanDisplayName(billing.planResolved || 'starter');
  const entitled = billing.billingEntitled;
  const planLabel = billing.plan
    ? formatPlanDisplayName(billing.plan)
    : entitled
      ? `${resolved} floors`
      : 'No package yet';
  const status = billing.subscriptionStatus || 'none';
  const overLimit = overLimitResources ?? [];
  // Soft-hold: Fresh soft-deny while org may still be active (not grace past_due).
  const softHoldPastDue = Boolean(
    billing.billingSoftHold ?? (billing.pastDue && !entitled)
  );
  const daysLeft = billing.daysUntilRenewal;
  const showRenew =
    entitled &&
    !softHoldPastDue &&
    isWithinBillingRenewWindow(daysLeft);
  const graceEndsAt = billing.billingGraceEndsAt ?? null;

  return (
    <section className="space-y-3">
      {softHoldPastDue && graceEndsAt ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold text-amber-950">
            Renewal grace period
          </p>
          <div className="mt-2">
            <BillingGraceCountdown graceEndsAt={graceEndsAt} />
          </div>
          {onRenew ? (
            <button
              type="button"
              onClick={onRenew}
              disabled={renewBusy || manageBusy}
              className="mt-3 inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {renewBusy ? 'Opening…' : 'Renew package'}
            </button>
          ) : (
            <Link
              href="/company-pending"
              className="mt-3 inline-flex h-10 items-center justify-center rounded-lg border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 hover:border-amber-500"
            >
              Open renewal waiting room
            </Link>
          )}
        </div>
      ) : null}

      {showRenew ? (
        <div className="rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/10 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900">
                Package renews soon
              </p>
              <p className="mt-1 text-sm text-stone-700">
                {daysLeft === 0
                  ? 'Your package ends today.'
                  : daysLeft === 1
                    ? 'Your package ends tomorrow.'
                    : `Your package ends in ${daysLeft} days.`}{' '}
                Renew by {formatEndsAt(billing.subscriptionEndsAt)} to keep
                venues, team seats, and plan tools unlocked.
              </p>
            </div>
            {onRenew ? (
              <button
                type="button"
                onClick={onRenew}
                disabled={renewBusy || manageBusy}
                className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {renewBusy ? 'Opening…' : 'Renew package'}
              </button>
            ) : (
              <Link
                href="/admin/billing"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-[#D4AF37]"
              >
                View billing
              </Link>
            )}
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Current subscription
            </h2>
            <p className="text-sm text-stone-600 mt-1">
              {planLabel} · {status.replace(/_/g, ' ')}
              {billing.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
            </p>
            {!entitled ? (
              <p className="text-xs text-amber-800 mt-1">
                Venues, catalog tools, team seats, role templates, and tailor
                modules stay locked until Checkout completes or FECSYNC stamps an
                ops plan.
              </p>
            ) : !billing.plan ? (
              <p className="text-xs text-stone-500 mt-1">
                Entitled with no named package — limits use {resolved} floors until
                you choose a package in Billing.
              </p>
            ) : null}
          </div>
          {billing.hasCustomer && onManage && !softHoldPastDue ? (
            <button
              type="button"
              onClick={onManage}
              disabled={manageBusy || renewBusy}
              className="cursor-pointer rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-800 shadow-sm transition hover:border-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {manageBusy ? 'Opening…' : 'Manage billing'}
            </button>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-stone-500">Renewal / ends</dt>
            <dd className="text-stone-900 font-medium">
              {formatEndsAt(billing.subscriptionEndsAt)}
              {billing.daysUntilRenewal != null
                ? ` (${billing.daysUntilRenewal}d)`
                : ''}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Stripe customer</dt>
            <dd className="text-stone-900 font-medium">
              {billing.hasCustomer ? 'Linked' : 'Not linked'}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Org status</dt>
            <dd className="text-stone-900 font-medium">{billing.orgStatus}</dd>
          </div>
        </dl>
        {!entitled && !softHoldPastDue ? (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            {onManage
              ? 'Choose a package below to unlock venues, catalog tools, team seats, role templates, campaigns, and more.'
              : 'Ask your company platform admin to subscribe before the team can create venues or other capped resources.'}
          </p>
        ) : null}
        {entitled && overLimit.length > 0 ? (
          <p className="text-sm text-amber-950 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Over plan limit on {overLimit.join(', ')}. Existing data is kept; new
            creates stay blocked until you upgrade or remove / archive items
            (including venues).
          </p>
        ) : null}
        {billing.pastDue ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {softHoldPastDue
              ? 'Billing hold — renew before grace ends to avoid Demo demotion. Records stay intact either way.'
              : onManage
                ? 'Payment past due. Update your payment method in Manage billing. Admin access stays open during Stripe past_due; unresolved failure leads to soft-hold then Demo after grace.'
                : 'Payment past due. Ask your company platform admin to update the payment method.'}
          </p>
        ) : null}
      </section>
    </section>
  );
}
