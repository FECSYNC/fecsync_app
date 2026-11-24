'use client';

import { useMemo, useState } from 'react';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  btnDangerClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
} from './ticketingUi';
import { formatClockDateTime, formatClockTime, isHour12 } from '@/lib/timeClock';
import { ClockTimeInput } from '@/components/common/ClockTimeFields';
import { BULK_SESSION_LIMIT } from '@/lib/ticketing/sessionLimits';

const WEEKDAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 0, label: 'Sun' },
];

const DURATION_PRESETS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1½ hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
];

const MAX_SLOTS = BULK_SESSION_LIMIT;

export type GeneratedSlot = {
  startsAt: string;
  endsAt: string;
  label?: string | null;
};

type SlotTemplate = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
};

type ProductOption = {
  id: string;
  name: string;
  locationId?: string;
  resourceId?: string | null;
  resource?: { defaultCapacity?: number } | null;
};

type ResourceOption = {
  id: string;
  name: string;
  type: string;
  locationId?: string;
  archivedAt?: string | null;
};

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `slot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function combineLocal(dateStr: string, minutesFromMidnight: number): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const h = Math.floor(minutesFromMidnight / 60);
  const mi = minutesFromMidnight % 60;
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function eachDateKey(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  let guard = 0;
  while (cursor <= last && guard < 400) {
    guard += 1;
    out.push(
      `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function suggestSlotName(startMin: number, baseName: string): string {
  const base = baseName.trim() || 'Adventure';
  const hour = startMin / 60;
  if (hour < 10) return `Morning ${base}`;
  if (hour < 12) return `Late Morning ${base}`;
  if (hour < 14) return `Midday ${base}`;
  if (hour < 16) return `Afternoon ${base}`;
  if (hour < 18) return `Late Afternoon ${base}`;
  if (hour < 20) return `Evening ${base}`;
  return `Night ${base}`;
}

function formatHmLabel(hm: string, timeFormat?: string | null): string {
  const mins = parseHm(hm);
  if (mins == null) return hm;
  const d = new Date();
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return formatClockTime(d, timeFormat);
}

/** Expand named templates across a date range. */
export function buildNamedSchedule(input: {
  startDate: string;
  endDate: string;
  weekdays: number[];
  templates: Array<{ name: string; startTime: string; endTime: string }>;
}): { slots: GeneratedSlot[]; error?: string } {
  if (!input.startDate || !input.endDate) {
    return { slots: [], error: 'Choose a start and end date.' };
  }
  if (input.endDate < input.startDate) {
    return { slots: [], error: 'End date must be on or after start date.' };
  }
  if (!input.weekdays.length) {
    return { slots: [], error: 'Select at least one day of the week.' };
  }
  if (!input.templates.length) {
    return { slots: [], error: 'Add at least one named slot first.' };
  }

  const parsed: Array<{
    name: string;
    startMin: number;
    endMin: number;
  }> = [];
  for (const t of input.templates) {
    const name = t.name.trim();
    if (!name) {
      return { slots: [], error: 'Every slot needs a name.' };
    }
    const startMin = parseHm(t.startTime);
    const endMin = parseHm(t.endTime);
    if (startMin == null || endMin == null) {
      return { slots: [], error: `Invalid times for “${name}”.` };
    }
    if (endMin <= startMin) {
      return {
        slots: [],
        error: `“${name}” end time must be after start time.`,
      };
    }
    parsed.push({ name, startMin, endMin });
  }

  const slots: GeneratedSlot[] = [];
  for (const dateKey of eachDateKey(input.startDate, input.endDate)) {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const dow = new Date(y, mo - 1, d).getDay();
    if (!input.weekdays.includes(dow)) continue;

    for (const t of parsed) {
      const starts = combineLocal(dateKey, t.startMin);
      const ends = combineLocal(dateKey, t.endMin);
      slots.push({
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        label: t.name,
      });
      if (slots.length > MAX_SLOTS) {
        return {
          slots: [],
          error: `Would create more than ${MAX_SLOTS} slots. Narrow the date range.`,
        };
      }
    }
  }

  if (!slots.length) {
    return {
      slots: [],
      error: 'No matching days in that range. Check weekdays and dates.',
    };
  }
  return { slots };
}

