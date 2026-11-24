'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  PartyPopper,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { navigateAdminRoute } from '@/lib/adminInstantNav';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { usePartiesQuery, usePartyHostsQuery, usePartyRoomsQuery } from '@/hooks/useParties';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import {
  adminPartyKeys,
  getAdminParty,
  listAdminPartyMenu,
  listAdminPartyPackages,
  type PartyListRow,
  type PartyListSummary,
} from '@/services/adminParties';
import PartyCreateSheet from './PartyCreateSheet';
import { PartiesErrorBanner, PartiesPageHeader, PartyScopeBanner, useActiveVenues } from './partiesUi';
import { usePartiesDesk } from './partiesDesk';
import PartiesLiveStatus, { useNow } from './PartiesLiveStatus';
import { OPS_STATUS_LABELS, balanceChip, centsLabel, shiftYmd, timeInZone, todayInZone } from './partyFormat';

const PAGE_SIZE = 25;
const GOLD = '#D4AF37';

const OPS_TONE: Record<string, { chip: string; bar: string }> = {
  inquiry: { chip: 'bg-stone-100 text-stone-700 ring-stone-200', bar: 'bg-stone-300' },
  held: { chip: 'bg-amber-50 text-amber-800 ring-amber-200', bar: 'bg-amber-400' },
  confirmed: { chip: 'bg-sky-50 text-sky-800 ring-sky-200', bar: 'bg-sky-500' },
  checked_in: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', bar: 'bg-emerald-500' },
  in_progress: { chip: 'bg-violet-50 text-violet-800 ring-violet-200', bar: 'bg-violet-500' },
  completed: { chip: 'bg-stone-800 text-white ring-stone-800', bar: 'bg-stone-700' },
  cancelled: { chip: 'bg-red-50 text-red-700 ring-red-200', bar: 'bg-red-300' },
  no_show: { chip: 'bg-rose-50 text-rose-700 ring-rose-200', bar: 'bg-rose-400' },
};

const toolbarBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60';
const selectClass =
  'h-9 rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-800 shadow-sm transition focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function dayOffset(ymd: string, todayYmd: string): number {
  const a = Date.parse(`${ymd}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((a - b) / 86_400_000);
}

function relativeDay(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return offset > 0 ? `In ${offset} days` : `${-offset} days ago`;
}

function timing(row: PartyListRow, now: number): { label: string; tone: 'live' | 'soon' | 'later' | 'done' } | null {
  if (!row.visitStartsAt) return null;
  if (['cancelled', 'expired', 'refunded'].includes(row.status)) return null;
  const start = Date.parse(row.visitStartsAt);
  const end = row.visitEndsAt ? Date.parse(row.visitEndsAt) : start + 2 * 3_600_000;
  if (now >= end) return { label: 'Ended', tone: 'done' };
  if (now >= start) return { label: 'Happening now', tone: 'live' };
  const mins = Math.max(1, Math.round((start - now) / 60_000));
  if (mins < 60) return { label: `Starts in ${mins} min`, tone: 'soon' };
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return { label: `In ${h}h${mm ? ` ${mm}m` : ''}`, tone: 'later' };
}

const TIMING_CLASS = {
  live: 'text-emerald-700',
  soon: 'text-amber-700',
  later: 'text-stone-500',
  done: 'text-stone-400',
} as const;

function initials(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}

function summaryFromRows(rows: PartyListRow[], total: number): PartyListSummary {
  const live = rows.filter((r) => !['cancelled', 'expired', 'refunded'].includes(r.status));
  return {
    parties: total,
    kids: rows.reduce((s, r) => s + r.kidCount, 0),
    adults: rows.reduce((s, r) => s + r.adultCount, 0),
    balanceDueCents: live.reduce((s, r) => s + Math.max(0, r.amountDueCents), 0),
    waiversMissing: live.reduce((s, r) => s + r.waiverMissingCount, 0),
    unassignedRooms: live.filter((r) => !r.room).length,
  };
}

/* ───────────────────────────── small pieces ───────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'default',
  loading,
  active,
  onClick,
  busy,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warn' | 'good';
  loading?: boolean;
  active?: boolean;
  onClick?: () => void;
  busy?: boolean;
}) {
  const toneIcon =
    tone === 'warn'
      ? 'bg-amber-100 text-amber-800'
      : tone === 'good'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-[#D4AF37]/15 text-[#8a6d12]';
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneIcon}`}>{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          {label}
          {busy ? <Spin className="h-3 w-3 text-[#D4AF37]" /> : null}
        </span>
        {loading ? (
          <span className="mt-1.5 block h-6 w-16 animate-pulse rounded bg-stone-200" />
        ) : (
          <span className="mt-0.5 block truncate text-2xl font-semibold tabular-nums text-stone-900">{value}</span>
        )}
        {hint && !loading ? <span className="block truncate text-xs text-stone-500">{hint}</span> : null}
      </span>
    </>
  );
  const base = `flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm transition ${
    active ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/30' : 'border-stone-200'
  }`;
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} hover:border-[#D4AF37]/60 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/40`}
    >
      {body}
    </button>
  );
}

