'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  submitPublicSpecialRequest,
  type PublicProductDto,
  type PublicSessionDto,
} from '@/services/publicBooking';
import { publicBookProductPath } from '@/lib/ticketing/publicBookPaths';
import { bookBtn, bookBtnGhost, bookField, formatMoney } from './bookingUi';
import { dateKeyFromIso } from './BookingDateCalendar';
import { formatClockTime } from '@/lib/timeClock';

type Props = {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  productName?: string;
  date: string;
  qty: number;
  timezone?: string | null;
  timeFormat?: string | null;
  /** Other open slots same day (excluding selected). */
  sameDaySessions: PublicSessionDto[];
  /** Month sessions used to suggest other days. */
  monthSessions: PublicSessionDto[];
  /** Other published packages at this venue. */
  otherProducts: PublicProductDto[];
  /** Defaults to /book/{venueSlug} product links. */
  productHref?: (productId: string, party: boolean) => string;
  onPickDate: (yyyyMmDd: string) => void;
  onPickSession: (sessionId: string) => void;
  showAlternatives: boolean;
  conflictMessage?: string | null;
};

/**
 * Friendly assist: alternatives when a slot is busy + special-request form.
 */
export default function BookingGuestAssist({
  orgSlug,
  venueSlug,
  productId,
  productName,
  date,
  qty,
  timezone,
  timeFormat,
  sameDaySessions,
  monthSessions,
  otherProducts,
  productHref,
  onPickDate,
  onPickSession,
  showAlternatives,
  conflictMessage,
}: Props) {
  const [openRequest, setOpenRequest] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const otherDays = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthSessions) {
      const key = dateKeyFromIso(s.startsAt, timezone);
      if (!key || key === date) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 6);
  }, [monthSessions, date, timezone]);

  const openSameDay = sameDaySessions.filter(
    (s) => s.availableForQty !== false && s.remaining >= qty
  );

  async function onSubmitRequest(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await submitPublicSpecialRequest({
        orgSlug,
        venueSlug,
        name,
        email,
        phone: phone || undefined,
        message:
          message.trim() ||
          `Looking for help with ${productName || 'a booking'} around ${date} for ${qty} guest(s).`,
        productId,
        preferredDate: date,
        qty,
      });
      setDone(res.message);
      setOpenRequest(false);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not send request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {conflictMessage ? (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          {conflictMessage}
        </div>
      ) : null}

      {showAlternatives ? (
        <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/80 p-4">
          <div>
            <p className="text-sm font-semibold text-stone-900">
              No worries — here are other options
            </p>
            <p className="mt-1 text-xs text-stone-600">
              That time may be held by another guest or already filled. Pick
              another slot, another day, or a different package — or send us a
              special request and we will help.
            </p>
          </div>

          {openSameDay.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Same day — other times
              </p>
              <div className="flex flex-wrap gap-2">
                {openSameDay.slice(0, 6).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={bookBtnGhost}
                    onClick={() => onPickSession(s.id)}
                  >
                    {s.label
                      ? `${s.label} (${formatClockTime(s.startsAt, timeFormat, timezone)})`
                      : formatClockTime(s.startsAt, timeFormat, timezone)}
                    {s.priceOverride != null && s.priceOverride > 0
                      ? ` · ${formatMoney(s.priceOverride, s.currency)}`
                      : ''}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {otherDays.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Other days with openings
              </p>
              <div className="flex flex-wrap gap-2">
                {otherDays.map(([key, count]) => (
                  <button
                    key={key}
                    type="button"
                    className={bookBtnGhost}
                    onClick={() => onPickDate(key)}
                  >
                    {key} · {count} slot{count === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {otherProducts.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Other packages at this venue
              </p>
              <ul className="space-y-2">
                {otherProducts.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={
                        productHref
                          ? productHref(p.id, p.type === 'party_package')
                          : publicBookProductPath(
                              venueSlug,
                              p.id,
                              p.type === 'party_package'
                            )
                      }
                      className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm hover:border-[#D4AF37]/60"
                    >
                      <span className="min-w-0 truncate font-medium text-stone-900">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-stone-600">
                        {p.priceFrom != null
                          ? formatMoney(p.priceFrom)
                          : 'View'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/10 p-4">
        <p className="text-sm font-semibold text-stone-900">
          Need something special?
        </p>
        <p className="mt-1 text-xs leading-relaxed text-stone-700">
          Larger groups, custom times, accessibility needs, or a private
          arrangement — tell the venue. Your request is sent to their team
          dashboard and email so they can follow up personally.
        </p>
        {done ? (
          <p className="mt-3 text-sm font-medium text-emerald-800">{done}</p>
        ) : openRequest ? (
          <form onSubmit={onSubmitRequest} className="mt-3 space-y-2">
            <input
              className={bookField}
              required
              minLength={2}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={bookField}
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className={bookField}
              type="tel"
              placeholder="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <textarea
              className={bookField}
              required
              minLength={8}
              rows={3}
              placeholder="Tell us what you need — party size, timing, celebration details…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {err ? <p className="text-sm text-red-700">{err}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={bookBtn} disabled={busy}>
                {busy ? 'Sending…' : 'Send special request'}
              </button>
              <button
                type="button"
                className={bookBtnGhost}
                onClick={() => setOpenRequest(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={`${bookBtn} mt-3`}
            onClick={() => setOpenRequest(true)}
          >
            Request help from the venue
          </button>
        )}
      </div>
    </div>
  );
}
