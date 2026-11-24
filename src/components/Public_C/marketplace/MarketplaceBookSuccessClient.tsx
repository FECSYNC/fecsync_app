'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';
import { clearMarketplaceCheckoutIdempotencyKey } from '@/components/Public_C/marketplace/marketplaceCheckoutIdempotency';
import { invalidateMarketplacePayoutQueries } from '@/utils/invalidateMarketplacePayoutQueries';
import { broadcastMarketplacePayoutsChange } from '@/utils/marketplacePayoutsSync';

/** Cross-tab bump so an open /admin/payouts ledger refetches after guest pay. */
export const MARKETPLACE_LEDGER_BUMP_KEY = 'fecsync:marketplace-ledger-bump';

export function bumpMarketplaceLedgerCaches(
  queryClient?: QueryClient | null,
  opts?: { orgId?: string | null }
) {
  if (queryClient) {
    invalidateMarketplacePayoutQueries(queryClient, {
      orgId: opts?.orgId,
      broadcast: Boolean(opts?.orgId),
    });
  } else if (opts?.orgId) {
    broadcastMarketplacePayoutsChange({
      orgId: opts.orgId,
      reason: 'guest-checkout',
    });
  }
  try {
    localStorage.setItem(MARKETPLACE_LEDGER_BUMP_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

type PublicSessionBooking = {
  status: string;
  packageTitle: string;
  packageSlug: string;
  orgSlug: string;
  customerEmail: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
};

function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'pending_payment':
      return 'Confirming payment…';
    case 'failed':
      return 'Payment failed';
    case 'cancelled':
      return 'Checkout cancelled';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partially refunded';
    case 'disputed':
      return 'Under review';
    default:
      return status;
  }
}

export default function MarketplaceBookSuccessClient({
  orgSlug,
  packageSlug,
}: {
  orgSlug: string;
  packageSlug: string;
}) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const sessionId = searchParams.get('session_id');
  const [booking, setBooking] = useState<PublicSessionBooking | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clearMarketplaceCheckoutIdempotencyKey(orgSlug, packageSlug);
  }, [orgSlug, packageSlug]);

  useEffect(() => {
    if (!sessionId?.trim()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 6;
    let bumpedPaid = false;

    const load = async () => {
      try {
        const raw = await api<MaybeWrapped<{ booking: PublicSessionBooking }>>(
          `/api/public/marketplace/checkout-session/${encodeURIComponent(sessionId)}`
        );
        if (cancelled) return;
        const row = unwrap(raw)?.booking;
        if (!row) throw new Error('Session not found');
        setBooking(row);
        setError(null);
        // Webhook may lag — poll briefly while still pending.
        if (row.status === 'pending_payment' && attempts < maxAttempts) {
          attempts += 1;
          window.setTimeout(() => {
            if (!cancelled) void load();
          }, 1500);
          return;
        }
        if (
          !bumpedPaid &&
          (row.status === 'paid' ||
            row.status === 'partially_refunded' ||
            row.status === 'refunded')
        ) {
          bumpedPaid = true;
          bumpMarketplaceLedgerCaches(queryClient);
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (attempts < maxAttempts) {
          attempts += 1;
          window.setTimeout(() => {
            if (!cancelled) void load();
          }, 1500);
          return;
        }
        setError(
          err instanceof Error && err.message.trim()
            ? err.message
            : 'Could not load booking status'
        );
        setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, queryClient]);

  const backHref = `/book/${encodeURIComponent(orgSlug)}/${encodeURIComponent(packageSlug)}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
      <h1 className="text-2xl font-bold text-stone-900">Checkout submitted</h1>
      {loading ? (
        <p className="text-sm text-stone-600">Checking payment status…</p>
      ) : booking ? (
        <div className="space-y-2 text-sm text-stone-700">
          <p className="font-semibold text-stone-900">
            {statusLabel(booking.status)}
          </p>
          <p>{booking.packageTitle}</p>
          <p>
            {formatMoney(booking.amountMinor, booking.currency)}
            {booking.customerEmail ? ` · ${booking.customerEmail}` : ''}
          </p>
          {booking.status === 'pending_payment' ? (
            <p className="text-stone-500">
              Final paid status comes from our payment webhook. This page is
              read-only and does not alone mark the booking paid.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-stone-600">
          {error ||
            'Thanks — if payment succeeded, your booking will confirm shortly. Final paid status comes from our payment webhook (this page is read-only and does not alone mark the booking paid).'}
        </p>
      )}
      {sessionId ? (
        <p className="text-xs text-stone-400 font-mono break-all">
          Session: {sessionId}
        </p>
      ) : null}
      <Link
        href={backHref}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-400"
      >
        Back to package
      </Link>
    </div>
  );
}
