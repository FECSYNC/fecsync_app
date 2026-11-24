'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePublicAvailability,
  usePublicProducts,
  usePublicVenue,
} from '@/hooks/usePublicBooking';
import { createPublicHold } from '@/services/publicBooking';
import { isValidId } from '@/lib/ids';
import {
  bookFlowPaths,
  type CompanyBookContext,
} from '@/lib/ticketing/publicBookPaths';
import { bookBtn, bookField, formatMoney } from './bookingUi';
import BookingDateCalendar, {
  dateKeyFromIso,
  monthRangeKeys,
} from './BookingDateCalendar';
import BookingGuestAssist from './BookingGuestAssist';
import SessionAvailabilityList from '@/components/common/SessionAvailabilityList';

export default function ProductBookPage({
  orgSlug,
  venueSlug,
  productId,
  partyMode = false,
  company,
  allowedProductIds,
}: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  partyMode?: boolean;
  /** Company category site: links stay on /{orgSlug}/{categorySlug}. */
  company?: CompanyBookContext;
  /** Limits the product and alternatives to these ids (company category). */
  allowedProductIds?: string[];
}) {
  const paths = bookFlowPaths(venueSlug, company);
  const allowed = useMemo(
    () => (allowedProductIds ? new Set(allowedProductIds) : null),
    [allowedProductIds]
  );
  const router = useRouter();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const [date, setDate] = useState(
    sp.get('date') || new Date().toISOString().slice(0, 10)
  );
  const [qty, setQty] = useState(Math.max(1, Number(sp.get('qty') || 1)));
  const [sessionId, setSessionId] = useState(sp.get('sessionId') || '');
  const [band, setBand] = useState('');
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const [assistHint, setAssistHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const seed = sp.get('date') || new Date().toISOString().slice(0, 10);
    const d = new Date(`${seed}T12:00:00`);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const venueQ = usePublicVenue(orgSlug, venueSlug);
  const productsQ = usePublicProducts(orgSlug, venueSlug);
  const product = (productsQ.data ?? []).find(
    (p) => p.id === productId && (!allowed || allowed.has(p.id))
  );
  const tz = venueQ.data?.timezone;
  const timeFormat = venueQ.data?.timeFormat;

  const monthRange = useMemo(
    () =>
      monthRangeKeys(calendarMonth.getFullYear(), calendarMonth.getMonth()),
    [calendarMonth]
  );

  const monthAvailQ = usePublicAvailability(productId, undefined, qty, {
    from: monthRange.from,
    to: monthRange.to,
  });
  const dayAvailQ = usePublicAvailability(productId, date, qty);
  const sessions = dayAvailQ.data ?? [];

  const needsSlot = useMemo(() => {
    const t = product?.type;
    if (t === 'timed_session' || t === 'party_package' || t === 'camp_event') {
      return true;
    }
    if (t === 'group') {
      return (
        !monthAvailQ.isLoading && (monthAvailQ.data?.length ?? 0) > 0
      );
    }
    return false;
  }, [product?.type, monthAvailQ.isLoading, monthAvailQ.data]);

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of monthAvailQ.data ?? []) {
      const key = dateKeyFromIso(s.startsAt, tz);
      if (key) set.add(key);
    }
    return set;
  }, [monthAvailQ.data, tz]);

  const bookableDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of monthAvailQ.data ?? []) {
      if (s.availableForQty === false) continue;
      const key = dateKeyFromIso(s.startsAt, tz);
      if (key) set.add(key);
    }
    return set;
  }, [monthAvailQ.data, tz]);

  const sessionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthAvailQ.data ?? []) {
      const key = dateKeyFromIso(s.startsAt, tz);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [monthAvailQ.data, tz]);

  const dayHints = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of monthAvailQ.data ?? []) {
      const key = dateKeyFromIso(s.startsAt, tz);
      if (!key || s.priceOverride == null) continue;
      const label = formatMoney(s.priceOverride, s.currency);
      const prev = map.get(key);
      if (!prev) map.set(key, `From ${label}`);
    }
    return map;
  }, [monthAvailQ.data, tz]);

  const selectedSession = sessions.find((s) => s.id === sessionId);
  const slotHasFlatPrice =
    selectedSession?.priceOverride != null &&
    selectedSession.priceOverride > 0;

  const resolvedAddons = useMemo(() => {
    const map: Record<string, number> = { ...addonQty };
    for (const a of product?.addOns ?? []) {
      if (map[a.id] == null) map[a.id] = a.required ? 1 : 0;
    }
    return map;
  }, [addonQty, product?.addOns]);

  // Keep selected session valid when date/qty changes.
  useEffect(() => {
    if (!needsSlot) return;
    if (
      sessionId &&
      sessions.some((s) => s.id === sessionId && s.availableForQty !== false)
    ) {
      return;
    }
    const first = sessions.find(
      (s) => s.availableForQty !== false && s.remaining > 0
    );
    setSessionId(first?.id ?? '');
  }, [needsSlot, sessions, sessionId]);

  // Pin price band to a real product band (prefer adult).
  useEffect(() => {
    const prices = product?.prices ?? [];
    if (!prices.length) {
      if (band) setBand('');
      return;
    }
    if (band && prices.some((p) => p.code === band)) return;
    const preferred =
      prices.find((p) => p.code.trim().toLowerCase() === 'adult') ?? prices[0];
    setBand(preferred.code);
  }, [product?.id, product?.prices, band]);

  async function onContinue(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setAssistHint(null);
    if (!product) return;
    if (product.minGuests != null && qty < product.minGuests) {
      setErr(`Minimum ${product.minGuests} guests`);
      return;
    }
    if (product.maxGuests != null && qty > product.maxGuests) {
      setErr(`Maximum ${product.maxGuests} guests`);
      return;
    }
    if (
      !slotHasFlatPrice &&
      (product.prices?.length ?? 0) > 0 &&
      !band.trim()
    ) {
      setErr('Select a price band before continuing');
      return;
    }
    for (const a of product.addOns ?? []) {
      const n = resolvedAddons[a.id] ?? 0;
      if (a.required && n < 1) {
        setErr(`${a.name} is required`);
        return;
      }
    }
    setBusy(true);
    try {
      const q = new URLSearchParams({
        productId,
        qty: String(qty),
        date,
        channel: 'online',
      });
      if (!slotHasFlatPrice && band) q.set('priceBandCode', band);
      if (needsSlot) {
        const sid = sessionId || sessions[0]?.id;
        if (!sid) {
          setAssistHint(
            'That day is full or not scheduled yet — try another time below, or send a special request.'
          );
          setBusy(false);
          return;
        }
        const hold = await createPublicHold({
          orgSlug,
          venueSlug,
          productId,
          sessionId: sid,
          qty,
        });
        void qc.invalidateQueries({ queryKey: ['public', 'booking'] });
        q.set('holdId', hold.holdId);
        q.set('holdToken', hold.token);
        q.set('sessionId', sid);
        q.set('expiresAt', hold.expiresAt);
        const slot = sessions.find((s) => s.id === sid);
        if (slot?.label) q.set('slotLabel', slot.label);
        if (slot?.startsAt) q.set('slotStartsAt', slot.startsAt);
        if (slot?.endsAt) q.set('slotEndsAt', slot.endsAt);
        if (slot?.priceOverride != null && slot.priceOverride > 0) {
          q.set('slotPrice', String(slot.priceOverride));
          q.set('slotCurrency', slot.currency || 'USD');
        }
      }
      const addonParts = Object.entries(resolvedAddons)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `${id}:${n}`);
      if (addonParts.length) q.set('addons', addonParts.join(','));
      if (company?.embed) q.set('embed', '1');
      router.push(`${paths.checkout}?${q.toString()}`);
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : 'Could not hold seats';
      const busySlot =
        /sold out|remaining|capacity|hold|conflict|409|taken/i.test(msg);
      if (busySlot) {
        setAssistHint(
          'Someone else just took or is holding that slot. Seats update live — please choose another option below. We are happy to help with a special request too.'
        );
        void qc.invalidateQueries({ queryKey: ['public', 'booking'] });
        setSessionId('');
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!product && !productsQ.isLoading) {
    const badId = !isValidId(productId);
    return (
      <div className="mx-auto max-w-xl space-y-3 p-8">
        <h1 className="text-xl font-semibold text-stone-900">
          Product not found
        </h1>
        <p className="text-sm text-stone-600">
          {badId
            ? 'This booking link is missing a valid product id. Open the venue page and choose a ticket from the list.'
            : 'This ticket is not published for online booking, or it does not belong to this venue.'}
        </p>
        <Link
          href={paths.home}
          className="inline-block text-sm font-medium text-[#D4AF37] hover:underline"
        >
          {company ? '← Back' : '← Back to venue tickets'}
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <p className="text-xs uppercase tracking-wide text-[#D4AF37]">
        {partyMode ? 'Party' : venueQ.data?.name}
      </p>
      <h1 className="text-2xl font-semibold">{product?.name ?? '…'}</h1>
      <p className="text-sm text-stone-600">{product?.description}</p>
      {product?.type === 'group' ? (
        <p className="text-sm text-stone-700">
          Group booking
          {product.minGuests != null || product.maxGuests != null
            ? ` · ${product.minGuests ?? 1}–${product.maxGuests ?? '∞'} guests`
            : ''}
        </p>
      ) : null}
      {product?.type === 'camp_event' ? (
        <p className="text-sm text-stone-700">
          Camp / event — pick an event date and available session below.
        </p>
      ) : null}
      {product?.type === 'day_pass' ? (
        <p className="text-sm text-stone-700">
          Day pass — choose visit date and quantity.
        </p>
      ) : null}
      {product?.type === 'timed_session' ? (
        <p className="text-sm text-stone-700">
          Timed entry — choose a date on the calendar, then a time slot.
        </p>
      ) : null}
      {product?.priceFrom != null ? (
        <p className="font-medium">From {formatMoney(product.priceFrom)}</p>
      ) : null}

      <form
        onSubmit={onContinue}
        className="space-y-4 rounded-xl border border-stone-200 bg-white p-5"
      >
        {needsSlot ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-stone-800">Choose a date</p>
            <p className="text-xs text-stone-500">
              Tap Today or Tomorrow, or pick any highlighted day. Gold means
              seats are open; amber means the day is scheduled but currently
              held or full.
            </p>
            {monthAvailQ.isLoading && !monthAvailQ.data ? (
              <div
                className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-600"
                role="status"
              >
                <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
                Loading calendar…
              </div>
            ) : (
              <BookingDateCalendar
                month={calendarMonth}
                onMonthChange={(m) => {
                  setCalendarMonth(m);
                }}
                selectedDate={date}
                onSelectDate={(key) => {
                  setDate(key);
                  setSessionId('');
                }}
                availableDays={availableDays}
                bookableDays={bookableDays}
                sessionCounts={sessionCounts}
                dayHints={dayHints}
                timezone={tz}
              />
            )}
          </div>
        ) : (
          <label className="block text-sm">
            Date
            <input
              type="date"
              className={`${bookField} mt-1`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}

        <label className="block text-sm">
          Quantity / guests
          <input
            type="number"
            min={product?.minGuests ?? 1}
            max={product?.maxGuests ?? 99}
            className={`${bookField} mt-1`}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </label>

        {needsSlot ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Time slots</legend>
            <p className="text-xs text-stone-500">
              All named slots for this day. Unpaid holds free seats when they
              expire; paid bookings stay taken.
            </p>
            {dayAvailQ.isLoading ? (
              <div
                className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-600"
                role="status"
              >
                <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
                Loading slots…
              </div>
            ) : (
              <SessionAvailabilityList
                sessions={sessions}
                selectedId={sessionId}
                onSelect={setSessionId}
                timeFormat={timeFormat}
                timeZone={tz}
                priceLabelFor={(s) =>
                  s.priceOverride != null && s.priceOverride > 0
                    ? formatMoney(s.priceOverride, s.currency ?? undefined)
                    : product?.priceFrom != null
                      ? `From ${formatMoney(product.priceFrom)}`
                      : null
                }
              />
            )}
          </fieldset>
        ) : (
          <p className="text-sm text-stone-500">
            {product?.type === 'day_pass'
              ? 'Day pass — pick a date and quantity (no timed slot).'
              : 'Open date — pick a date and quantity.'}
          </p>
        )}

        {slotHasFlatPrice ? (
          <div className="rounded-md border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-2 text-sm text-stone-800">
            This timeslot uses a special price:{' '}
            <span className="font-semibold">
              {formatMoney(
                selectedSession!.priceOverride!,
                selectedSession!.currency
              )}
            </span>{' '}
            per guest (overrides adult/child bands for this slot).
          </div>
        ) : product?.prices?.length ? (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Price band</legend>
            <p className="text-xs text-stone-500">
              Sets the ticket rate only — you are not charged until checkout
              payment succeeds.
            </p>
            <div className="space-y-1.5">
              {product.prices.map((pr) => {
                const active = band === pr.code;
                return (
                  <label
                    key={pr.code}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                      active
                        ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                        : 'border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="priceBand"
                        checked={active}
                        onChange={() => setBand(pr.code)}
                      />
                      <span className="font-medium capitalize">{pr.code}</span>
                    </span>
                    <span className="font-semibold">
                      {formatMoney(pr.amount, pr.currency)}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {product?.type === 'group' &&
        (product.minGuests != null || product.maxGuests != null) ? (
          <p className="text-xs text-stone-500">
            Required party size: {product.minGuests ?? 1}
            {product.maxGuests != null ? `–${product.maxGuests}` : '+'} guests
          </p>
        ) : null}

        {(product?.addOns?.length ?? 0) > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Add-ons</legend>
            {product!.addOns!.map((a) => (
              <label
                key={a.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {a.name}
                  {a.required ? ' (required)' : ''}
                  {a.priceFrom != null ? ` · ${formatMoney(a.priceFrom)}` : ''}
                </span>
                <input
                  type="number"
                  min={a.required ? 1 : 0}
                  max={a.maxQty ?? 99}
                  className={`${bookField} w-20`}
                  value={resolvedAddons[a.id] ?? (a.required ? 1 : 0)}
                  onChange={(e) =>
                    setAddonQty((prev) => ({
                      ...prev,
                      [a.id]: Number(e.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        {err ? <p className="text-sm text-red-700">{err}</p> : null}
        <button type="submit" className={bookBtn} disabled={busy}>
          {busy ? 'Holding…' : 'Continue to checkout'}
        </button>
      </form>

      <BookingGuestAssist
        orgSlug={orgSlug}
        venueSlug={venueSlug}
        productId={productId}
        productName={product?.name}
        date={date}
        qty={qty}
        timezone={tz}
        timeFormat={timeFormat}
        sameDaySessions={sessions.filter((s) => s.id !== sessionId)}
        monthSessions={monthAvailQ.data ?? []}
        otherProducts={(productsQ.data ?? []).filter(
          (p) =>
            p.id !== productId &&
            p.type !== 'add_on' &&
            !p.soldOut &&
            (!allowed || allowed.has(p.id))
        )}
        productHref={company ? paths.product : undefined}
        onPickDate={(key) => {
          setDate(key);
          setSessionId('');
          setAssistHint(null);
          const d = new Date(`${key}T12:00:00`);
          setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
        }}
        onPickSession={(id) => {
          setSessionId(id);
          setAssistHint(null);
        }}
        showAlternatives={
          Boolean(assistHint) ||
          (needsSlot && !dayAvailQ.isLoading && sessions.length === 0)
        }
        conflictMessage={assistHint}
      />
    </main>
  );
}