function StatusChip({ opsStatus }: { opsStatus: string }) {
  const tone = OPS_TONE[opsStatus] ?? OPS_TONE.inquiry!;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone.chip}`}>
      {OPS_STATUS_LABELS[opsStatus] ?? opsStatus}
    </span>
  );
}

function BalanceChip({ row }: { row: PartyListRow }) {
  const chip = balanceChip(row.amountDueCents, row.status);
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${chip.className}`}>{chip.label}</span>;
}

function WaiverChip({ row, enabled }: { row: PartyListRow; enabled: boolean }) {
  if (!enabled) return <span className="text-xs text-stone-400">Off</span>;
  if (row.waiverMissingCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        <ShieldAlert className="h-3 w-3" />
        {row.waiverMissingCount} missing
      </span>
    );
  }
  return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Complete</span>;
}

function HostCell({ row }: { row: PartyListRow }) {
  if (!row.host) return <span className="text-xs text-stone-400">No host</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold text-[#D4AF37]">
        {initials(row.host.name)}
      </span>
      <span className="truncate text-sm text-stone-800">{row.host.name}</span>
    </span>
  );
}

function RoomCell({ row }: { row: PartyListRow }) {
  if (row.room?.name) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-stone-800">
        <DoorOpen className="h-3.5 w-3.5 text-stone-400" />
        {row.room.name}
      </span>
    );
  }
  return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Unassigned</span>;
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-stone-100" aria-busy="true" aria-label="Loading parties">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
          <div className="h-10 w-1 rounded-full bg-stone-200" />
          <div className="w-16 space-y-1.5">
            <div className="h-3.5 w-12 rounded bg-stone-200" />
            <div className="h-2.5 w-10 rounded bg-stone-100" />
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-48 max-w-full rounded bg-stone-200" />
            <div className="h-2.5 w-32 rounded bg-stone-100" />
          </div>
          <div className="hidden h-5 w-20 rounded-full bg-stone-100 md:block" />
          <div className="hidden h-5 w-24 rounded-full bg-stone-100 md:block" />
          <div className="h-8 w-16 rounded-lg bg-stone-100" />
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function PartiesListPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin/parties';
  const sp = useSearchParams();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canCreate = can(P.PartiesWrite);
  const desk = usePartiesDesk();

  const { locationId, setLocationId, scopedLocationId, scopedLocationName, locationScoped } =
    useHqLocationFilter(sp?.get('locationId') ?? '');
  const { venues } = useActiveVenues(scopedLocationId);
  const venueTz = venues.find((v) => v.id === locationId)?.timezone ?? null;

  const todayYmd = todayInZone(venueTz);
  const rawDate = sp?.get('date') ?? '';
  const isToday = !rawDate || rawDate === 'today' || rawDate === todayYmd;
  const date = isToday ? todayYmd : rawDate;
  // "today" lets the server resolve each venue's own local day.
  const queryDate = isToday ? 'today' : rawDate;
  const offset = dayOffset(date, todayYmd);
  const q = sp?.get('q') ?? '';
  const opsStatus = sp?.get('opsStatus') ?? '';
  const amountDueOnly = sp?.get('due') === '1';
  const roomResourceId = sp?.get('room') ?? '';
  const hostStaffUserId = sp?.get('host') ?? '';
  const page = Math.max(1, Number(sp?.get('page') ?? 1) || 1);

  const [navPending, startNav] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const setParams = useCallback(
    (next: Record<string, string | null>, key?: string, resetPage = true) => {
      const params = new URLSearchParams(sp?.toString() ?? '');
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === '') params.delete(k);
        else params.set(k, v);
      }
      if (resetPage && !('page' in next)) params.delete('page');
      const s = params.toString();
      setPendingKey(key ?? null);
      startNav(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
    },
    [pathname, router, sp]
  );

  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParams({ q: search.trim() || null }, 'search'), 300);
    return () => clearTimeout(t);
  }, [search, q, setParams]);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filters = useMemo(
    () => ({
      date: queryDate,
      locationId: locationId || undefined,
      q: q || undefined,
      opsStatus: opsStatus || undefined,
      amountDueOnly: amountDueOnly || undefined,
      roomResourceId: roomResourceId || undefined,
      hostStaffUserId: hostStaffUserId || undefined,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    [queryDate, locationId, q, opsStatus, amountDueOnly, roomResourceId, hostStaffUserId, page]
  );
  const partiesQ = usePartiesQuery(filters);
  // Filter options wait for the list so it gets the connection pool first.
  const optionsReady = partiesQ.isFetchedAfterMount || Boolean(roomResourceId || hostStaffUserId);
  const roomsQ = usePartyRoomsQuery({ locationId: locationId || undefined }, optionsReady);
  const hostsQ = usePartyHostsQuery(optionsReady);

  const data = partiesQ.data;
  const rows = data?.parties ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const waiversEnabled = data?.waiversEnabled ?? false;
  const summary = data ? (data.summary ?? summaryFromRows(rows, total)) : null;
  const firstLoad = !data && partiesQ.isPending;
  const busy = navPending || (partiesQ.isFetching && partiesQ.isPlaceholderData);
  useEffect(() => {
    if (!busy) setPendingKey(null);
  }, [busy]);
  const isBusy = (key: string) => busy && pendingKey === key;

  const now = useNow(30_000);
  const showVenue = !locationId && venues.length > 1;
  const activeFilters =
    (q ? 1 : 0) + (opsStatus ? 1 : 0) + (amountDueOnly ? 1 : 0) + (roomResourceId ? 1 : 0) + (hostStaffUserId ? 1 : 0);
  const createHref = `/admin/parties/new${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`;
  const printHref = `/admin/parties/run-sheets?date=${date}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}&print=1`;

  /* Create party opens in a side sheet (wizard bundled with this page). Modified clicks still open the full page. */
  const [creating, setCreating] = useState(false);
  const warmCreate = useCallback(() => {
    // Same venue the wizard will start on → same cache keys it reads.
    const startVenue = locationId || scopedLocationId || (venues.length === 1 ? venues[0]!.id : '');
    const warm = <T,>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
      void qc.prefetchQuery({ queryKey, queryFn, staleTime: 30_000 }).catch(() => undefined);
    const pkgFilters = { locationId: startVenue || undefined, status: 'published' };
    warm(adminPartyKeys.packages(pkgFilters), () => listAdminPartyPackages(pkgFilters));
    if (startVenue) warm(adminPartyKeys.menu({ locationId: startVenue }), () => listAdminPartyMenu({ locationId: startVenue }));
  }, [qc, locationId, scopedLocationId, venues]);
  const onCreateClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setCreating(true);
  };

  /* Hover → warm the party detail so opening it paints instantly. */
  const hoverTimer = useRef<number | null>(null);
  const routeWarm = useRef(false);
  const warmParty = useCallback(
    (bookingId: string) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        void qc.prefetchQuery({
          queryKey: adminPartyKeys.detail(bookingId),
          queryFn: () => getAdminParty(bookingId),
          staleTime: 15_000,
        });
        if (!routeWarm.current) {
          routeWarm.current = true;
          try {
            router.prefetch(`/admin/parties/${bookingId}`);
          } catch {
            /* optional */
          }
        }
      }, 120);
    },
    [qc, router]
  );
  const cancelWarm = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);
  useEffect(() => cancelWarm, [cancelWarm]);

  const openParty = useCallback(
    (bookingId: string, e?: MouseEvent | KeyboardEvent) => {
      const href = `/admin/parties/${bookingId}`;
      if (e && 'metaKey' in e && (e.metaKey || e.ctrlKey)) {
        window.open(href, '_blank', 'noopener');
        return;
      }
      setOpeningId(bookingId);
      navigateAdminRoute(router, href);
    },
    [router]
  );

  const onRowClick = (bookingId: string) => (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a,button,input,select')) return;
    openParty(bookingId, e);
  };
  const onRowKey = (bookingId: string) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) openParty(bookingId, e);
  };

  const clearFilters = () => {
    setSearch('');
    setParams({ q: null, opsStatus: null, due: null, room: null, host: null }, 'clear');
  };

  return (
    <div className="space-y-5">
      <PartiesPageHeader
        title="Parties"
        description={
          <PartiesLiveStatus
            fetching={partiesQ.isFetching}
            updatedAt={partiesQ.dataUpdatedAt}
            failed={Boolean(partiesQ.error)}
            onRefresh={() => void partiesQ.refetch()}
          />
        }
        actions={
          <>
            <a
              href="/admin/parties/balances"
              className={toolbarBtn}
              onClick={(e) => {
                if (!desk || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                desk.openPanel('balances');
              }}
              onMouseEnter={() => desk?.warmPanel('balances')}
            >
              <Wallet className="h-4 w-4" />
              Balances
            </a>
            <a href={printHref} target="_blank" rel="noopener" className={toolbarBtn}>
              <Printer className="h-4 w-4" />
              Print day
            </a>
            {canCreate ? (
              <a href={createHref} className={primaryBtn} onMouseEnter={warmCreate} onFocus={warmCreate} onClick={onCreateClick}>
                <Plus className="h-4 w-4" />
                Create party
              </a>
            ) : null}
          </>
        }
      />
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />

      {/* Day navigator */}
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#8a6d12]">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold leading-tight text-stone-900">{dayLabel(date)}</p>
              <p className="text-xs text-stone-500">
                {relativeDay(offset)} · times shown in each venue&apos;s local time
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={toolbarBtn}
              onClick={() => setParams({ date: shiftYmd(date, -1) }, 'prev')}
              aria-label="Previous day"
            >
              {isBusy('prev') ? <Spin /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 shadow-sm">
              {[
                { key: 'yesterday', label: 'Yesterday', off: -1 },
                { key: 'today', label: 'Today', off: 0 },
                { key: 'tomorrow', label: 'Tomorrow', off: 1 },
              ].map((d) => {
                const active = offset === d.off;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() =>
                      setParams({ date: d.off === 0 ? null : shiftYmd(todayYmd, d.off) }, d.key)
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      active ? 'bg-white text-stone-900 shadow-sm ring-1 ring-[#D4AF37]/50' : 'text-stone-600 hover:text-stone-900'
                    }`}
                    aria-pressed={active}
                  >
                    {isBusy(d.key) ? <Spin className="h-3 w-3 text-[#D4AF37]" /> : null}
                    {d.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={toolbarBtn}
              onClick={() => setParams({ date: shiftYmd(date, 1) }, 'next')}
              aria-label="Next day"
            >
              {isBusy('next') ? <Spin /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => setParams({ date: e.target.value && e.target.value !== todayYmd ? e.target.value : null }, 'date')}
              className={`${selectClass} w-auto`}
              aria-label="Pick a date"
            />
          </div>
        </div>
      </section>

      {/* Day at a glance */}
      <section className={`grid gap-3 sm:grid-cols-2 ${waiversEnabled ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        <StatCard
          icon={<PartyPopper className="h-5 w-5" />}
          label="Parties"
          loading={firstLoad}
          value={summary?.parties ?? 0}
          hint={activeFilters ? 'matching your filters' : `booked for ${relativeDay(offset).toLowerCase()}`}
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Guests"
          loading={firstLoad}
          value={(summary?.kids ?? 0) + (summary?.adults ?? 0)}
          hint={`${summary?.kids ?? 0} kids · ${summary?.adults ?? 0} adults`}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Balance due"
          tone={(summary?.balanceDueCents ?? 0) > 0 ? 'warn' : 'good'}
          loading={firstLoad}
          value={centsLabel(summary?.balanceDueCents ?? 0)}
          hint={amountDueOnly ? 'Showing parties with a balance — click to show all' : 'Click to show only parties with a balance'}
          active={amountDueOnly}
          busy={isBusy('due')}
          onClick={() => setParams({ due: amountDueOnly ? null : '1' }, 'due')}
        />
        {waiversEnabled ? (
          <StatCard
            icon={<ShieldAlert className="h-5 w-5" />}
            label="Waivers missing"
            tone={(summary?.waiversMissing ?? 0) > 0 ? 'warn' : 'good'}
            loading={firstLoad}
            value={summary?.waiversMissing ?? 0}
            hint={(summary?.waiversMissing ?? 0) > 0 ? 'guests still need to sign' : 'everyone is covered'}
          />
        ) : null}
        <StatCard
          icon={<DoorOpen className="h-5 w-5" />}
          label="Rooms unassigned"
          tone={(summary?.unassignedRooms ?? 0) > 0 ? 'warn' : 'good'}
          loading={firstLoad}
          value={summary?.unassignedRooms ?? 0}
          hint={(summary?.unassignedRooms ?? 0) > 0 ? 'parties without a room yet' : 'every party has a room'}
        />
      </section>

      {/* Filters */}
      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search party, honoree, contact, ID"
              className="h-9 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-16 text-sm text-stone-900 shadow-sm transition placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
              aria-label="Search parties"
            />
            <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {search !== q || isBusy('search') ? <Spin className="h-3.5 w-3.5 text-[#D4AF37]" /> : null}
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="hidden rounded border border-stone-200 px-1.5 text-[10px] text-stone-400 sm:inline">/</kbd>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!scopedLocationId && venues.length > 1 ? (
              <select
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setParams({ locationId: e.target.value || null, room: null }, 'venue');
                }}
                className={selectClass}
                aria-label="Venue"
              >
                <option value="">All venues</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={roomResourceId}
              onChange={(e) => setParams({ room: e.target.value || null }, 'room')}
              className={selectClass}
              aria-label="Room"
            >
              <option value="">{roomsQ.isFetching && !roomsQ.data ? 'Loading rooms…' : 'Any room'}</option>
              {(roomsQ.data ?? [])
                .filter((r) => !r.archivedAt)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
            <select
              value={hostStaffUserId}
              onChange={(e) => setParams({ host: e.target.value || null }, 'host')}
              className={selectClass}
              aria-label="Host"
            >
              <option value="">{hostsQ.isFetching && !hostsQ.data ? 'Loading hosts…' : 'Any host'}</option>
              {(hostsQ.data ?? []).map((h) => (
                <option key={h.userId} value={h.userId}>
                  {h.name}
                </option>
              ))}
            </select>
            {['venue', 'room', 'host'].some((k) => isBusy(k)) ? <Spin className="h-4 w-4 text-[#D4AF37]" /> : null}
            {activeFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              >
                {isBusy('clear') ? <Spin /> : <X className="h-3.5 w-3.5" />}
                Clear filters ({activeFilters})
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {[{ key: '', label: 'All statuses' }, ...Object.entries(OPS_STATUS_LABELS).map(([key, label]) => ({ key, label }))].map(
            (s) => {
              const active = opsStatus === s.key;
              return (
                <button
                  key={s.key || 'all'}
                  type="button"
                  onClick={() => setParams({ opsStatus: s.key || null }, `status:${s.key}`)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-stone-900 text-white shadow-sm'
                      : 'bg-stone-100 text-stone-600 hover:bg-[#D4AF37]/15 hover:text-stone-900'
                  }`}
                >
                  {s.key ? <span className={`h-1.5 w-1.5 rounded-full ${OPS_TONE[s.key]?.bar ?? 'bg-stone-400'}`} /> : null}
                  {s.label}
                  {isBusy(`status:${s.key}`) ? <Spin className="h-3 w-3" /> : null}
                </button>
              );
            }
          )}
        </div>
      </section>

      {partiesQ.error ? (
        <div className="space-y-2">
          <PartiesErrorBanner error={partiesQ.error} />
          <button type="button" className={toolbarBtn} onClick={() => void partiesQ.refetch()} disabled={partiesQ.isFetching}>
            {partiesQ.isFetching ? <Spin /> : <RefreshCw className="h-4 w-4" />}
            Try again
          </button>
        </div>
      ) : null}

      {/* Results */}
      <section className="relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className={`absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden ${busy ? 'opacity-100' : 'opacity-0'} transition-opacity`}>
          <div className="h-full w-1/3 animate-[partiesbar_1.1s_ease-in-out_infinite] rounded-full" style={{ background: GOLD }} />
        </div>
        <style>{`@keyframes partiesbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

        {firstLoad ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a6d12]">
              <PartyPopper className="h-7 w-7" />
            </span>
            {activeFilters ? (
              <>
                <p className="text-base font-semibold text-stone-900">No parties match these filters</p>
                <p className="max-w-sm text-sm text-stone-500">Try a different status, room, or host, or clear the filters.</p>
                <button type="button" className={toolbarBtn} onClick={clearFilters}>
                  {isBusy('clear') ? <Spin /> : <X className="h-4 w-4" />}
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-stone-900">No parties on {dayLabel(date)}</p>
                <p className="max-w-sm text-sm text-stone-500">
                  New bookings appear here automatically — online, phone, and walk-in parties included.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className={toolbarBtn} onClick={() => setParams({ date: shiftYmd(date, 1) }, 'empty-next')}>
                    {isBusy('empty-next') ? <Spin /> : null}
                    Check the next day
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  {canCreate ? (
                    <a href={createHref} className={primaryBtn} onMouseEnter={warmCreate} onClick={onCreateClick}>
                      <Plus className="h-4 w-4" />
                      Create party
                    </a>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className={`transition-opacity ${busy ? 'opacity-60' : 'opacity-100'}`}>
            {/* Desktop table */}
            <table className="hidden min-w-full text-left text-sm lg:table">
              <thead className="border-b border-stone-200 bg-stone-50/80 text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="w-1 p-0" aria-hidden />
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Party</th>
                  <th className="px-4 py-3 font-semibold">Guests</th>
                  <th className="px-4 py-3 font-semibold">Room</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Host</th>
                  <th className="px-4 py-3 font-semibold">Waivers</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((r) => {
                  const t = isToday ? timing(r, now) : null;
                  const opening = openingId === r.bookingId;
                  return (
                    <tr
                      key={r.bookingId}
                      tabIndex={0}
                      onClick={onRowClick(r.bookingId)}
                      onKeyDown={onRowKey(r.bookingId)}
                      onMouseEnter={() => warmParty(r.bookingId)}
                      onMouseLeave={cancelWarm}
                      onFocus={() => warmParty(r.bookingId)}
                      className={`group cursor-pointer align-middle transition hover:bg-[#D4AF37]/[0.06] focus:bg-[#D4AF37]/[0.06] focus:outline-none ${
                        opening ? 'bg-[#D4AF37]/[0.08]' : ''
                      }`}
                    >
                      <td className="w-1 p-0">
                        <div className={`ml-1 h-10 w-1 rounded-full ${OPS_TONE[r.opsStatus]?.bar ?? 'bg-stone-300'}`} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="block font-semibold tabular-nums text-stone-900">{timeInZone(r.visitStartsAt, r.timezone)}</span>
                        {t ? (
                          <span className={`flex items-center gap-1 text-xs ${TIMING_CLASS[t.tone]}`}>
                            {t.tone === 'live' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> : null}
                            {t.label}
                          </span>
                        ) : r.visitEndsAt ? (
                          <span className="text-xs text-stone-400">until {timeInZone(r.visitEndsAt, r.timezone)}</span>
                        ) : null}
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <span className="block truncate font-semibold text-stone-900 group-hover:text-[#8a6d12]">{r.partyName}</span>
                        <span className="block truncate text-xs text-stone-500">
                          {r.honoreeName ? (
                            <>
                              🎂 {r.honoreeName}
                              {r.honoreeAge != null ? ` (${r.honoreeAge})` : ''} ·{' '}
                            </>
                          ) : null}
                          {r.package?.name ?? 'Party'} · {r.publicId}
                          {showVenue ? ` · ${r.location.name}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-medium tabular-nums text-stone-900">{r.kidCount}</span>
                        <span className="text-stone-500"> kids</span>
                        {r.adultCount ? <span className="block text-xs text-stone-500">{r.adultCount} adults</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <RoomCell row={r} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <StatusChip opsStatus={r.opsStatus} />
                          <BalanceChip row={r} />
                        </div>
                      </td>
                      <td className="max-w-[12rem] px-4 py-3">
                        <HostCell row={r} />
                      </td>
                      <td className="px-4 py-3">
                        <WaiverChip row={r} enabled={waiversEnabled} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <AdminPendingLink
                            href={`/admin/parties/${r.bookingId}?tab=Run%20sheet`}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-stone-500 opacity-0 transition hover:bg-stone-100 hover:text-stone-900 focus:opacity-100 group-hover:opacity-100"
                            title="Run sheet"
                          >
                            <ClipboardList className="h-3.5 w-3.5" />
                            Run sheet
                          </AdminPendingLink>
                          <a
                            href={`/admin/parties/run-sheets?date=${date}&bookingId=${r.bookingId}&print=1`}
                            target="_blank"
                            rel="noopener"
                            className="rounded-md p-1.5 text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-stone-900 focus:opacity-100 group-hover:opacity-100"
                            title="Print run sheet"
                            aria-label="Print run sheet"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={(e) => openParty(r.bookingId, e)}
                            className="inline-flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-sm transition hover:border-[#D4AF37] hover:bg-[#D4AF37] hover:text-stone-950"
                          >
                            {opening ? <Spin className="h-3 w-3" /> : null}
                            {opening ? 'Opening' : 'Open'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile / tablet cards */}
            <ul className="divide-y divide-stone-100 lg:hidden">
              {rows.map((r) => {
                const t = isToday ? timing(r, now) : null;
                const opening = openingId === r.bookingId;
                return (
                  <li
                    key={r.bookingId}
                    tabIndex={0}
                    onClick={onRowClick(r.bookingId)}
                    onKeyDown={onRowKey(r.bookingId)}
                    onTouchStart={() => warmParty(r.bookingId)}
                    onMouseEnter={() => warmParty(r.bookingId)}
                    onMouseLeave={cancelWarm}
                    className={`flex cursor-pointer gap-3 p-4 transition active:bg-[#D4AF37]/10 ${opening ? 'bg-[#D4AF37]/[0.08]' : ''}`}
                  >
                    <div className={`w-1 shrink-0 rounded-full ${OPS_TONE[r.opsStatus]?.bar ?? 'bg-stone-300'}`} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-stone-900">{r.partyName}</p>
                          <p className="truncate text-xs text-stone-500">
                            {r.honoreeName ? `🎂 ${r.honoreeName}${r.honoreeAge != null ? ` (${r.honoreeAge})` : ''} · ` : ''}
                            {r.package?.name ?? 'Party'}
                            {showVenue ? ` · ${r.location.name}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold tabular-nums text-stone-900">{timeInZone(r.visitStartsAt, r.timezone)}</p>
                          {t ? <p className={`text-xs ${TIMING_CLASS[t.tone]}`}>{t.label}</p> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip opsStatus={r.opsStatus} />
                        <BalanceChip row={r} />
                        <RoomCell row={r} />
                        {waiversEnabled && r.waiverMissingCount > 0 ? <WaiverChip row={r} enabled /> : null}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
                        <span>
                          {r.kidCount} kids{r.adultCount ? ` · ${r.adultCount} adults` : ''}
                          {r.host ? ` · Host ${r.host.name}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => openParty(r.bookingId, e)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-stone-950"
                        >
                          {opening ? <Spin className="h-3 w-3" /> : null}
                          {opening ? 'Opening' : 'Open'}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-sm text-stone-600">
            <span className="tabular-nums">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={toolbarBtn}
                disabled={page <= 1 || busy}
                onClick={() => setParams({ page: page - 1 > 1 ? String(page - 1) : null }, 'page-prev', false)}
              >
                {isBusy('page-prev') ? <Spin /> : <ChevronLeft className="h-4 w-4" />}
                Previous
              </button>
              <button
                type="button"
                className={toolbarBtn}
                disabled={page >= pages || busy}
                onClick={() => setParams({ page: String(page + 1) }, 'page-next', false)}
              >
                Next
                {isBusy('page-next') ? <Spin /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {creating ? <PartyCreateSheet initialLocationId={locationId || undefined} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
