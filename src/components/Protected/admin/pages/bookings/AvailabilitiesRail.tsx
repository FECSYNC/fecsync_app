'use client';

import { useMemo, useState } from 'react';
import BookingDateCalendar, {
  dateKeyFromIso,
} from '@/components/common/BookingDateCalendar';
import SessionAvailabilityList, {
  type AvailabilitySessionRow,
} from '@/components/common/SessionAvailabilityList';
import { fieldClass } from '../ticketing/ticketingUi';

type ProductOption = { id: string; name: string };

type Props = {
  productId: string;
  products: ProductOption[];
  onProductId: (id: string) => void;
  date: string;
  onDate: (yyyyMmDd: string) => void;
  calendarMonth: Date;
  onCalendarMonth: (d: Date) => void;
  sessionId: string;
  onSessionId: (id: string) => void;
  qty: number;
  onQty: (n: number) => void;
  sessions: AvailabilitySessionRow[];
  monthSessions: AvailabilitySessionRow[];
  venueTz: string | null;
  timeFormat?: string | null;
  canOverbook: boolean;
  allowOverbook: boolean;
  onAllowOverbook: (v: boolean) => void;
  includeUnavailable: boolean;
  onIncludeUnavailable: (v: boolean) => void;
  monthLoading?: boolean;
  dayLoading?: boolean;
  needsSlot: boolean;
};

type DayPart = 'all' | 'morning' | 'afternoon' | 'evening';

function dayPartOf(iso: string, timeZone?: string | null): DayPart {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timeZone || undefined,
      }).format(new Date(iso))
    );
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  } catch {
    const h = new Date(iso).getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}

/**
 * Persistent right rail for Product & session — same availability engine as the
 * main calendar (getTicketingAvailability → SessionAvailabilityList).
 */
export default function AvailabilitiesRail({
  productId,
  products,
  onProductId,
  date,
  onDate,
  calendarMonth,
  onCalendarMonth,
  sessionId,
  onSessionId,
  qty,
  onQty,
  sessions,
  monthSessions,
  venueTz,
  timeFormat,
  canOverbook,
  allowOverbook,
  onAllowOverbook,
  includeUnavailable,
  onIncludeUnavailable,
  monthLoading,
  dayLoading,
  needsSlot,
}: Props) {
  const [dowFilter, setDowFilter] = useState<number | 'all'>('all');
  const [dayPart, setDayPart] = useState<DayPart>('all');

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of monthSessions) {
      const key = dateKeyFromIso(s.startsAt, venueTz);
      if (key) set.add(key);
    }
    return set;
  }, [monthSessions, venueTz]);

  const bookableDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of monthSessions) {
      if (s.availableForQty === false || s.isClosed) continue;
      const key = dateKeyFromIso(s.startsAt, venueTz);
      if (key) set.add(key);
    }
    return set;
  }, [monthSessions, venueTz]);

  const sessionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthSessions) {
      const key = dateKeyFromIso(s.startsAt, venueTz);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [monthSessions, venueTz]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (dayPart !== 'all' && dayPartOf(s.startsAt, venueTz) !== dayPart) {
        return false;
      }
      if (dowFilter !== 'all') {
        const key = dateKeyFromIso(s.startsAt, venueTz);
        if (!key) return false;
        const [y, m, d] = key.split('-').map(Number);
        const dow = new Date(y, m - 1, d).getDay();
        if (dow !== dowFilter) return false;
      }
      if (!includeUnavailable && !allowOverbook) {
        if (s.availableForQty === false || s.status === 'closed') return false;
      }
      return true;
    });
  }, [
    sessions,
    dayPart,
    dowFilter,
    includeUnavailable,
    allowOverbook,
    venueTz,
  ]);

  return (
    <aside className="space-y-4 rounded-lg border border-stone-200 bg-stone-50/80 p-4 lg:sticky lg:top-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
          Availabilities
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Same capacity engine as the calendar — pick a slot to fill Product &
          session.
        </p>
      </div>

      <label className="block text-sm font-medium text-stone-800">
        Product
        <select
          className={`${fieldClass} mt-1`}
          value={productId}
          onChange={(e) => onProductId(e.target.value)}
        >
          <option value="">Select product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-stone-800">
        Guests
        <input
          type="number"
          min={1}
          className={`${fieldClass} mt-1`}
          value={qty}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            onQty(Number.isFinite(n) && n >= 1 ? n : 1);
          }}
        />
      </label>

      {needsSlot ? (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-800">When</p>
            {monthLoading && !monthSessions.length ? (
              <p className="text-xs text-stone-500">Loading calendar…</p>
            ) : (
              <BookingDateCalendar
                month={calendarMonth}
                onMonthChange={onCalendarMonth}
                selectedDate={date}
                onSelectDate={(key) => {
                  onDate(key);
                  onSessionId('');
                }}
                availableDays={availableDays}
                bookableDays={bookableDays}
                sessionCounts={sessionCounts}
                timezone={venueTz}
                allowPast={canOverbook}
                showQuickPicks
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-stone-700">
              Day of week
              <select
                className={`${fieldClass} mt-1 text-sm`}
                value={dowFilter === 'all' ? 'all' : String(dowFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDowFilter(v === 'all' ? 'all' : Number(v));
                }}
              >
                <option value="all">Any</option>
                <option value="0">Sun</option>
                <option value="1">Mon</option>
                <option value="2">Tue</option>
                <option value="3">Wed</option>
                <option value="4">Thu</option>
                <option value="5">Fri</option>
                <option value="6">Sat</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-stone-700">
              Time of day
              <select
                className={`${fieldClass} mt-1 text-sm`}
                value={dayPart}
                onChange={(e) => setDayPart(e.target.value as DayPart)}
              >
                <option value="all">Any</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </label>
          </div>

          {canOverbook ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-stone-700">
                <input
                  type="checkbox"
                  checked={includeUnavailable}
                  onChange={(e) => onIncludeUnavailable(e.target.checked)}
                />
                Include unavailable / held
              </label>
              <label className="flex items-center gap-2 text-xs text-stone-700">
                <input
                  type="checkbox"
                  checked={allowOverbook}
                  onChange={(e) => onAllowOverbook(e.target.checked)}
                />
                Allow overbook
              </label>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-800">Sessions</p>
            {!date ? (
              <p className="text-xs text-stone-500">Pick a date to list slots.</p>
            ) : dayLoading && !sessions.length ? (
              <p className="text-xs text-stone-500">Loading sessions…</p>
            ) : (
              <SessionAvailabilityList
                sessions={filteredSessions}
                selectedId={sessionId}
                onSelect={onSessionId}
                timeFormat={timeFormat}
                timeZone={venueTz}
                allowUnavailableSelect={allowOverbook || includeUnavailable}
              />
            )}
          </div>
        </>
      ) : (
        <label className="block text-sm font-medium text-stone-800">
          Visit date
          <input
            type="date"
            className={`${fieldClass} mt-1`}
            value={date}
            onChange={(e) => onDate(e.target.value)}
          />
        </label>
      )}
    </aside>
  );
}
