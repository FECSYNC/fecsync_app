'use client';

import { useMemo } from 'react';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function dateKeyFromIso(iso: string, timeZone?: string | null) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    if (timeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const day = parts.find((p) => p.type === 'day')?.value;
      if (y && m && day) return `${y}-${m}-${day}`;
    }
  } catch {
    /* fall through */
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today as YYYY-MM-DD in venue (or local) timezone. */
export function todayKeyInZone(timeZone?: string | null) {
  return dateKeyFromIso(new Date().toISOString(), timeZone) || (() => {
    const n = new Date();
    return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
  })();
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function monthRangeKeys(year: number, monthIndex: number) {
  const from = `${year}-${pad2(monthIndex + 1)}-01`;
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${pad2(monthIndex + 1)}-${pad2(last)}`;
  return { from, to };
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = {
  month: Date;
  onMonthChange: (next: Date) => void;
  selectedDate: string;
  onSelectDate: (yyyyMmDd: string) => void;
  /** Days that have at least one scheduled session (selectable). */
  availableDays: Set<string>;
  /** Days with at least one open/bookable seat (gold dot). Defaults to availableDays. */
  bookableDays?: Set<string>;
  /** Optional session count per day shown under the date number. */
  sessionCounts?: Map<string, number>;
  /** Optional price / hint per day (title tooltip). */
  dayHints?: Map<string, string>;
  /** Venue IANA timezone — used for today / past-day rules. */
  timezone?: string | null;
  /** Staff may need walk-up corrections on past days. */
  allowPast?: boolean;
  /** Show Today / Tomorrow / Next open quick picks. */
  showQuickPicks?: boolean;
};

/**
 * Month calendar for timed booking — staff desk and guest book pages.
 * Gold dots = seats still open; amber dots = scheduled but held/sold out.
 */
export default function BookingDateCalendar({
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  availableDays,
  bookableDays,
  sessionCounts,
  dayHints,
  timezone,
  allowPast = false,
  showQuickPicks = true,
}: Props) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const todayKey = useMemo(() => todayKeyInZone(timezone), [timezone]);
  const openDays = bookableDays ?? availableDays;

  const cells = useMemo(() => {
    const firstDow = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const out: Array<{
      key: string;
      day: number | null;
      scheduled: boolean;
      bookable: boolean;
      count: number;
    }> = [];
    for (let i = 0; i < firstDow; i++) {
      out.push({
        key: `pad-${i}`,
        day: null,
        scheduled: false,
        bookable: false,
        count: 0,
      });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
      out.push({
        key,
        day: d,
        scheduled: availableDays.has(key),
        bookable: openDays.has(key),
        count: sessionCounts?.get(key) ?? 0,
      });
    }
    return out;
  }, [year, monthIndex, availableDays, openDays, sessionCounts]);

  const label = month.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const tomorrowKey = addDaysToYmd(todayKey, 1);
  const nextOpen = useMemo(() => {
    const sorted = [...availableDays].filter((k) => k >= todayKey).sort();
    return sorted[0] ?? null;
  }, [availableDays, todayKey]);

  function jumpTo(key: string) {
    if (!key) return;
    const [y, m] = key.split('-').map(Number);
    if (y && m) {
      const next = new Date(y, m - 1, 1);
      if (
        next.getFullYear() !== year ||
        next.getMonth() !== monthIndex
      ) {
        onMonthChange(next);
      }
    }
    onSelectDate(key);
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
      {showQuickPicks ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <QuickChip
            label="Today"
            active={selectedDate === todayKey}
            disabled={!availableDays.has(todayKey)}
            onClick={() => jumpTo(todayKey)}
          />
          <QuickChip
            label="Tomorrow"
            active={selectedDate === tomorrowKey}
            disabled={!availableDays.has(tomorrowKey)}
            onClick={() => jumpTo(tomorrowKey)}
          />
          {nextOpen &&
          nextOpen !== todayKey &&
          nextOpen !== tomorrowKey ? (
            <QuickChip
              label="Next open day"
              active={selectedDate === nextOpen}
              onClick={() => jumpTo(nextOpen)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-md border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
          onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
          aria-label="Previous month"
        >
          ←
        </button>
        <h3 className="text-sm font-semibold text-stone-900">{label}</h3>
        <button
          type="button"
          className="rounded-md border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
          onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
          aria-label="Next month"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-stone-400 sm:text-[11px]">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c) => {
          if (c.day == null) {
            return <div key={c.key} className="aspect-square" />;
          }
          const selected = selectedDate === c.key;
          const isPast = c.key < todayKey;
          const disabled = !c.scheduled || (isPast && !allowPast);
          const hint =
            dayHints?.get(c.key) ||
            (c.count > 0
              ? `${c.count} slot${c.count === 1 ? '' : 's'}`
              : undefined);
          return (
            <button
              key={c.key}
              type="button"
              disabled={disabled}
              onClick={() => onSelectDate(c.key)}
              title={hint}
              className={`flex aspect-square min-h-9 flex-col items-center justify-center rounded-lg text-sm transition ${
                selected
                  ? 'bg-[#D4AF37] font-semibold text-stone-950 shadow-sm'
                  : disabled
                    ? 'cursor-not-allowed text-stone-300'
                    : c.bookable
                      ? 'bg-stone-50 font-medium text-stone-800 hover:bg-[#D4AF37]/20'
                      : 'bg-amber-50 font-medium text-stone-700 hover:bg-amber-100'
              }`}
            >
              <span>{c.day}</span>
              {c.scheduled && !(isPast && !allowPast) ? (
                <span
                  className={`mt-0.5 h-1 w-1 rounded-full ${
                    selected
                      ? 'bg-stone-900'
                      : c.bookable
                        ? 'bg-[#D4AF37]'
                        : 'bg-amber-500'
                  }`}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" />
          Open seats
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Scheduled (held / full)
        </span>
        <span>Grey days have no sessions.</span>
      </div>
    </div>
  );
}

function QuickChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900'
          : disabled
            ? 'cursor-not-allowed border-stone-100 text-stone-300'
            : 'border-stone-200 text-stone-700 hover:border-[#D4AF37]/60 hover:bg-stone-50'
      }`}
    >
      {label}
    </button>
  );
}
