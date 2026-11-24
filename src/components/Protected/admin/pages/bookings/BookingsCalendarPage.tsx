'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import {
  listTicketSessions,
  ticketingKeys,
  type TicketSessionDto,
} from '@/services/ticketing';
import {
  adminBookingKeys,
  listAdminBookings,
  type AdminBookingDto,
} from '@/services/adminBookings';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { btnPrimaryClass, btnSecondaryClass } from '../ticketing/ticketingUi';
import { formatClockTime } from '@/lib/timeClock';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import {
  addDaysToYmd,
  dateKeyFromIso,
  monthRangeKeys,
  todayKeyInZone,
} from '@/components/common/BookingDateCalendar';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BOOKINGS_CALENDAR_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

type ViewMode = 'month' | 'week' | 'day';

export type BookingsCalendarPageProps = {
  presentation?: 'page' | 'modal';
  onCreateBooking?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onSelectBooking?: (bookingId: string) => void;
};

type ProductLegend = {
  productId: string;
  name: string;
  color: ProductColor;
};

type ProductColor = {
  dot: string;
  chip: string;
  chipSold: string;
  chipLimited: string;
};

type DayEvent =
  | {
      kind: 'booking';
      key: string;
      bookingId: string;
      sessionId: string | null;
      productId: string;
      productName: string;
      title: string;
      startsAt: string;
      status: string;
      color: ProductColor;
      /** Party room block (party bookings only). */
      party: { roomName: string | null } | null;
    }
  | {
      kind: 'session';
      key: string;
      sessionId: string;
      productId: string;
      productName: string;
      title: string;
      startsAt: string;
      remaining: number;
      capacity: number;
      isClosed: boolean;
      status?: TicketSessionDto['status'];
      color: ProductColor;
    };

