'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCreatePublicPartyHoldMutation,
  usePublicPartyAvailabilityQuery,
  usePublicPartyCheckoutMutation,
  usePublicPartyPackagesQuery,
} from '@/hooks/usePublicParties';
import { bookFlowPaths, type CompanyBookContext } from '@/lib/ticketing/publicBookPaths';
import { bookBtn, bookBtnGhost, bookField, HoldCountdown } from '../bookingUi';
import { centsLabel, formatInZone, partyErrorMessage, todayInZone } from '@/components/Protected/admin/pages/parties/partyFormat';

type Hold = { holdId: string; token: string; expiresAt: string };

/**
 * Public party booking (one hold engine, one checkout engine via /api/public/parties/*).
 * Room availability is resolved server-side; tax and the final deposit come from checkout.
 */
export default function PublicPartyBookPage({
  orgSlug,
  venueSlug,
  productId,
  company,
}: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  company?: CompanyBookContext;
}) {
  const router = useRouter();
  const paths = bookFlowPaths(venueSlug, company);
  const pkgsQ = usePublicPartyPackagesQuery(orgSlug, venueSlug);
  const pkg = (pkgsQ.data?.packages ?? []).find((p) => p.id === productId) ?? null;
  const tz = (pkgsQ.data?.venue?.timezone as string | undefined) ?? null;
  const venueName = (pkgsQ.data?.venue?.name as string | undefined) ?? '';

  const [dateTouched, setDateTouched] = useState(false);
  const [date, setDateRaw] = useState(() => todayInZone(tz));
  const setDate = (v: string) => {
    setDateTouched(true);
    setDateRaw(v);
  };
  useEffect(() => {
    if (!dateTouched && tz) setDateRaw(todayInZone(tz));
  }, [tz, dateTouched]);
  const [kids, setKids] = useState<number | null>(null);
  const [adults, setAdults] = useState<number | null>(null);
  const kidCount = kids ?? Math.max(1, pkg?.includedKids ?? 1);
  const adultCount = adults ?? pkg?.includedAdults ?? 0;
  const availQ = usePublicPartyAvailabilityQuery({
    orgSlug,
    venueSlug,
    productId,
    date,
    kids: kidCount,
    adults: adultCount,
  });
  const [sessionId, setSessionId] = useState('');
  const [hold, setHold] = useState<Hold | null>(null);
  const [addOns, setAddOns] = useState<Record<string, number>>({});
  const [partyName, setPartyName] = useState('');
  const [honoreeName, setHonoreeName] = useState('');
  const [honoreeAge, setHonoreeAge] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [payLater, setPayLater] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const holdMut = useCreatePublicPartyHoldMutation();
  const checkoutMut = usePublicPartyCheckoutMutation();

  const sessions = availQ.data?.sessions ?? [];
  const estimate = useMemo(() => {
    if (!pkg) return null;
    const extraKids = Math.max(0, kidCount - pkg.includedKids);
    const extraAdults = Math.max(0, adultCount - pkg.includedAdults);
    const addOnCents = pkg.addOns.reduce((s, a) => s + (a.priceCents ?? 0) * (addOns[a.productId] ?? 0), 0);
    const base = pkg.basePriceCents ?? 0;
    return {
      base,
      extraKids,
      extraAdults,
      extraKidCents: extraKids * (pkg.extraKidPriceCents ?? 0),
      extraAdultCents: extraAdults * (pkg.extraAdultPriceCents ?? 0),
      addOnCents,
      subtotal: base + extraKids * (pkg.extraKidPriceCents ?? 0) + extraAdults * (pkg.extraAdultPriceCents ?? 0) + addOnCents,
    };
  }, [pkg, kidCount, adultCount, addOns]);

  if (pkgsQ.isPending) return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-stone-500">Loading party package…</main>;
  if (!pkg) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-10">
        <h1 className="text-2xl font-semibold">Party package not available</h1>
        <p className="text-sm text-stone-600">{pkgsQ.error ? partyErrorMessage(pkgsQ.error) : 'This party package is not open for online booking.'}</p>
        <Link href={paths.home} className="text-sm font-semibold text-[#D4AF37] underline">
          Back to bookings
        </Link>
      </main>
    );
  }
  if (pkgsQ.data && !pkgsQ.data.allowOnlinePartyBooking) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-10">
        <h1 className="text-2xl font-semibold">{pkg.name}</h1>
        <p className="text-sm text-stone-600">Online party booking is closed for this venue. Please call the venue to book.</p>
      </main>
    );
  }

  async function chooseSlot(id: string) {
    setErr(null);
    setSessionId(id);
    try {
      const h = await holdMut.mutateAsync({ orgSlug, venueSlug, productId, sessionId: id });
      setHold(h);
    } catch (e) {
      setHold(null);
      setErr(partyErrorMessage(e, 'That slot could not be held'));
    }
  }

  async function onCheckout(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!hold) {
      setErr('Choose a time slot first.');
      return;
    }
    try {
      const res = await checkoutMut.mutateAsync({
        orgSlug,
        venueSlug,
        holdId: hold.holdId,
        holdToken: hold.token,
        kidCount,
        adultCount,
        partyName: partyName.trim(),
        honoreeName: honoreeName.trim() || null,
        honoreeAge: honoreeAge === '' ? null : Number(honoreeAge),
        contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() || null },
        addOns: Object.entries(addOns)
          .filter(([, q]) => q > 0)
          .map(([pid, qty]) => ({ productId: pid, qty })),
        payLater,
      });
      if (res.payment?.checkoutUrl) {
        window.location.assign(res.payment.checkoutUrl);
        return;
      }
      router.push(`/booking/confirmation/${encodeURIComponent(res.bookingPublicId)}?viewToken=${encodeURIComponent(res.viewToken)}`);
    } catch (e2) {
      setErr(partyErrorMessage(e2, 'Checkout failed'));
    }
  }

  const countsOk = availQ.data?.countsOk ?? true;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <Link href={paths.home} className="text-sm text-stone-500 hover:text-[#D4AF37]">
          ← {venueName || 'Bookings'}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">{pkg.name}</h1>
        {pkg.description ? <p className="mt-2 text-sm text-stone-600">{pkg.description}</p> : null}
        <p className="mt-2 text-sm text-stone-700">
          {centsLabel(pkg.basePriceCents)} · includes {pkg.includedKids} kids and {pkg.includedAdults} adults · {pkg.durationMinutes} minutes
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">1. Guests</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>
            <span className="mb-1 block text-xs uppercase text-stone-500">Kids</span>
            <input type="number" min={0} className={bookField} value={kidCount} onChange={(e) => { setKids(Math.max(0, Number(e.target.value) || 0)); setHold(null); setSessionId(''); }} />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-stone-500">Adults</span>
            <input type="number" min={0} className={bookField} value={adultCount} onChange={(e) => { setAdults(Math.max(0, Number(e.target.value) || 0)); setHold(null); setSessionId(''); }} />
          </label>
        </div>
        <p className="text-xs text-stone-500">
          {pkg.extraKidPriceCents != null ? `Extra kids ${centsLabel(pkg.extraKidPriceCents)} each. ` : ''}
          {pkg.extraAdultPriceCents != null ? `Extra adults ${centsLabel(pkg.extraAdultPriceCents)} each. ` : ''}
          {pkg.maxGuests ? `Up to ${pkg.maxGuests} guests.` : ''}
        </p>
        {!countsOk ? <p className="text-sm font-medium text-red-700">{partyErrorMessage('PARTY_COUNTS_INVALID')}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">2. Date and time</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Date{tz ? ` (${tz})` : ''}</span>
          <input type="date" className={`${bookField} w-auto`} value={date} min={todayInZone(tz)} onChange={(e) => { setDate(e.target.value); setHold(null); setSessionId(''); }} />
        </label>
        {availQ.isPending ? (
          <p className="text-sm text-stone-500">Checking availability…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-stone-600">No party times on this date. Try another day.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!s.bookable || holdMut.isPending}
                onClick={() => void chooseSlot(s.id)}
                className={`rounded-md border px-3 py-2 text-sm ${
                  sessionId === s.id ? 'border-[#D4AF37] bg-[#D4AF37]/15 font-semibold' : 'border-stone-300'
                } disabled:cursor-not-allowed disabled:text-stone-400`}
              >
                {formatInZone(s.startsAt, availQ.data?.timezone ?? tz, { hour: 'numeric', minute: '2-digit' })}
                {!s.bookable ? ' · full' : ''}
              </button>
            ))}
          </div>
        )}
        {hold ? <HoldCountdown expiresAt={hold.expiresAt} onExpired={() => setHold(null)} /> : null}
      </section>

      {pkg.addOns.length ? (
        <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold">3. Add-ons</h2>
          <ul className="space-y-2 text-sm">
            {pkg.addOns.map((a) => (
              <li key={a.productId} className="flex items-center justify-between gap-2">
                <span>
                  {a.name} <span className="text-stone-500">{centsLabel(a.priceCents)}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={a.maxQty ?? undefined}
                  className={`${bookField} w-20`}
                  value={addOns[a.productId] ?? 0}
                  onChange={(e) => setAddOns((p) => ({ ...p, [a.productId]: Math.max(0, Number(e.target.value) || 0) }))}
                  aria-label={`${a.name} quantity`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form onSubmit={onCheckout} className="space-y-4 rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <h2 className="text-lg font-semibold">{pkg.addOns.length ? '4' : '3'}. Party and contact</h2>
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-stone-500">Party name</span>
          <input className={bookField} required value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Maya's 7th birthday" />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <label>
            <span className="mb-1 block text-xs uppercase text-stone-500">Birthday child (optional)</span>
            <input className={bookField} value={honoreeName} onChange={(e) => setHonoreeName(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-stone-500">Turning</span>
            <input className={bookField} inputMode="numeric" value={honoreeAge} onChange={(e) => setHonoreeAge(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={bookField} required placeholder="Your name" value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />
          <input className={bookField} required type="email" placeholder="Email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />
          <input className={bookField} placeholder="Phone" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
        </div>

        {estimate ? (
          <div className="space-y-1 rounded-md bg-stone-50 p-3">
            <p className="flex justify-between"><span>Package</span><span>{centsLabel(estimate.base)}</span></p>
            {estimate.extraKids ? <p className="flex justify-between"><span>{estimate.extraKids} extra kids</span><span>{centsLabel(estimate.extraKidCents)}</span></p> : null}
            {estimate.extraAdults ? <p className="flex justify-between"><span>{estimate.extraAdults} extra adults</span><span>{centsLabel(estimate.extraAdultCents)}</span></p> : null}
            {estimate.addOnCents ? <p className="flex justify-between"><span>Add-ons</span><span>{centsLabel(estimate.addOnCents)}</span></p> : null}
            <p className="flex justify-between font-semibold"><span>Subtotal (before tax)</span><span>{centsLabel(estimate.subtotal)}</span></p>
            <p className="text-xs text-stone-500">
              Deposit from about {centsLabel(pkg.depositPreviewCents)}. Tax and the exact deposit are confirmed on the next screen.
            </p>
          </div>
        ) : null}

        {pkgsQ.data?.allowPayLater ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={payLater} onChange={(e) => setPayLater(e.target.checked)} />
            Reserve now and pay later
          </label>
        ) : null}

        {err ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{err}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={bookBtn} disabled={!hold || !countsOk || checkoutMut.isPending}>
            {checkoutMut.isPending ? 'Working…' : payLater ? 'Reserve party' : 'Pay deposit'}
          </button>
          <Link href={paths.home} className={bookBtnGhost}>
            Cancel
          </Link>
        </div>
        <p className="text-xs text-stone-500">No account needed. We&apos;ll email your confirmation and a link to manage your party.</p>
      </form>
    </main>
  );
}
