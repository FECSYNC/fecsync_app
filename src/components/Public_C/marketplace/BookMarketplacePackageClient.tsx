'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';
import { getOrCreateMarketplaceCheckoutIdempotencyKey, clearMarketplaceCheckoutIdempotencyKey } from '@/components/Public_C/marketplace/marketplaceCheckoutIdempotency';

type PublicPackagePayload = {
  org: { slug: string; name: string };
  package: {
    slug: string;
    title: string;
    description: string | null;
    amountMinor: number;
    currency: string;
    capacity: number | null;
    startsAt: string | null;
    endsAt: string | null;
  };
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

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

export default function BookMarketplacePackageClient({
  orgSlug,
  packageSlug,
}: {
  orgSlug: string;
  packageSlug: string;
}) {
  const [data, setData] = useState<PublicPackagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await api<MaybeWrapped<PublicPackagePayload>>(
        `/api/public/booking-packages/${encodeURIComponent(orgSlug)}/${encodeURIComponent(packageSlug)}`
      );
      const payload = unwrap(raw);
      if (!payload?.package || !payload?.org) {
        throw new Error('Package not available');
      }
      setData(payload);
    } catch (err) {
      setData(null);
      setError(errMessage(err, 'Package not found or not available'));
    } finally {
      setLoading(false);
    }
  }, [orgSlug, packageSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCheckout = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setCheckoutError(null);
    setBusy(true);
    try {
      const idempotencyKey = getOrCreateMarketplaceCheckoutIdempotencyKey(
        orgSlug,
        packageSlug
      );
      const raw = await api<MaybeWrapped<{ url: string }>>(
        `/api/public/booking-packages/${encodeURIComponent(orgSlug)}/${encodeURIComponent(packageSlug)}/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            name: name.trim() || undefined,
            idempotencyKey,
          }),
        }
      );
      const result = unwrap(raw);
      if (!result?.url) throw new Error('Checkout URL missing');
      window.location.href = result.url;
    } catch (err) {
      const msg = errMessage(err, 'Could not start checkout');
      // Prior key settled (paid/refunded) or stuck — mint a fresh seat attempt.
      if (/already paid/i.test(msg)) {
        clearMarketplaceCheckoutIdempotencyKey(orgSlug, packageSlug);
      }
      setCheckoutError(msg);
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-stone-900">Unavailable</h1>
        <p className="mt-2 text-sm text-stone-600">
          {error || 'This booking package is not available.'}
        </p>
      </div>
    );
  }

  const pkg = data.package;

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        {data.org.name}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-stone-900">{pkg.title}</h1>
      {pkg.description ? (
        <p className="mt-3 text-sm text-stone-600 whitespace-pre-wrap">
          {pkg.description}
        </p>
      ) : null}
      <p className="mt-6 text-2xl font-semibold text-stone-900">
        {formatMoney(pkg.amountMinor, pkg.currency)}
      </p>

      <form
        onSubmit={onCheckout}
        className="mt-8 space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label
            htmlFor="mp-email"
            className="block text-sm font-medium text-stone-700 mb-1.5"
          >
            Email
          </label>
          <input
            id="mp-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>
        <div>
          <label
            htmlFor="mp-name"
            className="block text-sm font-medium text-stone-700 mb-1.5"
          >
            Name (optional)
          </label>
          <input
            id="mp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>
        {checkoutError ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {checkoutError}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#D4AF37] text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
        >
          {busy ? 'Redirecting…' : 'Book & pay'}
        </button>
      </form>
    </div>
  );
}
