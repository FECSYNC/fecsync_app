'use client';

import { useHoldReleaseLabel } from '@/hooks/useHoldReleaseLabel';
import { formatClockDateTime, formatClockTime } from '@/lib/timeClock';

export type AvailabilitySessionRow = {
  id: string;
  label?: string | null;
  startsAt: string;
  endsAt: string;
  remaining: number;
  capacity: number;
  status?: 'open' | 'limited' | 'held' | 'sold_out' | 'closed';
  statusMessage?: string;
  availableForQty?: boolean;
  isClosed?: boolean;
  nextReleaseAt?: string | null;
  heldQty?: number;
  committedQty?: number;
  priceOverride?: number | null;
  currency?: string | null;
};

function SessionRow({
  session: s,
  selected,
  disabled,
  timeFormat,
  timeZone,
  priceLabel,
  onSelect,
}: {
  session: AvailabilitySessionRow;
  selected: boolean;
  disabled: boolean;
  timeFormat?: string | null;
  timeZone?: string | null;
  priceLabel?: string | null;
  onSelect: () => void;
}) {
  const releaseIn = useHoldReleaseLabel(
    s.status === 'held' || (s.heldQty ?? 0) > 0 ? s.nextReleaseAt : null
  );
  const bookable = s.availableForQty !== false && !disabled;

  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm ${
        selected
          ? 'border-[#D4AF37] bg-[#D4AF37]/10'
          : bookable
            ? 'border-stone-200 hover:bg-stone-50'
            : 'border-stone-100 bg-stone-50 opacity-80'
      }`}
    >
      <input
        type="radio"
        name="session"
        className="mt-1"
        disabled={!bookable}
        checked={selected}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-stone-900">
          {s.label ? `${s.label} · ` : ''}
          {formatClockDateTime(s.startsAt, timeFormat, timeZone)} →{' '}
          {formatClockTime(s.endsAt, timeFormat, timeZone)}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600">
          {s.remaining}/{s.capacity} open
          {(s.heldQty ?? 0) > 0 ? ` · ${s.heldQty} held (unpaid)` : ''}
          {(s.committedQty ?? 0) > 0
            ? ` · ${s.committedQty} paid/confirmed`
            : ''}
        </span>
        {s.statusMessage ? (
          <span className="mt-0.5 block text-xs text-stone-500">
            {s.statusMessage}
          </span>
        ) : null}
        {s.status === 'held' && releaseIn ? (
          <span className="mt-1 block text-xs font-medium text-amber-800">
            Hold frees in {releaseIn} if payment is not completed — you can wait
            and book then.
          </span>
        ) : null}
        {s.status === 'sold_out' ? (
          <span className="mt-1 block text-xs font-medium text-red-700">
            Taken (paid / confirmed) — choose another slot.
          </span>
        ) : null}
      </span>
      {priceLabel ? (
        <span className="shrink-0 text-sm font-semibold text-stone-900">
          {priceLabel}
        </span>
      ) : null}
    </label>
  );
}

/** Lists every named slot/session for the day with hold vs paid status. */
export default function SessionAvailabilityList({
  sessions,
  selectedId,
  onSelect,
  timeFormat,
  timeZone,
  priceLabelFor,
  allowUnavailableSelect = false,
}: {
  sessions: AvailabilitySessionRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  timeFormat?: string | null;
  timeZone?: string | null;
  priceLabelFor?: (s: AvailabilitySessionRow) => string | null;
  /** When true (overbook), held/full rows stay selectable. */
  allowUnavailableSelect?: boolean;
}) {
  if (!sessions.length) {
    return (
      <p className="text-sm text-stone-500">
        No sessions scheduled for this date.
      </p>
    );
  }

  const groups = new Map<string, AvailabilitySessionRow[]>();
  for (const s of sessions) {
    const key = s.label?.trim() || 'Session';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([label, rows]) => (
        <div key={label} className="space-y-2">
          {groups.size > 1 ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {label}
              <span className="ml-1 font-normal normal-case text-stone-400">
                ({rows.length} time{rows.length === 1 ? '' : 's'})
              </span>
            </p>
          ) : null}
          <div className="space-y-2">
            {rows.map((s) => {
              const unavailable =
                s.availableForQty === false || s.status === 'closed';
              return (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={selectedId === s.id}
                  disabled={unavailable && !allowUnavailableSelect}
                  timeFormat={timeFormat}
                  timeZone={timeZone}
                  priceLabel={priceLabelFor?.(s) ?? null}
                  onSelect={() => onSelect(s.id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
