'use client';

import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  useTicketSessionsQuery,
  useCreateTicketSessionMutation,
  useCloseTicketSessionMutation,
  usePatchTicketSessionMutation,
  useTicketingProductsQuery,
  useCapacityResourcesQuery,
} from '@/hooks/useTicketing';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import { ClockDateTimeInput } from '@/components/common/ClockTimeFields';
import { formatClockTime } from '@/lib/timeClock';
import type { TicketSessionDto } from '@/services/ticketing';
import {
  btnPrimaryClass,
  btnSecondaryClass,
  btnDangerClass,
  fieldClass,
  formatProductType,
} from './ticketingUi';
import ScheduleWizard from './ScheduleWizard';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TICKETING_SESSIONS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

const WEEKDAYS = [
  { v: 0, label: 'Sun' },
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
];

const CAL_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  return `${localDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDayHeading(dateKey: string) {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function occupancyTone(remaining: number, capacity: number) {
  if (capacity <= 0) return 'bg-stone-200 text-stone-700';
  if (remaining <= 0) return 'bg-red-100 text-red-900';
  if (remaining / capacity <= 0.25) return 'bg-amber-100 text-amber-900';
  return 'bg-emerald-100 text-emerald-900';
}

type DayPulse = {
  count: number;
  capacity: number;
  remaining: number;
  booked: number;
  held: number;
  soldOut: number;
  open: number;
  closed: number;
  /** Worst occupancy signal for the day cell. */
  tone: 'empty' | 'open' | 'limited' | 'sold_out' | 'closed';
};

type DayBucket = {
  dateKey: string;
  sessions: TicketSessionDto[];
};

type ProductGroup = {
  productId: string;
  productName: string;
  productType: string;
  total: number;
  days: DayBucket[];
};

export default function TicketingSessionsPage() {
  const searchParams = useSearchParams();
  const initialProductId = searchParams.get('productId') ?? '';
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.TicketingSessionsWrite) || can(P.TicketingWrite);
  const [guideOpen, setGuideOpen] = useState(false);

  const [filterProductId, setFilterProductId] = useState(initialProductId);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [showTools, setShowTools] = useState(false);
  /** Explicit open/closed overrides; missing key → smart default. */
  const [productOpenMap, setProductOpenMap] = useState<Record<string, boolean>>(
    {}
  );
  const [dayOpenMap, setDayOpenMap] = useState<Record<string, boolean>>({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [productId, setProductId] = useState(initialProductId);
  const [resourceId, setResourceId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [capacity, setCapacity] = useState('20');
  const [slotLabel, setSlotLabel] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [series, setSeries] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [untilDate, setUntilDate] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStartsAt, setEditStartsAt] = useState('');
  const [editEndsAt, setEditEndsAt] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [editRemaining, setEditRemaining] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editPriceOverride, setEditPriceOverride] = useState('');
  const [editResourceId, setEditResourceId] = useState('');

  const productsQuery = useTicketingProductsQuery({ includeArchived: false });
  const timedProducts = useMemo(
    () =>
      (productsQuery.data ?? []).filter(
        (p) =>
          !p.archivedAt &&
          (p.type === 'timed_session' ||
            p.type === 'group' ||
            p.type === 'camp_event' ||
            p.type === 'party_package')
      ),
    [productsQuery.data]
  );

  const selectedProduct = timedProducts.find((p) => p.id === productId);
  const filterProduct = timedProducts.find((p) => p.id === filterProductId);
  const { hour12, timeFormat } = useTimeClockFormat(
    selectedProduct?.locationId ?? filterProduct?.locationId ?? null
  );
  const resourcesQuery = useCapacityResourcesQuery(
    { locationId: selectedProduct?.locationId },
    Boolean(selectedProduct?.locationId)
  );
  const [wizardResourcesReady, setWizardResourcesReady] = useState(false);
  const allResourcesQuery = useCapacityResourcesQuery(
    {},
    canWrite && wizardResourcesReady
  );

  useEffect(() => {
    if (!selectedProduct) return;
    setResourceId((prev) => {
      if (prev) return prev;
      return selectedProduct.resourceId ?? '';
    });
    if (selectedProduct.resource?.defaultCapacity != null) {
      setCapacity((prev) =>
        prev === '20' && selectedProduct.resource!.defaultCapacity > 0
          ? String(selectedProduct.resource!.defaultCapacity)
          : prev
      );
    }
  }, [selectedProduct]);

  const monthRange = useMemo(() => {
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    const from = new Date(y, m, 1, 0, 0, 0, 0);
    const to = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [calendarMonth]);

  const sessionsQuery = useTicketSessionsQuery({
    ...(filterProductId ? { productId: filterProductId } : {}),
    from: monthRange.from,
    to: monthRange.to,
    includeClosed,
  });
  const createMutation = useCreateTicketSessionMutation();
  const closeMutation = useCloseTicketSessionMutation();
  const patchMutation = usePatchTicketSessionMutation();

  const allSessions = sessionsQuery.data ?? [];

  const dayPulse = useMemo(() => {
    const map = new Map<string, DayPulse>();
    for (const s of allSessions) {
      const key = localDateKey(new Date(s.startsAt));
      const prev = map.get(key) ?? {
        count: 0,
        capacity: 0,
        remaining: 0,
        booked: 0,
        held: 0,
        soldOut: 0,
        open: 0,
        closed: 0,
        tone: 'empty' as const,
      };
      const held = s.heldQty ?? 0;
      const committed =
        s.committedQty ?? Math.max(0, s.capacity - s.remaining - held);
      prev.count += 1;
      prev.capacity += s.capacity;
      prev.remaining += s.remaining;
      prev.booked += committed;
      prev.held += held;
      if (s.isClosed || s.status === 'closed') prev.closed += 1;
      else if (s.remaining <= 0 || s.status === 'sold_out') prev.soldOut += 1;
      else if (
        s.status === 'limited' ||
        s.status === 'held' ||
        (s.capacity > 0 && s.remaining / s.capacity <= 0.25)
      ) {
        /* counted in open but tone limited */
        prev.open += 1;
      } else prev.open += 1;
      map.set(key, prev);
    }
    for (const [key, pulse] of map) {
      let tone: DayPulse['tone'] = 'open';
      if (pulse.count === 0) tone = 'empty';
      else if (pulse.closed === pulse.count) tone = 'closed';
      else if (pulse.soldOut === pulse.count - pulse.closed && pulse.soldOut > 0)
        tone = 'sold_out';
      else if (
        pulse.remaining / Math.max(1, pulse.capacity) <= 0.25 ||
        pulse.held > 0
      )
        tone = 'limited';
      else tone = 'open';
      map.set(key, { ...pulse, tone });
    }
    return map;
  }, [allSessions]);

  const filteredSessions = useMemo(() => {
    if (!selectedDate) return allSessions;
    return allSessions.filter(
      (s) => localDateKey(new Date(s.startsAt)) === selectedDate
    );
  }, [allSessions, selectedDate]);

  const selectedDayPulse = selectedDate
    ? dayPulse.get(selectedDate) ?? null
    : null;

  /** Group by ticket product, then by calendar day — standard schedule board. */
  const productGroups = useMemo((): ProductGroup[] => {
    const byProduct = new Map<string, TicketSessionDto[]>();
    for (const s of filteredSessions) {
      const pid = s.productId || s.product?.id || 'unknown';
      const list = byProduct.get(pid) ?? [];
      list.push(s);
      byProduct.set(pid, list);
    }

    const groups: ProductGroup[] = [];
    for (const [pid, sessions] of byProduct) {
      sessions.sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
      const byDay = new Map<string, TicketSessionDto[]>();
      for (const s of sessions) {
        const key = localDateKey(new Date(s.startsAt));
        const list = byDay.get(key) ?? [];
        list.push(s);
        byDay.set(key, list);
      }
      const days: DayBucket[] = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateKey, daySessions]) => ({ dateKey, sessions: daySessions }));

      const sample = sessions[0];
      const catalog = timedProducts.find((p) => p.id === pid);
      groups.push({
        productId: pid,
        productName:
          catalog?.name ?? sample?.product?.name ?? 'Unknown product',
        productType:
          catalog?.type ?? sample?.product?.type ?? 'timed_session',
        total: sessions.length,
        days,
      });
    }

    groups.sort((a, b) => a.productName.localeCompare(b.productName));
    return groups;
  }, [filteredSessions, timedProducts]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const total = daysInMonth(year, month);
    const lead = new Date(year, month, 1).getDay();
    const cells: Array<{
      key: string;
      day: number;
      pulse: DayPulse | null;
    } | null> = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= total; d++) {
      const key = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      cells.push({ key, day: d, pulse: dayPulse.get(key) ?? null });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calendarMonth, dayPulse]);

  const monthLabel = calendarMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const todayKey = localDateKey(new Date());

  const selectCalendarDay = (key: string | null) => {
    setSelectedDate(key);
    if (!key) return;
    // Auto-expand products + that day so the board matches the calendar pick.
    const onDay = allSessions.filter(
      (s) => localDateKey(new Date(s.startsAt)) === key
    );
    if (onDay.length === 0) return;
    const productIds = new Set(
      onDay.map((s) => s.productId || s.product?.id).filter(Boolean) as string[]
    );
    setProductOpenMap((prev) => {
      const next = { ...prev };
      for (const pid of productIds) next[pid] = true;
      return next;
    });
    setDayOpenMap((prev) => {
      const next = { ...prev };
      for (const pid of productIds) next[`${pid}:${key}`] = true;
      return next;
    });
  };

  const dayCellClass = (
    key: string,
    pulse: DayPulse | null,
    active: boolean
  ) => {
    if (active) return 'border-[#D4AF37] bg-[#D4AF37]/20 text-stone-900';
    if (key === todayKey) return 'border-stone-400 bg-stone-50 text-stone-900';
    if (!pulse || pulse.count === 0) {
      return 'border-transparent text-stone-400 hover:border-stone-200';
    }
    switch (pulse.tone) {
      case 'sold_out':
        return 'border-red-200 bg-red-50 text-red-900 hover:border-red-300';
      case 'limited':
        return 'border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300';
      case 'closed':
        return 'border-stone-200 bg-stone-100 text-stone-500 hover:border-stone-300';
      default:
        return 'border-emerald-200 bg-emerald-50/80 text-stone-800 hover:border-[#D4AF37]';
    }
  };

  const startEdit = (s: TicketSessionDto) => {
    setEditingId(s.id);
    setEditStartsAt(toDatetimeLocalValue(s.startsAt));
    setEditEndsAt(toDatetimeLocalValue(s.endsAt));
    setEditCapacity(String(s.capacity));
    setEditRemaining(String(s.remaining));
    setEditLabel(s.label ?? '');
    setEditPriceOverride(
      s.priceOverride != null ? String(s.priceOverride) : ''
    );
    setEditResourceId(s.resourceId ?? '');
    if (s.productId) setProductId(s.productId);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (id: string) => {
    if (!canWrite) return;
    try {
      await patchMutation.mutateAsync({
        id,
        payload: {
          startsAt: new Date(editStartsAt).toISOString(),
          endsAt: new Date(editEndsAt).toISOString(),
          capacity: Number(editCapacity),
          remaining: Number(editRemaining),
          label: editLabel.trim() || null,
          priceOverride:
            editPriceOverride.trim() === ''
              ? null
              : Number(editPriceOverride),
          resourceId: editResourceId || null,
        },
      });
      addToast('Session updated', 'success');
      setEditingId(null);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not update session',
        'error'
      );
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    try {
      const payload = {
        productId,
        resourceId: resourceId || null,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        capacity: Number(capacity),
        label: slotLabel.trim() || null,
        priceOverride:
          priceOverride.trim() === '' ? null : Number(priceOverride),
        series,
        weekdays: series ? weekdays : undefined,
        untilDate:
          series && untilDate ? new Date(untilDate).toISOString() : undefined,
      };
      const result = await createMutation.mutateAsync(payload);
      const count = result.sessions?.length ?? (result.session ? 1 : 0);
      addToast(
        count > 1 ? `Created ${count} sessions` : 'Session created',
        'success'
      );
      setPriceOverride('');
      if (productId) setFilterProductId(productId);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not create session',
        'error'
      );
    }
  };

  const selectFilterProduct = (id: string) => {
    setFilterProductId(id);
    setProductOpenMap({});
    setDayOpenMap({});
    if (id) {
      setProductId(id);
      setSelectedDate(null);
    }
  };

  const isProductOpen = (productId: string) => {
    // Closed by default — only open after the admin expands it.
    return productOpenMap[productId] === true;
  };

  const toggleProduct = (productId: string, currentlyOpen: boolean) => {
    setProductOpenMap((prev) => ({ ...prev, [productId]: !currentlyOpen }));
  };

  const dayKey = (productId: string, dateKey: string) =>
    `${productId}:${dateKey}`;

  const isDayOpen = (productId: string, dateKey: string) => {
    // Closed by default — only open after the admin expands it.
    return dayOpenMap[dayKey(productId, dateKey)] === true;
  };

  const toggleDay = (productId: string, dateKey: string, currentlyOpen: boolean) => {
    setDayOpenMap((prev) => ({
      ...prev,
      [dayKey(productId, dateKey)]: !currentlyOpen,
    }));
  };

  const expandAllProducts = () => {
    const next: Record<string, boolean> = {};
    for (const g of productGroups) next[g.productId] = true;
    setProductOpenMap(next);
    const days: Record<string, boolean> = {};
    for (const g of productGroups) {
      for (const d of g.days) days[dayKey(g.productId, d.dateKey)] = true;
    }
    setDayOpenMap(days);
  };

  const collapseAllProducts = () => {
    const next: Record<string, boolean> = {};
    for (const g of productGroups) next[g.productId] = false;
    setProductOpenMap(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/ticketing"
            className="text-sm text-stone-500 hover:text-[#D4AF37]"
          >
            ← Ticket products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">Sessions</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Schedule board for ticket products — pick a product, then manage
            timeslots by day. Open the guide if you are doing this for the first
            time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canWrite ? (
            <button
              type="button"
              className={`${btnPrimaryClass} shrink-0`}
              onClick={() => setShowTools((v) => !v)}
            >
              {showTools ? 'Hide schedule tools' : 'Add sessions'}
            </button>
          ) : null}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Sessions"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TICKETING_SESSIONS_GUIDE_STEPS}
      />

      {canWrite && showTools ? (
        <div className="space-y-4">
          <ScheduleWizard
            products={timedProducts}
            resources={allResourcesQuery.data ?? []}
            defaultProductId={filterProductId || initialProductId || productId}
            busy={createMutation.isPending}
            timeFormat={timeFormat}
            onExpand={() => setWizardResourcesReady(true)}
            onGenerate={async ({
              productId: pid,
              resourceId: rid,
              capacity: cap,
              slots,
            }) => {
              try {
                const result = await createMutation.mutateAsync({
                  productId: pid,
                  resourceId: rid,
                  capacity: cap,
                  slots,
                });
                const count =
                  result.count ?? result.sessions?.length ?? slots.length;
                addToast(
                  count > 1
                    ? `Created ${count} timeslots automatically`
                    : 'Timeslot created',
                  'success'
                );
                setProductId(pid);
                setFilterProductId(pid);
              } catch (err) {
                addToast(
                  err instanceof Error
                    ? err.message
                    : 'Could not generate schedule',
                  'error'
                );
                throw err;
              }
            }}
          />

          <form
            onSubmit={onCreate}
            className="space-y-3 rounded-lg border border-stone-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-stone-800">
              Create one session (manual)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                required
                value={productId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setProductId(nextId);
                  const product = timedProducts.find((p) => p.id === nextId);
                  setResourceId(product?.resourceId ?? '');
                  const defaultCap = product?.resource?.defaultCapacity;
                  if (defaultCap != null && defaultCap > 0) {
                    setCapacity(String(defaultCap));
                  }
                }}
                className={fieldClass}
              >
                <option value="">Ticket product</option>
                {timedProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                className={fieldClass}
              >
                <option value="">Resource (optional — inherits product)</option>
                {(resourcesQuery.data ?? [])
                  .filter((r) => !r.archivedAt)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.type}
                    </option>
                  ))}
              </select>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Slot name (optional)
                </span>
                <input
                  type="text"
                  maxLength={120}
                  value={slotLabel}
                  onChange={(e) => setSlotLabel(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Morning Adventure"
                />
              </label>
              <ClockDateTimeInput
                required
                value={startsAt}
                onChange={setStartsAt}
                hour12={hour12}
                aria-label="Starts at"
              />
              <ClockDateTimeInput
                required
                value={endsAt}
                onChange={setEndsAt}
                hour12={hour12}
                aria-label="Ends at"
              />
              <input
                type="number"
                min={0}
                required
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className={fieldClass}
                placeholder="Capacity"
              />
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Timeslot price override (optional)
                </span>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={priceOverride}
                  onChange={(e) => setPriceOverride(e.target.value)}
                  className={fieldClass}
                  placeholder="Leave blank to use product price bands"
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={series}
                onChange={(e) => setSeries(e.target.checked)}
              />
              Create series (repeat weekdays until date)
            </label>
            {series ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => (
                    <label
                      key={d.v}
                      className="inline-flex items-center gap-1 text-xs text-stone-700"
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
                <input
                  type="date"
                  required={series}
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className={`${fieldClass} max-w-xs`}
                />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={createMutation.isPending}
              className={btnPrimaryClass}
            >
              {createMutation.isPending ? <ButtonSpinner /> : null}
              Create
            </button>
          </form>
        </div>
      ) : null}

      {/* Product picker + filters */}
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[14rem] flex-1 space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Ticket product
            </span>
            <select
              value={filterProductId}
              onChange={(e) => selectFilterProduct(e.target.value)}
              className={fieldClass}
            >
              <option value="">All ticket products</option>
              {timedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatProductType(p.type)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
            />
            Include closed
          </label>
          {selectedDate ? (
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={() => selectCalendarDay(null)}
            >
              Clear day ({selectedDate})
            </button>
          ) : null}
        </div>

        {timedProducts.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            <button
              type="button"
              onClick={() => selectFilterProduct('')}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                !filterProductId
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900'
                  : 'border-stone-200 text-stone-600 hover:border-stone-300'
              }`}
            >
              All
            </button>
            {timedProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectFilterProduct(p.id)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  filterProductId === p.id
                    ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900'
                    : 'border-stone-200 text-stone-600 hover:border-stone-300'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Month calendar — live pulse from ticket sessions + capacity/holds */}
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">
              Session calendar
            </h2>
            <p className="mt-0.5 max-w-xl text-xs text-stone-500">
              Built from live ticket sessions for this month (same data as the
              table below). Badges = slot count; color = capacity pressure from
              bookings and temporary holds. Click a day to filter and expand
              matching products.
            </p>
          </div>
          {sessionsQuery.isFetching ? (
            <span className="text-xs text-stone-400">Syncing…</span>
          ) : null}
        </div>

        <div className="mb-1 flex items-center justify-between gap-3">
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() =>
              setCalendarMonth(
                (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)
              )
            }
          >
            ← Prev
          </button>
          <h3 className="text-sm font-semibold text-stone-800">{monthLabel}</h3>
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() =>
              setCalendarMonth(
                (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)
              )
            }
          >
            Next →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-400">
          {CAL_HEADERS.map((h) => (
            <div key={h} className="py-1">
              {h}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((cell, i) =>
            cell ? (
              <button
                key={cell.key}
                type="button"
                title={
                  cell.pulse
                    ? `${cell.pulse.count} session${cell.pulse.count === 1 ? '' : 's'} · ${cell.pulse.booked} booked · ${cell.pulse.held} held · ${cell.pulse.remaining} seats left`
                    : 'No sessions'
                }
                onClick={() =>
                  selectCalendarDay(
                    selectedDate === cell.key ? null : cell.key
                  )
                }
                className={`flex min-h-[3.5rem] flex-col items-center justify-center rounded-md border px-1 py-1.5 text-xs transition ${dayCellClass(
                  cell.key,
                  cell.pulse,
                  selectedDate === cell.key
                )}`}
              >
                <span className="font-semibold">{cell.day}</span>
                {cell.pulse && cell.pulse.count > 0 ? (
                  <span className="mt-0.5 rounded-full bg-white/80 px-1.5 text-[10px] tabular-nums text-stone-700 ring-1 ring-stone-200/80">
                    {cell.pulse.count}
                  </span>
                ) : (
                  <span className="mt-0.5 text-[10px] text-transparent">0</span>
                )}
              </button>
            ) : (
              <div key={`pad-${i}`} className="min-h-[3.5rem]" />
            )
          )}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-stone-100 pt-3 text-[11px] text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200 ring-1 ring-emerald-300" />
            Open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-200 ring-1 ring-amber-300" />
            Limited / holds
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-200 ring-1 ring-red-300" />
            Sold out
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-stone-200 ring-1 ring-stone-300" />
            Closed
          </span>
        </div>

        {selectedDate && selectedDayPulse ? (
          <div className="flex flex-col gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-stone-700">
              <span className="font-semibold">
                {formatDayHeading(selectedDate)}
              </span>
              <span className="text-stone-500">
                {' '}
                · {selectedDayPulse.count} session
                {selectedDayPulse.count === 1 ? '' : 's'} ·{' '}
                {selectedDayPulse.booked} booked
                {selectedDayPulse.held > 0
                  ? ` · ${selectedDayPulse.held} on hold`
                  : ''}{' '}
                · {selectedDayPulse.remaining}/{selectedDayPulse.capacity} seats
                left
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/bookings?visitFrom=${encodeURIComponent(selectedDate)}&visitTo=${encodeURIComponent(selectedDate)}`}
                className={btnSecondaryClass}
              >
                View bookings
              </Link>
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={() => selectCalendarDay(null)}
              >
                Clear day
              </button>
            </div>
          </div>
        ) : selectedDate ? (
          <div className="rounded-md border border-dashed border-stone-200 px-3 py-2 text-sm text-stone-500">
            No sessions on {formatDayHeading(selectedDate)}
            {filterProductId && filterProduct
              ? ` for ${filterProduct.name}`
              : ''}
            .{' '}
            <button
              type="button"
              className="font-medium text-[#D4AF37] hover:underline"
              onClick={() => selectCalendarDay(null)}
            >
              Clear day filter
            </button>
          </div>
        ) : null}
      </div>

      {/* Grouped schedule */}
      <div className="space-y-4">
        {sessionsQuery.isPending && allSessions.length === 0 ? (
          <p className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-sm text-stone-500">
            Loading sessions…
          </p>
        ) : productGroups.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-sm text-stone-500">
            No sessions
            {selectedDate ? ` on ${formatDayHeading(selectedDate)}` : ''}
            {filterProductId && filterProduct
              ? ` for ${filterProduct.name}`
              : ''}
            .
            {canWrite ? (
              <>
                {' '}
                <button
                  type="button"
                  className="font-medium text-[#D4AF37] hover:underline"
                  onClick={() => setShowTools(true)}
                >
                  Add sessions
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <>
            {productGroups.length > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-stone-500">
                  {productGroups.length} ticket products · use Actions to expand
                  a schedule
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnSecondaryClass}
                    onClick={expandAllProducts}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    className={btnSecondaryClass}
                    onClick={collapseAllProducts}
                  >
                    Collapse all
                  </button>
                </div>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="w-12 px-3 py-3 font-semibold">#</th>
                      <th className="px-4 py-3 font-semibold">Ticket product</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Sessions</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {productGroups.map((group, groupIndex) => {
                      const productOpen = isProductOpen(group.productId);
                      return (
                        <Fragment key={group.productId}>
                          <tr className="align-middle">
                            <td className="px-3 py-3 tabular-nums text-stone-500">
                              {groupIndex + 1}
                            </td>
                            <td className="px-4 py-3 font-medium text-stone-900">
                              {group.productName}
                              {selectedDate ? (
                                <span className="mt-0.5 block text-xs font-normal text-stone-500">
                                  Filtered · {formatDayHeading(selectedDate)}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-stone-600">
                              {formatProductType(group.productType)}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-stone-600">
                              {group.total}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  className={btnSecondaryClass}
                                  aria-expanded={productOpen}
                                  onClick={() =>
                                    toggleProduct(
                                      group.productId,
                                      productOpen
                                    )
                                  }
                                >
                                  {productOpen ? 'Collapse' : 'Expand'}
                                </button>
                                <Link
                                  href={`/admin/ticketing/products/${group.productId}`}
                                  className={btnSecondaryClass}
                                >
                                  Open product
                                </Link>
                                {canWrite ? (
                                  <button
                                    type="button"
                                    className={btnSecondaryClass}
                                    onClick={() => {
                                      setProductId(group.productId);
                                      setFilterProductId(group.productId);
                                      setShowTools(true);
                                    }}
                                  >
                                    Add sessions
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {productOpen ? (
                            <tr className="bg-stone-50/60">
                              <td colSpan={5} className="px-0 py-0">
                                <div className="divide-y divide-stone-100 border-t border-stone-100">
                                  {group.days.map((day) => {
                                    const dayOpen = isDayOpen(
                                      group.productId,
                                      day.dateKey
                                    );
                                    return (
                                      <div
                                        key={`${group.productId}-${day.dateKey}`}
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2">
                                          <button
                                            type="button"
                                            className="flex items-center gap-2 text-left"
                                            aria-expanded={dayOpen}
                                            onClick={() =>
                                              toggleDay(
                                                group.productId,
                                                day.dateKey,
                                                dayOpen
                                              )
                                            }
                                          >
                                            <span
                                              className={`inline-flex h-4 w-4 items-center justify-center text-xs text-stone-500 transition ${
                                                dayOpen ? 'rotate-90' : ''
                                              }`}
                                              aria-hidden
                                            >
                                              ›
                                            </span>
                                            <span className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                                              {formatDayHeading(day.dateKey)}
                                            </span>
                                            <span className="text-xs tabular-nums text-stone-500">
                                              · {day.sessions.length} slot
                                              {day.sessions.length === 1
                                                ? ''
                                                : 's'}
                                            </span>
                                          </button>
                                          <button
                                            type="button"
                                            className={btnSecondaryClass}
                                            onClick={() =>
                                              toggleDay(
                                                group.productId,
                                                day.dateKey,
                                                dayOpen
                                              )
                                            }
                                          >
                                            {dayOpen
                                              ? 'Collapse day'
                                              : 'Expand day'}
                                          </button>
                                        </div>
                                        {dayOpen ? (
                                          <div className="overflow-x-auto bg-white">
                                            <table className="min-w-full text-left text-sm">
                                              <thead className="border-y border-stone-100 text-xs uppercase tracking-wide text-stone-400">
                                                <tr>
                                                  <th className="w-10 px-3 py-2 font-semibold">
                                                    #
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Time
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Slot
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Resource
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Seats
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Price
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Status
                                                  </th>
                                                  <th className="px-3 py-2 font-semibold">
                                                    Actions
                                                  </th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-stone-50">
                                                {day.sessions.map(
                                                  (s, index) => {
                                                    const start = new Date(
                                                      s.startsAt
                                                    );
                                                    const end = new Date(
                                                      s.endsAt
                                                    );
                                                    const isEditing =
                                                      editingId === s.id;
                                                    return (
                                                      <Fragment key={s.id}>
                                                        <tr className="align-middle">
                                                          <td className="px-3 py-2.5 tabular-nums text-stone-400">
                                                            {index + 1}
                                                          </td>
                                                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-stone-900">
                                                            {formatClockTime(
                                                              start,
                                                              timeFormat
                                                            )}
                                                            <span className="font-normal text-stone-400">
                                                              {' '}
                                                              –{' '}
                                                              {formatClockTime(
                                                                end,
                                                                timeFormat
                                                              )}
                                                            </span>
                                                          </td>
                                                          <td className="px-3 py-2.5">
                                                            {s.label?.trim() ||
                                                              '—'}
                                                          </td>
                                                          <td className="px-3 py-2.5 text-stone-600">
                                                            {s.resource
                                                              ?.name ?? '—'}
                                                          </td>
                                                          <td className="px-3 py-2.5">
                                                            <span
                                                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${occupancyTone(
                                                                s.remaining,
                                                                s.capacity
                                                              )}`}
                                                            >
                                                              {s.remaining}/
                                                              {s.capacity}
                                                            </span>
                                                          </td>
                                                          <td className="px-3 py-2.5 tabular-nums text-stone-600">
                                                            {s.priceOverride !=
                                                            null
                                                              ? Number(
                                                                  s.priceOverride
                                                                ).toFixed(2)
                                                              : 'Bands'}
                                                          </td>
                                                          <td className="px-3 py-2.5">
                                                            {s.isClosed ? (
                                                              <span className="text-xs font-medium text-stone-500">
                                                                Closed
                                                              </span>
                                                            ) : s.remaining <=
                                                              0 ? (
                                                              <span className="text-xs font-medium text-red-700">
                                                                Sold out
                                                              </span>
                                                            ) : (
                                                              <span className="text-xs font-medium text-emerald-700">
                                                                Open
                                                              </span>
                                                            )}
                                                          </td>
                                                          <td className="px-3 py-2.5">
                                                            <div className="flex flex-wrap gap-1.5">
                                                              <Link
                                                                href={`/admin/bookings?sessionId=${s.id}`}
                                                                className={
                                                                  btnSecondaryClass
                                                                }
                                                              >
                                                                Bookings
                                                              </Link>
                                                              {canWrite &&
                                                              !s.isClosed ? (
                                                                <>
                                                                  <button
                                                                    type="button"
                                                                    className={
                                                                      btnSecondaryClass
                                                                    }
                                                                    onClick={() =>
                                                                      isEditing
                                                                        ? cancelEdit()
                                                                        : startEdit(
                                                                            s
                                                                          )
                                                                    }
                                                                  >
                                                                    {isEditing
                                                                      ? 'Cancel'
                                                                      : 'Edit'}
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    className={
                                                                      btnDangerClass
                                                                    }
                                                                    disabled={
                                                                      closeMutation.isPending
                                                                    }
                                                                    onClick={() => {
                                                                      if (
                                                                        !window.confirm(
                                                                          'Close this session?'
                                                                        )
                                                                      ) {
                                                                        return;
                                                                      }
                                                                      closeMutation.mutate(
                                                                        s.id,
                                                                        {
                                                                          onSuccess:
                                                                            () =>
                                                                              addToast(
                                                                                'Session closed',
                                                                                'success'
                                                                              ),
                                                                          onError:
                                                                            (
                                                                              err: Error
                                                                            ) =>
                                                                              addToast(
                                                                                err.message ||
                                                                                  'Close failed',
                                                                                'error'
                                                                              ),
                                                                        }
                                                                      );
                                                                    }}
                                                                  >
                                                                    Close
                                                                  </button>
                                                                </>
                                                              ) : null}
                                                            </div>
                                                          </td>
                                                        </tr>
                                                        {isEditing ? (
                                                          <tr className="bg-stone-50">
                                                            <td
                                                              colSpan={8}
                                                              className="px-4 py-3"
                                                            >
                                                              <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
                                                                <label className="block space-y-1 sm:col-span-2">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Slot name
                                                                  </span>
                                                                  <input
                                                                    type="text"
                                                                    maxLength={
                                                                      120
                                                                    }
                                                                    value={
                                                                      editLabel
                                                                    }
                                                                    onChange={(
                                                                      e
                                                                    ) =>
                                                                      setEditLabel(
                                                                        e
                                                                          .target
                                                                          .value
                                                                      )
                                                                    }
                                                                    className={
                                                                      fieldClass
                                                                    }
                                                                    placeholder="e.g. Morning Adventure"
                                                                  />
                                                                </label>
                                                                <label className="block space-y-1">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Starts at
                                                                  </span>
                                                                  <ClockDateTimeInput
                                                                    value={
                                                                      editStartsAt
                                                                    }
                                                                    onChange={
                                                                      setEditStartsAt
                                                                    }
                                                                    hour12={
                                                                      hour12
                                                                    }
                                                                    aria-label="Starts at"
                                                                  />
                                                                </label>
                                                                <label className="block space-y-1">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Ends at
                                                                  </span>
                                                                  <ClockDateTimeInput
                                                                    value={
                                                                      editEndsAt
                                                                    }
                                                                    onChange={
                                                                      setEditEndsAt
                                                                    }
                                                                    hour12={
                                                                      hour12
                                                                    }
                                                                    aria-label="Ends at"
                                                                  />
                                                                </label>
                                                                <label className="block space-y-1">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Capacity
                                                                  </span>
                                                                  <input
                                                                    type="number"
                                                                    min={0}
                                                                    value={
                                                                      editCapacity
                                                                    }
                                                                    onChange={(
                                                                      e
                                                                    ) =>
                                                                      setEditCapacity(
                                                                        e
                                                                          .target
                                                                          .value
                                                                      )
                                                                    }
                                                                    className={
                                                                      fieldClass
                                                                    }
                                                                  />
                                                                </label>
                                                                <label className="block space-y-1">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Remaining
                                                                  </span>
                                                                  <input
                                                                    type="number"
                                                                    min={0}
                                                                    value={
                                                                      editRemaining
                                                                    }
                                                                    onChange={(
                                                                      e
                                                                    ) =>
                                                                      setEditRemaining(
                                                                        e
                                                                          .target
                                                                          .value
                                                                      )
                                                                    }
                                                                    className={
                                                                      fieldClass
                                                                    }
                                                                  />
                                                                </label>
                                                                <label className="block space-y-1 sm:col-span-2">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Timeslot
                                                                    price
                                                                    override
                                                                  </span>
                                                                  <input
                                                                    type="number"
                                                                    min={0.01}
                                                                    step="0.01"
                                                                    value={
                                                                      editPriceOverride
                                                                    }
                                                                    onChange={(
                                                                      e
                                                                    ) =>
                                                                      setEditPriceOverride(
                                                                        e
                                                                          .target
                                                                          .value
                                                                      )
                                                                    }
                                                                    className={
                                                                      fieldClass
                                                                    }
                                                                    placeholder="Blank = use product bands"
                                                                  />
                                                                </label>
                                                                <label className="block space-y-1 sm:col-span-2">
                                                                  <span className="text-xs font-semibold uppercase text-stone-500">
                                                                    Resource
                                                                    (optional)
                                                                  </span>
                                                                  <select
                                                                    value={
                                                                      editResourceId
                                                                    }
                                                                    onChange={(
                                                                      e
                                                                    ) =>
                                                                      setEditResourceId(
                                                                        e
                                                                          .target
                                                                          .value
                                                                      )
                                                                    }
                                                                    className={
                                                                      fieldClass
                                                                    }
                                                                  >
                                                                    <option value="">
                                                                      None
                                                                    </option>
                                                                    {editResourceId &&
                                                                    !(
                                                                      resourcesQuery.data ??
                                                                      []
                                                                    ).some(
                                                                      (r) =>
                                                                        r.id ===
                                                                        editResourceId
                                                                    ) &&
                                                                    s.resource ? (
                                                                      <option
                                                                        value={
                                                                          s
                                                                            .resource
                                                                            .id
                                                                        }
                                                                      >
                                                                        {
                                                                          s
                                                                            .resource
                                                                            .name
                                                                        }{' '}
                                                                        (current)
                                                                      </option>
                                                                    ) : null}
                                                                    {(
                                                                      resourcesQuery.data ??
                                                                      []
                                                                    )
                                                                      .filter(
                                                                        (r) =>
                                                                          !r.archivedAt
                                                                      )
                                                                      .map(
                                                                        (
                                                                          r
                                                                        ) => (
                                                                          <option
                                                                            key={
                                                                              r.id
                                                                            }
                                                                            value={
                                                                              r.id
                                                                            }
                                                                          >
                                                                            {
                                                                              r.name
                                                                            }{' '}
                                                                            ·{' '}
                                                                            {
                                                                              r.type
                                                                            }
                                                                          </option>
                                                                        )
                                                                      )}
                                                                  </select>
                                                                </label>
                                                                <div className="flex gap-2 sm:col-span-2">
                                                                  <button
                                                                    type="button"
                                                                    className={
                                                                      btnPrimaryClass
                                                                    }
                                                                    disabled={
                                                                      patchMutation.isPending
                                                                    }
                                                                    onClick={() =>
                                                                      saveEdit(
                                                                        s.id
                                                                      )
                                                                    }
                                                                  >
                                                                    {patchMutation.isPending ? (
                                                                      <ButtonSpinner />
                                                                    ) : null}
                                                                    Save
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    className={
                                                                      btnSecondaryClass
                                                                    }
                                                                    onClick={
                                                                      cancelEdit
                                                                    }
                                                                  >
                                                                    Cancel
                                                                  </button>
                                                                </div>
                                                              </div>
                                                            </td>
                                                          </tr>
                                                        ) : null}
                                                      </Fragment>
                                                    );
                                                  }
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