const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const PRODUCT_PALETTE: ProductColor[] = [
  {
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-950 border-sky-200',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
  {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-950 border-emerald-200',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
  {
    dot: 'bg-[#D4AF37]',
    chip: 'bg-[#D4AF37]/15 text-stone-900 border-[#D4AF37]/40',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
  {
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-950 border-rose-200',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-100 text-rose-950 border-rose-300',
  },
  {
    dot: 'bg-teal-500',
    chip: 'bg-teal-50 text-teal-950 border-teal-200',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
  {
    dot: 'bg-orange-500',
    chip: 'bg-orange-50 text-orange-950 border-orange-200',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
  {
    dot: 'bg-indigo-500',
    chip: 'bg-indigo-50 text-indigo-950 border-indigo-200',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
  {
    dot: 'bg-stone-500',
    chip: 'bg-stone-100 text-stone-900 border-stone-300',
    chipLimited: 'bg-amber-50 text-amber-950 border-amber-200',
    chipSold: 'bg-rose-50 text-rose-950 border-rose-200',
  },
];

const MONTH_VISIBLE = 4;
const LIST_VISIBLE = 24;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function ymdFromParts(y: number, m0: number, d: number) {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m0: (m || 1) - 1, d: d || 1 };
}

function startOfWeekMonday(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function colorForProduct(productId: string): ProductColor {
  let h = 0;
  for (let i = 0; i < productId.length; i++) {
    h = (h * 31 + productId.charCodeAt(i)) >>> 0;
  }
  return PRODUCT_PALETTE[h % PRODUCT_PALETTE.length]!;
}

function admissionLine(b: AdminBookingDto) {
  return (
    b.lines.find((l) => l.sessionId) ||
    b.lines.find((l) => l.productType !== 'add_on') ||
    b.lines[0] ||
    null
  );
}

function sessionAvailTone(
  remaining: number,
  capacity: number,
  isClosed: boolean,
  status?: TicketSessionDto['status']
): 'open' | 'limited' | 'sold' | 'closed' {
  if (isClosed || status === 'closed') return 'closed';
  if (status === 'sold_out' || remaining <= 0) return 'sold';
  if (status === 'limited' || status === 'held' || (capacity > 0 && remaining / capacity <= 0.5)) {
    return 'limited';
  }
  return 'open';
}

function chipClass(color: ProductColor, tone: 'open' | 'limited' | 'sold' | 'closed') {
  if (tone === 'sold' || tone === 'closed') return color.chipSold;
  if (tone === 'limited') return color.chipLimited;
  return color.chip;
}

function monthLabel(y: number, m0: number) {
  return new Date(y, m0, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function rangeIsoForView(mode: ViewMode, anchorYmd: string) {
  const { y, m0, d } = parseYmd(anchorYmd);
  const local = new Date(y, m0, d, 12, 0, 0);
  if (mode === 'day') {
    const from = new Date(y, m0, d, 0, 0, 0, 0);
    const to = new Date(y, m0, d, 23, 59, 59, 999);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      visitFrom: anchorYmd,
      visitTo: anchorYmd,
      dayKeys: [anchorYmd],
    };
  }
  if (mode === 'week') {
    const start = startOfWeekMonday(local);
    const keys: string[] = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(start);
      x.setDate(start.getDate() + i);
      keys.push(ymdFromParts(x.getFullYear(), x.getMonth(), x.getDate()));
    }
    const from = new Date(start);
    from.setHours(0, 0, 0, 0);
    const to = new Date(start);
    to.setDate(to.getDate() + 6);
    to.setHours(23, 59, 59, 999);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      visitFrom: keys[0]!,
      visitTo: keys[6]!,
      dayKeys: keys,
    };
  }
  const { from: fromYmd, to: toYmd } = monthRangeKeys(y, m0);
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const from = new Date(fy!, fm! - 1, fd!, 0, 0, 0, 0);
  const to = new Date(ty!, tm! - 1, td!, 23, 59, 59, 999);
  const gridStart = startOfWeekMonday(from);
  const gridEnd = startOfWeekMonday(to);
  gridEnd.setDate(gridEnd.getDate() + 6);
  gridEnd.setHours(23, 59, 59, 999);
  const gridFromYmd = ymdFromParts(
    gridStart.getFullYear(),
    gridStart.getMonth(),
    gridStart.getDate()
  );
  const gridToYmd = ymdFromParts(
    gridEnd.getFullYear(),
    gridEnd.getMonth(),
    gridEnd.getDate()
  );
  return {
    from: gridStart.toISOString(),
    to: gridEnd.toISOString(),
    visitFrom: gridFromYmd,
    visitTo: gridToYmd,
    dayKeys: [] as string[],
    monthY: y,
    monthM0: m0,
    gridStart,
    gridEnd,
  };
}

export default function BookingsCalendarPage({
  presentation = 'page',
  onCreateBooking,
  onSelectSession,
  onSelectBooking,
}: BookingsCalendarPageProps) {
  const router = useRouter();
  const can = useAuthStore((s) => s.can);
  const canCreateBooking = can(P.BookingsCreate) || can(P.BookingsWrite);
  const canReadBookings = can(P.BookingsRead) || can(P.BookingsCalendarRead);
  const { locationId } = useHqLocationFilter();
  const { timeFormat } = useTimeClockFormat(locationId || null);

  const today = todayKeyInZone(null);
  const [mode, setMode] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(today);
  const [hiddenProducts, setHiddenProducts] = useState<Set<string>>(new Set());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const isModal = presentation === 'modal';

  const createHref = locationId
    ? `/admin/bookings/new?locationId=${encodeURIComponent(locationId)}`
    : '/admin/bookings/new';

  const range = useMemo(() => rangeIsoForView(mode, anchor), [mode, anchor]);

  const sessionsFilters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      includeClosed: true as const,
    }),
    [range.from, range.to]
  );
  const sessionsKey = ticketingKeys.sessions(sessionsFilters);
  const sessionsQ = useQuery({
    queryKey: sessionsKey,
    queryFn: () => listTicketSessions(sessionsFilters),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(sessionsKey),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
    enabled: canReadBookings,
  });
  const sessions = useMemo(() => {
    const all = sessionsQ.data ?? [];
    if (!locationId) return all;
    return all.filter((s) => s.locationId === locationId);
  }, [sessionsQ.data, locationId]);

  const bookingFilters = useMemo(
    () => ({
      visitFrom: range.visitFrom,
      visitTo: range.visitTo,
      locationId: locationId || undefined,
      take: 200,
      includeClosed: false as const,
    }),
    [range.visitFrom, range.visitTo, locationId]
  );
  const bookingsKey = adminBookingKeys.list(bookingFilters);
  const bookingsQ = useQuery({
    queryKey: bookingsKey,
    queryFn: () => listAdminBookings(bookingFilters),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(bookingsKey),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
    enabled: canReadBookings,
  });
  const bookings = bookingsQ.data?.bookings ?? [];
  const bookingsTotal = bookingsQ.data?.total ?? bookings.length;
  const bookingsTruncated = bookingsTotal > bookings.length;

  const legend = useMemo((): ProductLegend[] => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.product?.id) map.set(s.product.id, s.product.name);
    }
    for (const b of bookings) {
      const line = admissionLine(b);
      if (line?.productId) map.set(line.productId, line.productName);
    }
    return [...map.entries()]
      .map(([productId, name]) => ({
        productId,
        name,
        color: colorForProduct(productId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions, bookings]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    const push = (day: string, ev: DayEvent) => {
      if (hiddenProducts.has(ev.productId)) return;
      const list = map.get(day) ?? [];
      list.push(ev);
      map.set(day, list);
    };

    const bookedSessionIds = new Set<string>();

    for (const b of bookings) {
      const line = admissionLine(b);
      const productId = line?.productId || 'unknown';
      const productName = line?.productName || 'Booking';
      const startsAt =
        b.visitStartsAt || line?.visitDate || b.createdAt;
      const day = dateKeyFromIso(startsAt);
      if (!day) continue;
      if (line?.sessionId) bookedSessionIds.add(line.sessionId);
      push(day, {
        kind: 'booking',
        key: `b:${b.id}`,
        bookingId: b.id,
        sessionId: line?.sessionId ?? null,
        productId,
        productName: b.partyDetail
          ? `Party${b.partyDetail.roomName ? ` · ${b.partyDetail.roomName}` : ''}`
          : productName,
        title:
          b.partyDetail?.partyName?.trim() ||
          b.primaryContactName?.trim() ||
          b.account?.name?.trim() ||
          b.publicId,
        startsAt,
        status: b.status,
        color: colorForProduct(productId),
        party: b.partyDetail ? { roomName: b.partyDetail.roomName ?? null } : null,
      });
    }

    for (const s of sessions) {
      const day = dateKeyFromIso(s.startsAt);
      if (!day) continue;
      const productId = s.product?.id || s.productId;
      const productName = s.product?.name || 'Session';
      // Always surface capacity for open inventory; skip closed empty noise
      // when the slot already has bookings shown.
      const tone = sessionAvailTone(
        s.remaining,
        s.capacity,
        s.isClosed,
        s.status
      );
      if (bookedSessionIds.has(s.id) && tone === 'sold') continue;
      if (s.isClosed && s.remaining <= 0 && bookedSessionIds.has(s.id)) continue;
      push(day, {
        kind: 'session',
        key: `s:${s.id}`,
        sessionId: s.id,
        productId,
        productName,
        title: s.label?.trim() || productName,
        startsAt: s.startsAt,
        remaining: s.remaining,
        capacity: s.capacity,
        isClosed: s.isClosed,
        status: s.status,
        color: colorForProduct(productId),
      });
    }

    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
    }
    return map;
  }, [bookings, sessions, hiddenProducts]);

  const monthCells = useMemo(() => {
    if (mode !== 'month' || !('gridStart' in range) || !range.gridStart) {
      return [] as { ymd: string; inMonth: boolean }[];
    }
    const { y, m0 } = parseYmd(anchor);
    const cells: { ymd: string; inMonth: boolean }[] = [];
    const cursor = new Date(range.gridStart);
    const end = range.gridEnd!;
    while (cursor <= end) {
      const ymd = ymdFromParts(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate()
      );
      cells.push({
        ymd,
        inMonth: cursor.getFullYear() === y && cursor.getMonth() === m0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return cells;
  }, [mode, range, anchor]);

  const listDayKeys = useMemo(() => {
    if (mode === 'month') return [];
    if (mode === 'day') return [anchor];
    return range.dayKeys ?? [];
  }, [mode, anchor, range]);

  const loading =
    (sessionsQ.isPending && sessions.length === 0) ||
    (bookingsQ.isPending && bookings.length === 0);

  const loadError =
    (sessionsQ.isError && sessions.length === 0
      ? sessionsQ.error instanceof Error
        ? sessionsQ.error.message
        : 'Could not load sessions'
      : null) ||
    (bookingsQ.isError && bookings.length === 0
      ? bookingsQ.error instanceof Error
        ? bookingsQ.error.message
        : 'Could not load bookings'
      : null);

  const { y: anchorY, m0: anchorM0 } = parseYmd(anchor);

  function goToday() {
    setAnchor(today);
    setExpandedDay(null);
  }

  function shift(delta: number) {
    setExpandedDay(null);
    if (mode === 'month') {
      const next = new Date(anchorY, anchorM0 + delta, 1);
      setAnchor(ymdFromParts(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    setAnchor(addDaysToYmd(anchor, mode === 'week' ? delta * 7 : delta));
  }

  function toggleProduct(productId: string) {
    setHiddenProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function openSession(sessionId: string) {
    if (isModal && onSelectSession) {
      onSelectSession(sessionId);
      return;
    }
    router.push(`/admin/bookings?sessionId=${encodeURIComponent(sessionId)}`);
  }

  function openBooking(bookingId: string, sessionId: string | null, isParty = false) {
    if (isParty) {
      router.push(`/admin/parties/${bookingId}`);
      return;
    }
    if (isModal && onSelectBooking) {
      onSelectBooking(bookingId);
      return;
    }
    if (isModal && sessionId && onSelectSession) {
      onSelectSession(sessionId);
      return;
    }
    router.push(`/admin/bookings/${bookingId}`);
  }

  function renderEventChip(ev: DayEvent, compact: boolean) {
    const time = formatClockTime(ev.startsAt, timeFormat);
    if (ev.kind === 'booking') {
      return (
        <button
          key={ev.key}
          type="button"
          title={`${time} · ${ev.title} · ${ev.productName} (${ev.status})`}
          className={`flex w-full min-w-0 items-start gap-1.5 overflow-hidden rounded border px-1.5 py-1 text-left transition hover:brightness-95 ${ev.color.chip} ${
            ev.party ? 'border-l-4 border-l-[#D4AF37]' : ''
          }`}
          onClick={() => openBooking(ev.bookingId, ev.sessionId, Boolean(ev.party))}
        >
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ev.color.dot}`}
            aria-hidden
          />
          <span className="min-w-0 flex-1 overflow-hidden leading-snug">
            {compact ? (
              <span className="block truncate text-[11px] sm:text-xs">
                <span className="font-semibold">{time}</span> {ev.title}
              </span>
            ) : (
              <span className="block">
                <span className="font-medium">{time}</span> {ev.title}
              </span>
            )}
            {ev.party ? (
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                Party{ev.party.roomName ? ` · ${ev.party.roomName}` : ''}
              </span>
            ) : null}
          </span>
        </button>
      );
    }
    const tone = sessionAvailTone(
      ev.remaining,
      ev.capacity,
      ev.isClosed,
      ev.status
    );
    const avail =
      tone === 'closed'
        ? 'Closed'
        : tone === 'sold'
          ? 'Full'
          : `${ev.remaining}/${ev.capacity} left`;
    return (
      <button
        key={ev.key}
        type="button"
        title={`${time} · ${ev.title} · ${avail}`}
        className={`flex w-full min-w-0 items-start gap-1.5 overflow-hidden rounded border px-1.5 py-1 text-left transition hover:brightness-95 ${chipClass(ev.color, tone)}`}
        onClick={() => openSession(ev.sessionId)}
      >
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ev.color.dot}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 overflow-hidden leading-snug">
          {compact ? (
            <>
              <span className="block truncate text-[11px] sm:text-xs">
                <span className="font-semibold">{time}</span> {ev.title}
              </span>
              <span className="mt-0.5 block truncate text-[10px] opacity-80">
                {avail}
              </span>
            </>
          ) : (
            <>
              <span className="block">
                <span className="font-medium">{time}</span> {ev.title}
              </span>
              <span className="mt-0.5 block text-[11px] opacity-80">{avail}</span>
            </>
          )}
        </span>
      </button>
    );
  }

  const viewToggle = (id: ViewMode, label: string) => (
    <button
      key={id}
      type="button"
      className={
        mode === id
          ? 'rounded-md bg-[#D4AF37] px-3 py-1.5 text-sm font-medium text-stone-900'
          : 'rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50'
      }
      onClick={() => {
        setMode(id);
        setExpandedDay(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            Calendar
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Live sessions and bookings. New here? Open the guide for views,
            chips, and capacity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canCreateBooking ? (
            isModal && onCreateBooking ? (
              <button
                type="button"
                className={btnPrimaryClass}
                onClick={onCreateBooking}
              >
                Create booking
              </button>
            ) : (
              <Link href={createHref} className={btnPrimaryClass}>
                Create booking
              </Link>
            )
          ) : null}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Calendar"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BOOKINGS_CALENDAR_GUIDE_STEPS}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btnSecondaryClass}
            aria-label="Previous"
            onClick={() => shift(-1)}
          >
            ‹
          </button>
          <button type="button" className={btnSecondaryClass} onClick={goToday}>
            Today
          </button>
          <button
            type="button"
            className={btnSecondaryClass}
            aria-label="Next"
            onClick={() => shift(1)}
          >
            ›
          </button>
          <h2 className="ml-1 text-lg font-semibold text-stone-900">
            {mode === 'month'
              ? monthLabel(anchorY, anchorM0)
              : mode === 'week'
                ? `Week of ${anchor}`
                : anchor}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewToggle('month', 'Monthly')}
          {viewToggle('week', 'Week')}
          {viewToggle('day', 'Daily')}
        </div>
      </div>

      {mode === 'month' ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
          <span className="font-medium text-stone-800">How to use the grid:</span>{' '}
          The gold circle is <span className="font-medium">today</span>. Click
          any <span className="font-medium">date number</span> to open that
          day’s events in Daily view. Click a{' '}
          <span className="font-medium">colored chip</span> to open that booking
          or session. Use <span className="font-medium">+ N more</span> when a
          day is crowded.
        </p>
      ) : null}

      {legend.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Products
              {legend.length > 1 ? (
                <span className="ml-1.5 font-normal normal-case text-stone-400">
                  ({legend.length}) — click to show/hide
                </span>
              ) : null}
            </span>
            <span className="text-xs text-stone-500">
              Open · Limited · Full
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {legend.map((p) => {
              const on = !hiddenProducts.has(p.productId);
              return (
                <label
                  key={p.productId}
                  className={`inline-flex max-w-full cursor-pointer items-center gap-2 text-sm ${
                    on ? 'text-stone-800' : 'text-stone-400 line-through'
                  }`}
                  title={
                    on
                      ? `Hide ${p.name} on the calendar`
                      : `Show ${p.name} on the calendar`
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => toggleProduct(p.productId)}
                  />
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.color.dot} ${
                      on ? '' : 'opacity-30'
                    }`}
                    aria-hidden
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {loadError ? (
        <p
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {bookingsTruncated ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Showing {bookings.length} of {bookingsTotal} bookings in this range.
          Narrow the view (Daily / Week) or filter by park to see the rest.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-stone-500" role="status">
          Loading calendar…
        </p>
      ) : null}

      {mode === 'month' ? (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50">
            {WEEKDAYS_MON.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-stone-500"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-fr [&>*]:min-w-0">
            {monthCells.map((cell) => {
              const events = eventsByDay.get(cell.ymd) ?? [];
              const isToday = cell.ymd === today;
              const expanded = expandedDay === cell.ymd;
              const visible = expanded
                ? events
                : events.slice(0, MONTH_VISIBLE);
              const more = events.length - visible.length;
              return (
                <div
                  key={cell.ymd}
                  className={`min-h-[7.5rem] min-w-0 overflow-hidden border-b border-r border-stone-100 p-1.5 ${
                    cell.inMonth ? 'bg-white' : 'bg-stone-50/80'
                  }`}
                >
                  <button
                    type="button"
                    className={`mb-1 flex flex-col items-center gap-0.5 rounded-md px-0.5 py-0.5 text-xs font-semibold transition-colors ${
                      isToday
                        ? 'text-stone-900'
                        : cell.inMonth
                          ? 'text-stone-800 hover:bg-stone-100'
                          : 'text-stone-400 hover:bg-stone-100'
                    }`}
                    title={
                      isToday
                        ? 'Today — click to see today’s events in Daily view'
                        : `Click ${cell.ymd} to see that day’s events in Daily view`
                    }
                    aria-label={
                      isToday
                        ? 'Today — open Daily view for today’s events'
                        : `Open Daily view for ${cell.ymd}`
                    }
                    onClick={() => {
                      setAnchor(cell.ymd);
                      setMode('day');
                    }}
                  >
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full ${
                        isToday
                          ? 'bg-[#D4AF37] ring-2 ring-[#D4AF37]/40 ring-offset-1'
                          : ''
                      }`}
                    >
                      {Number(cell.ymd.slice(-2))}
                    </span>
                    {isToday ? (
                      <span className="text-[9px] font-medium uppercase tracking-wide text-[#D4AF37]">
                        Today
                      </span>
                    ) : null}
                  </button>
                  <div className="min-w-0 space-y-1 overflow-hidden">
                    {visible.map((ev) => renderEventChip(ev, true))}
                    {more > 0 ? (
                      <button
                        type="button"
                        className="w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        onClick={() =>
                          setExpandedDay(expanded ? null : cell.ymd)
                        }
                      >
                        + {more} more
                      </button>
                    ) : null}
                    {expanded && events.length > MONTH_VISIBLE ? (
                      <button
                        type="button"
                        className="w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-stone-500 hover:bg-stone-100"
                        onClick={() => setExpandedDay(null)}
                      >
                        Show less
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {listDayKeys.map((day) => {
            const events = eventsByDay.get(day) ?? [];
            const show = events.slice(0, LIST_VISIBLE);
            return (
              <section
                key={day}
                className="rounded-lg border border-stone-200 bg-white p-4"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-stone-900">
                    {day === today ? `Today · ${day}` : day}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {events.length} item{events.length === 1 ? '' : 's'}
                  </p>
                </div>
                {events.length === 0 ? (
                  <p className="text-sm text-stone-500">
                    No sessions or bookings on this day.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {show.map((ev) => renderEventChip(ev, false))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {!loading &&
      sessions.length === 0 &&
      bookings.length === 0 &&
      mode !== 'month' ? (
        <p className="text-sm text-stone-500">
          No sessions or bookings in this range. Create sessions under Ticketing
          → Sessions, or take a booking from Create booking.
        </p>
      ) : null}
    </div>
  );
}