function emptyTemplate(): SlotTemplate {
  return {
    id: newId(),
    name: '',
    startTime: '09:00',
    endTime: '10:30',
  };
}

function formatSlotPreview(slot: GeneratedSlot, timeFormat?: string | null) {
  const when = `${formatClockDateTime(slot.startsAt, timeFormat, null, {
    weekday: 'short',
    year: undefined,
  })} → ${formatClockTime(slot.endsAt, timeFormat)}`;
  return slot.label ? `${slot.label} (${when})` : when;
}

export default function ScheduleWizard({
  products,
  resources,
  defaultProductId,
  busy,
  timeFormat,
  onGenerate,
  onExpand,
}: {
  products: ProductOption[];
  resources: ResourceOption[];
  defaultProductId?: string;
  busy?: boolean;
  timeFormat?: string | null;
  onGenerate: (payload: {
    productId: string;
    resourceId: string | null;
    capacity: number;
    slots: GeneratedSlot[];
  }) => Promise<void>;
  /** Fired when the wizard panel is expanded (lazy-load parent resources). */
  onExpand?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(defaultProductId ?? '');
  const [resourceId, setResourceId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [capacity, setCapacity] = useState('20');
  const [templates, setTemplates] = useState<SlotTemplate[]>([
    {
      id: newId(),
      name: 'Morning Adventure',
      startTime: '09:00',
      endTime: '10:30',
    },
  ]);
  const [templatesOpen, setTemplatesOpen] = useState(true);

  // Auto-fill helpers
  const [openTime, setOpenTime] = useState('09:00');
  const [closeTime, setCloseTime] = useState('21:00');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [customDuration, setCustomDuration] = useState('');
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [nameBase, setNameBase] = useState('Adventure');
  const [showAutoFill, setShowAutoFill] = useState(false);

  const [localError, setLocalError] = useState('');
  const hour12 = isHour12(timeFormat);

  const selectedProduct = products.find((p) => p.id === productId);
  const venueResources = useMemo(() => {
    const loc = selectedProduct?.locationId;
    return resources.filter(
      (r) => !r.archivedAt && (!loc || !r.locationId || r.locationId === loc)
    );
  }, [resources, selectedProduct?.locationId]);

  const effectiveDuration =
    customDuration.trim() !== ''
      ? Math.round(Number(customDuration) * 60)
      : durationMinutes;

  const preview = useMemo(
    () =>
      buildNamedSchedule({
        startDate,
        endDate: endDate || startDate,
        weekdays,
        templates,
      }),
    [startDate, endDate, weekdays, templates]
  );

  const dayCount = useMemo(() => {
    if (!preview.slots.length) return 0;
    const keys = new Set(
      preview.slots.map((s) => {
        const d = new Date(s.startsAt);
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      })
    );
    return keys.size;
  }, [preview.slots]);

  function applyProduct(nextId: string) {
    setProductId(nextId);
    const product = products.find((p) => p.id === nextId);
    setResourceId(product?.resourceId ?? '');
    const cap = product?.resource?.defaultCapacity;
    if (cap != null && cap > 0) setCapacity(String(cap));
    if (product?.name) {
      const word = product.name.split(/\s+/)[0];
      if (word) setNameBase(word);
    }
  }

  function updateTemplate(id: string, patch: Partial<SlotTemplate>) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }

  function removeTemplate(id: string) {
    setTemplates((prev) =>
      prev.length <= 1 ? prev : prev.filter((t) => t.id !== id)
    );
  }

  function autoFillTemplates() {
    setLocalError('');
    const openMin = parseHm(openTime);
    const closeMin = parseHm(closeTime);
    if (openMin == null || closeMin == null || closeMin <= openMin) {
      setLocalError('Set valid day open/close times for auto-fill.');
      return;
    }
    if (
      !Number.isInteger(effectiveDuration) ||
      effectiveDuration < 15 ||
      effectiveDuration > 12 * 60
    ) {
      setLocalError('Slot length must be between 15 minutes and 12 hours.');
      return;
    }
    if (
      !Number.isInteger(bufferMinutes) ||
      bufferMinutes < 0 ||
      bufferMinutes > 180
    ) {
      setLocalError('Buffer must be 0–180 minutes.');
      return;
    }

    const next: SlotTemplate[] = [];
    let cursor = openMin;
    while (cursor + effectiveDuration <= closeMin) {
      next.push({
        id: newId(),
        name: suggestSlotName(cursor, nameBase),
        startTime: minutesToHm(cursor),
        endTime: minutesToHm(cursor + effectiveDuration),
      });
      cursor += effectiveDuration + bufferMinutes;
    }
    if (!next.length) {
      setLocalError('No slots fit that day window. Adjust length or hours.');
      return;
    }
    setTemplates(next);
    setShowAutoFill(false);
  }

  async function submitGenerate(singleDate: boolean) {
    setLocalError('');
    if (!productId) {
      setLocalError('Select a product.');
      return;
    }
    const rangeEnd = singleDate ? startDate : endDate || startDate;
    if (!startDate) {
      setLocalError('Choose a start date.');
      return;
    }
    if (!singleDate && !endDate) {
      setLocalError('Choose an end date (or use Add single date).');
      return;
    }

    const built = buildNamedSchedule({
      startDate,
      endDate: rangeEnd,
      weekdays: singleDate ? [0, 1, 2, 3, 4, 5, 6] : weekdays,
      templates,
    });
    if (built.error) {
      setLocalError(built.error);
      return;
    }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 0) {
      setLocalError('Capacity must be a non-negative whole number.');
      return;
    }
    await onGenerate({
      productId,
      resourceId: resourceId || null,
      capacity: cap,
      slots: built.slots,
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-[#D4AF37]/35 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">
            Schedule wizard
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Name your slots (e.g. Morning Adventure), set times, then generate
            the calendar across dates — guests see those names when booking.
          </p>
        </div>
        <button
          type="button"
          className={btnSecondaryClass}
          onClick={() =>
            setOpen((v) => {
              const next = !v;
              if (next) onExpand?.();
              return next;
            })
          }
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {open ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-stone-500">
                Product *
              </span>
              <select
                required
                value={productId}
                onChange={(e) => applyProduct(e.target.value)}
                className={fieldClass}
              >
                <option value="">Select product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Named slot templates — matches Woo-style slot rows */}
          <div className="space-y-2 rounded-md border border-stone-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Slots
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  onClick={() =>
                    setTemplates((prev) => [...prev, emptyTemplate()])
                  }
                >
                  + New slot
                </button>
                <button
                  type="button"
                  className={btnSecondaryClass}
                  onClick={() => setShowAutoFill((v) => !v)}
                >
                  Auto-fill from duration
                </button>
                <button
                  type="button"
                  className="text-xs text-[#D4AF37] hover:underline"
                  onClick={() => setTemplatesOpen((v) => !v)}
                >
                  {templatesOpen ? '(Collapse)' : '(Expand)'}
                </button>
              </div>
            </div>

            {showAutoFill ? (
              <div className="space-y-3 rounded-md border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs text-stone-600">
                  Pick open hours and slot length — we create named slot rows
                  you can edit before generating dates.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-stone-500">Day opens</span>
                    <ClockTimeInput
                      value={openTime}
                      onChange={setOpenTime}
                      hour12={hour12}
                      aria-label="Day opens"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-stone-500">Day closes</span>
                    <ClockTimeInput
                      value={closeTime}
                      onChange={setCloseTime}
                      hour12={hour12}
                      aria-label="Day closes"
                    />
                  </label>
                  <div className="space-y-1 sm:col-span-2">
                    <span className="text-xs text-stone-500">Slot length</span>
                    <div className="flex flex-wrap gap-2">
                      {DURATION_PRESETS.map((p) => (
                        <button
                          key={p.minutes}
                          type="button"
                          className={
                            customDuration === '' &&
                            durationMinutes === p.minutes
                              ? btnPrimaryClass
                              : btnSecondaryClass
                          }
                          onClick={() => {
                            setCustomDuration('');
                            setDurationMinutes(p.minutes);
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min={0.25}
                      step={0.25}
                      value={customDuration}
                      onChange={(e) => setCustomDuration(e.target.value)}
                      className={`${fieldClass} mt-1 max-w-xs`}
                      placeholder="Custom hours"
                    />
                  </div>
                  <label className="block space-y-1">
                    <span className="text-xs text-stone-500">
                      Buffer (minutes)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={bufferMinutes}
                      onChange={(e) =>
                        setBufferMinutes(Number(e.target.value) || 0)
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-stone-500">
                      Name ending (e.g. Adventure)
                    </span>
                    <input
                      type="text"
                      value={nameBase}
                      onChange={(e) => setNameBase(e.target.value)}
                      className={fieldClass}
                      placeholder="Adventure"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className={btnPrimaryClass}
                  onClick={autoFillTemplates}
                >
                  Build named slots
                </button>
              </div>
            ) : null}

            {templatesOpen ? (
              <ul className="space-y-2">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="grid gap-2 rounded-md border border-stone-200 bg-white p-2 sm:grid-cols-[minmax(0,1.4fr)_auto_auto_auto]"
                  >
                    <input
                      type="text"
                      value={t.name}
                      onChange={(e) =>
                        updateTemplate(t.id, { name: e.target.value })
                      }
                      className={fieldClass}
                      placeholder="Slot name (e.g. Morning Adventure)"
                    />
                    <label className="flex flex-col gap-1 text-xs text-stone-500">
                      Start
                      <ClockTimeInput
                        value={t.startTime}
                        onChange={(startTime) =>
                          updateTemplate(t.id, { startTime })
                        }
                        hour12={hour12}
                        aria-label="Slot start"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-stone-500">
                      End
                      <ClockTimeInput
                        value={t.endTime}
                        onChange={(endTime) =>
                          updateTemplate(t.id, { endTime })
                        }
                        hour12={hour12}
                        aria-label="Slot end"
                      />
                    </label>
                    <button
                      type="button"
                      className={btnDangerClass}
                      onClick={() => removeTemplate(t.id)}
                      disabled={templates.length <= 1}
                    >
                      Remove
                    </button>
                    <p className="text-[11px] text-stone-500 sm:col-span-4">
                      Guests will see:{' '}
                      <span className="font-medium text-stone-700">
                        {t.name.trim() || 'Untitled'} (
                        {formatHmLabel(t.startTime, timeFormat)} –{' '}
                        {formatHmLabel(t.endTime, timeFormat)})
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-stone-500">
                {templates.length} named slot
                {templates.length === 1 ? '' : 's'} defined.
              </p>
            )}
          </div>

          {/* Date range — apply templates to calendar */}
          <div className="space-y-3 rounded-md border border-stone-200 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Apply to calendar
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Start date *
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  End date *
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <div className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Days of week *
                </span>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => (
                    <label
                      key={d.v}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-700"
                    >
                      <input
                        type="checkbox"
                        checked={weekdays.includes(d.v)}
                        onChange={(e) => {
                          setWeekdays((prev) =>
                            e.target.checked
                              ? [...prev, d.v]
                              : prev.filter((x) => x !== d.v)
                          );
                        }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Default capacity *
                </span>
                <input
                  type="number"
                  min={0}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Capacity resource
                </span>
                <select
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  className={fieldClass}
                  disabled={!selectedProduct}
                >
                  <option value="">Inherit product resource</option>
                  {venueResources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.type}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
            {preview.error ? (
              <p className="text-amber-800">{preview.error}</p>
            ) : (
              <p>
                Ready to create{' '}
                <span className="font-semibold">{preview.slots.length}</span>{' '}
                bookable timeslot
                {preview.slots.length === 1 ? '' : 's'} (
                <span className="font-semibold">{templates.length}</span> named
                slot
                {templates.length === 1 ? '' : 's'} ×{' '}
                <span className="font-semibold">{dayCount}</span> day
                {dayCount === 1 ? '' : 's'}).
              </p>
            )}
            {!preview.error && preview.slots.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-stone-600">
                {preview.slots.slice(0, 10).map((s) => (
                  <li key={`${s.label}-${s.startsAt}`}>
                    {formatSlotPreview(s, timeFormat)}
                  </li>
                ))}
                {preview.slots.length > 10 ? (
                  <li>…and {preview.slots.length - 10} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>

          {localError ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {localError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={btnPrimaryClass}
              disabled={busy || Boolean(preview.error) || !preview.slots.length}
              onClick={() => void submitGenerate(false)}
            >
              {busy ? <ButtonSpinner /> : null}
              Generate schedule
            </button>
            <span className="text-xs font-medium uppercase text-stone-400">
              or
            </span>
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={busy || !startDate}
              onClick={() => void submitGenerate(true)}
            >
              Add single date
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
