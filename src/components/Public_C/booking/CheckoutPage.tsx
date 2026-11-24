'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  beginPublicPayNow,
  companyCategoryCheckout,
  publicCheckout,
  releasePublicHold,
  type CompanyCheckoutResultDto,
} from '@/services/publicBooking';
import { usePublicProducts, usePublicVenue } from '@/hooks/usePublicBooking';
import {
  bookFlowPaths,
  type CompanyBookContext,
} from '@/lib/ticketing/publicBookPaths';
import { bookBtn, bookBtnGhost, bookField, formatMoney, formatWhen, HoldCountdown } from './bookingUi';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';
import { companySitePaths } from '@/lib/publicCategory/sitePaths';
import { embedParentOrigin } from '@/lib/publicCategory/embedParent';
import { guestSafeParkPayoutsMessage } from '@/lib/marketplace/guestParkPayoutsMessage';
import CompanyEmbeddedCheckout from './CompanyEmbeddedCheckout';

export default function CheckoutPage({
  orgSlug,
  venueSlug,
  company,
}: {
  orgSlug: string;
  venueSlug: string;
  /** Company category site: embedded Checkout, no viewToken in any URL. */
  company?: CompanyBookContext;
}) {
  const paths = bookFlowPaths(venueSlug, company);
  const [embedded, setEmbedded] =
    useState<NonNullable<CompanyCheckoutResultDto['payment']> | null>(null);
  const [done, setDone] = useState<CompanyCheckoutResultDto['booking'] | null>(
    null
  );
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const venueQ = usePublicVenue(orgSlug, venueSlug);
  const productsQ = usePublicProducts(orgSlug, venueSlug);
  const holdId = sp.get('holdId') || '';
  const holdToken = sp.get('holdToken') || '';
  const productId = sp.get('productId') || '';
  const sessionId = sp.get('sessionId') || '';
  const qty = Math.max(1, Number(sp.get('qty') || 1));
  const expiresAt = sp.get('expiresAt') || '';
  const date = sp.get('date') || undefined;
  const priceBandCode = sp.get('priceBandCode') || undefined;
  const slotPriceRaw = sp.get('slotPrice');
  const slotPrice =
    slotPriceRaw != null && slotPriceRaw !== ''
      ? Number(slotPriceRaw)
      : null;
  const slotCurrency = sp.get('slotCurrency') || 'USD';
  const slotLabel = sp.get('slotLabel') || '';
  const slotStartsAt = sp.get('slotStartsAt') || '';
  const slotEndsAt = sp.get('slotEndsAt') || '';
  const addonRaw = sp.get('addons') || '';
  const addonLines = addonRaw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [id, n] = p.split(':');
      return { productId: id, qty: Math.max(1, Number(n) || 1) };
    })
    .filter((l) => l.productId);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [payLater, setPayLater] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      const u = user as {
        firstName?: string;
        lastName?: string;
        username?: string;
        email?: string;
        phone?: string | null;
      };
      setName([u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '');
      setEmail(u.email || '');
      setPhone(typeof u.phone === 'string' ? u.phone : '');
    }
  }, [user]);

  const products = productsQ.data ?? [];
  const main = products.find((p) => p.id === productId);
  const summary = useMemo(() => {
    const lines: { label: string; qty: number; unit: number | null }[] = [];
    if (main) {
      const band = priceBandCode
        ? main.prices.find((pr) => pr.code === priceBandCode)
        : null;
      const unit =
        slotPrice != null && Number.isFinite(slotPrice) && slotPrice > 0
          ? slotPrice
          : (band?.amount ?? main.priceFrom);
      lines.push({
        label:
          slotPrice != null && Number.isFinite(slotPrice) && slotPrice > 0
            ? `${main.name} (timeslot price)`
            : band
              ? `${main.name} (${band.code})`
              : main.name,
        qty,
        unit,
      });
    }
    for (const a of addonLines) {
      const p = products.find((x) => x.id === a.productId);
      const fromAddon = main?.addOns?.find((x) => x.id === a.productId);
      lines.push({
        label: p?.name ?? fromAddon?.name ?? 'Add-on',
        qty: a.qty,
        unit: p?.priceFrom ?? fromAddon?.priceFrom ?? null,
      });
    }
    const subtotal = lines.reduce(
      (sum, l) => sum + (l.unit != null ? l.unit * l.qty : 0),
      0
    );
    return { lines, subtotal, currency: slotCurrency };
  }, [main, products, qty, priceBandCode, addonLines, slotPrice, slotCurrency]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim() || !email.trim()) {
      setErr('Name and email are required');
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setErr('Hold expired — go back and select a slot again');
      return;
    }
    setBusy(true);
    if (company) {
      try {
        const result = await companyCategoryCheckout(
          company.orgSlug,
          company.categorySlug,
          {
            productId,
            holdId: holdId || undefined,
            holdToken: holdToken || undefined,
            priceBandCode: priceBandCode || undefined,
            lines:
              holdId || holdToken
                ? [
                    { productId, qty, priceBandCode, sessionId: sessionId || undefined },
                    ...addonLines,
                  ]
                : [
                    {
                      productId,
                      sessionId: sessionId || undefined,
                      qty,
                      priceBandCode,
                      visitDate: date,
                    },
                    ...addonLines,
                  ],
            primaryContactName: name.trim(),
            primaryContactEmail: email.trim(),
            primaryContactPhone: phone.trim() || undefined,
            payLater,
            ...(company.embed
              ? { embed: true, embedOrigin: embedParentOrigin() ?? undefined }
              : {}),
          }
        );
        invalidateAfterBookingMutation(qc);
        if (result.payment) setEmbedded(result.payment);
        else setDone(result.booking);
      } catch (ex) {
        const raw = ex instanceof Error ? ex.message : 'Checkout failed';
        setErr(guestSafeParkPayoutsMessage(raw));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const booking = await publicCheckout({
        orgSlug,
        venueSlug,
        holdId: holdId || undefined,
        holdToken: holdToken || undefined,
        priceBandCode: priceBandCode || undefined,
        lines:
          holdId || holdToken
            ? [
                ...(productId
                  ? [
                      {
                        productId,
                        qty,
                        priceBandCode,
                        sessionId: sessionId || undefined,
                      },
                    ]
                  : []),
                ...addonLines,
              ]
            : productId
              ? [
                  {
                    productId,
                    sessionId: sessionId || undefined,
                    qty,
                    priceBandCode,
                    visitDate: date,
                  },
                  ...addonLines,
                ]
              : addonLines.length
                ? addonLines
                : undefined,
        primaryContactName: name.trim(),
        primaryContactEmail: email.trim(),
        primaryContactPhone: phone.trim() || undefined,
        payLater,
      });
      invalidateAfterBookingMutation(qc);
      const token = booking.viewToken || '';
      if (!payLater && booking.amountDue > 0) {
        const pay = await beginPublicPayNow(booking.publicId, token);
        if (pay.checkoutUrl) {
          window.location.href = pay.checkoutUrl;
          return;
        }
      }
      router.push(
        `/booking/confirmation/${booking.publicId}?viewToken=${encodeURIComponent(token)}`
      );
    } catch (ex) {
      const raw = ex instanceof Error ? ex.message : 'Checkout failed';
      setErr(guestSafeParkPayoutsMessage(raw));
    } finally {
      setBusy(false);
    }
  }

  const allowLater = Boolean(venueQ.data?.allowOnlinePayLater);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      {!company ? (
        <p className="text-sm text-stone-600">
          Admission only — no shipping, and this is not mixed with the fashion shop cart.
        </p>
      ) : null}
      {expiresAt && !done ? (
        <HoldCountdown
          expiresAt={expiresAt}
          restartHref={productId ? paths.product(productId) : paths.home}
          onExpired={
            holdId && holdToken && !embedded
              ? () => {
                  void releasePublicHold(holdId, holdToken)
                    .then(() => {
                      invalidateAfterBookingMutation(qc);
                    })
                    .catch(() => undefined);
                }
              : undefined
          }
        />
      ) : null}

      <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <h2 className="font-semibold text-stone-900">Order summary</h2>
        {date ? <p className="mt-1 text-stone-500">Visit {date}</p> : null}
        {slotLabel || slotStartsAt ? (
          <p className="mt-1 text-stone-700">
            {slotLabel ? `${slotLabel} ` : 'Slot '}
            {slotStartsAt
              ? `(${formatWhen(slotStartsAt, venueQ.data?.timezone, venueQ.data?.timeFormat)}${
                  slotEndsAt
                    ? ` – ${formatWhen(slotEndsAt, venueQ.data?.timezone, venueQ.data?.timeFormat)}`
                    : ''
                })`
              : ''}
          </p>
        ) : null}
        <ul className="mt-3 divide-y divide-stone-100">
          {summary.lines.length === 0 ? (
            <li className="py-2 text-stone-500">Lines finalize when you submit.</li>
          ) : (
            summary.lines.map((l, i) => (
              <li key={`${l.label}-${i}`} className="flex justify-between gap-3 py-2">
                <span>
                  {l.label} × {l.qty}
                </span>
                <span>
                  {l.unit != null
                    ? formatMoney(l.unit * l.qty, summary.currency)
                    : '—'}
                </span>
              </li>
            ))
          )}
        </ul>
        <div className="mt-3 flex justify-between border-t border-stone-100 pt-3 font-medium">
          <span>Subtotal (est.)</span>
          <span>{formatMoney(summary.subtotal, summary.currency)}</span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          Tax is calculated at payment. No shipping charges.
        </p>
      </div>

      {company && embedded ? (
        <CompanyEmbeddedCheckout
          payment={embedded}
          cancelHref={
            companySitePaths(company.orgSlug, company.categorySlug, {
              embed: company.embed,
            }).cancel
          }
        />
      ) : company && done ? (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-semibold text-stone-900">
            {done.status === 'confirmed' ? 'Booking confirmed' : 'Booking received'}
          </h2>
          <p className="text-stone-700">
            Reference <span className="font-mono font-semibold">{done.publicId}</span>
          </p>
          {done.amountDue > 0 ? (
            <p className="text-stone-600">
              Amount due {formatMoney(done.amountDue, summary.currency)} — pay at the venue or from your confirmation email.
            </p>
          ) : null}
          <p className="text-stone-600">
            {done.primaryContactEmail
              ? `A confirmation was sent to ${done.primaryContactEmail}.`
              : 'Check your email for confirmation.'}
          </p>
          <a href={paths.home} className="inline-block font-medium text-[#D4AF37] hover:underline">
            ← Back
          </a>
        </div>
      ) : (
      <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <input className={bookField} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={bookField} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={bookField} placeholder="Phone (optional SMS)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {allowLater ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={payLater} onChange={(e) => setPayLater(e.target.checked)} />
            Pay later
          </label>
        ) : null}
        {err ? <p className="text-sm text-red-700">{err}</p> : null}
        <div className="flex gap-2">
          <button type="submit" className={bookBtn} disabled={busy}>
            {busy ? 'Working…' : payLater ? 'Complete booking' : 'Pay now'}
          </button>
          <button
            type="button"
            className={bookBtnGhost}
            onClick={() => router.back()}
          >
            Back
          </button>
        </div>
      </form>
      )}
    </main>
  );
}
