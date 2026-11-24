'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  ListChecks,
  NotebookPen,
  PartyPopper,
  Printer,
  Sparkles,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { usePartyRunSheetsQuery } from '@/hooks/useParties';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { adminPartyKeys, listAdminPartyRunSheets, type PartyRunSheetRow } from '@/services/adminParties';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { PartiesErrorBanner, useActiveVenues } from './partiesUi';
import { useInPartiesDesk } from './partiesDesk';
import PartiesLiveStatus, { useNow } from './PartiesLiveStatus';
import { OPS_STATUS_LABELS, centsLabel, formatInZone, shiftYmd, timeInZone, todayInZone } from './partyFormat';

const OPS_TONE: Record<string, string> = {
  inquiry: 'bg-stone-100 text-stone-700',
  held: 'bg-amber-50 text-amber-800',
  confirmed: 'bg-sky-50 text-sky-800',
  checked_in: 'bg-emerald-50 text-emerald-800',
  in_progress: 'bg-violet-50 text-violet-800',
  completed: 'bg-stone-800 text-white',
  cancelled: 'bg-red-50 text-red-700',
  no_show: 'bg-rose-50 text-rose-700',
};

const toolbarBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030]';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12))
  );
}

function relDay(ymd: string, today: string): string {
  const off = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (off === 0) return 'Today';
  if (off === 1) return 'Tomorrow';
  if (off === -1) return 'Yesterday';
  return off > 0 ? `In ${off} days` : `${-off} days ago`;
}

function partyTiming(s: PartyRunSheetRow, now: number): { label: string; live: boolean } | null {
  if (!s.visitStartsAt) return null;
  const start = Date.parse(s.visitStartsAt);
  const end = s.visitEndsAt ? Date.parse(s.visitEndsAt) : start + 2 * 3_600_000;
  if (now >= end) return { label: 'Finished', live: false };
  if (now >= start) return { label: 'Happening now', live: true };
  const mins = Math.round((start - now) / 60_000);
  if (mins < 60) return { label: `Starts in ${mins} min`, live: false };
  if (mins < 24 * 60) return { label: `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m`, live: false };
  return null;
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        <span className="text-stone-400">{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Staff run sheets: whole venue day (desk modal + page), or one party when ?bookingId= is set (page). */
export default function PartyRunSheetsPrintPage() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  // In the desk modal the URL belongs to the page underneath — all view state is local.
  const inDesk = useInPartiesDesk();
  const { locationId, setLocationId, scopedLocationId } = useHqLocationFilter(inDesk ? '' : (sp?.get('locationId') ?? ''));
  const { venues } = useActiveVenues(scopedLocationId);
  const venueTz = venues.find((v) => v.id === locationId)?.timezone ?? null;
  const today = todayInZone(venueTz);
  const rawDate = inDesk ? '' : (sp?.get('date') ?? '');
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const date = pickedDate ?? (!rawDate || rawDate === 'today' ? today : rawDate);
  const [onlyBookingId, setOnlyBookingId] = useState(inDesk ? '' : (sp?.get('bookingId') ?? ''));
  const autoPrint = !inDesk && sp?.get('print') === '1';
  const [compact, setCompact] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const now = useNow(30_000);

  const q = usePartyRunSheetsQuery(date, locationId || undefined);
  const all = q.data ?? [];
  const sheets = useMemo(
    () =>
      all
        .filter((s) => !onlyBookingId || s.bookingId === onlyBookingId)
        .sort((a, b) => (a.visitStartsAt ?? '').localeCompare(b.visitStartsAt ?? '')),
    [all, onlyBookingId]
  );
  const firstLoad = !q.data && q.isPending;
  const switching = q.isFetching && q.isPlaceholderData;
  useEffect(() => {
    if (!switching) setPendingKey(null);
  }, [switching]);

  /* Print: the desk opens a clean print tab (?print=1) that prints itself once the sheets load. */
  const printedRef = useRef(false);
  useEffect(() => {
    if (!autoPrint || printedRef.current || firstLoad || switching || !sheets.length) return;
    printedRef.current = true;
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, [autoPrint, firstLoad, switching, sheets.length]);

  const go = (next: string, key: string) => {
    setPendingKey(key);
    setPickedDate(next === today && !rawDate ? null : next);
  };
  const warmDay = useCallback(
    (d: string) => {
      void qc
        .prefetchQuery({
          queryKey: adminPartyKeys.runSheets(d, locationId || undefined),
          queryFn: () => listAdminPartyRunSheets(d, locationId || undefined),
          staleTime: 30_000,
        })
        .catch(() => undefined);
    },
    [qc, locationId]
  );

  const printHref = (bookingId?: string) =>
    `/admin/parties/run-sheets?date=${date}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}${
      bookingId ? `&bookingId=${encodeURIComponent(bookingId)}` : ''
    }&print=1`;
  const print = (bookingId?: string) => {
    if (inDesk) window.open(printHref(bookingId), '_blank', 'noopener');
    else if (bookingId && bookingId !== onlyBookingId) window.open(printHref(bookingId), '_blank', 'noopener');
    else window.print();
  };

  const totals = useMemo(() => {
    const live = sheets.filter((s) => !['cancelled', 'expired', 'refunded'].includes(s.status));
    return {
      parties: live.length,
      guests: live.reduce((n, s) => n + (s.kidCount ?? 0) + (s.adultCount ?? 0), 0),
      rooms: new Set(live.map((s) => s.room?.id).filter(Boolean)).size,
      food: live.filter((s) => s.food?.length).length,
      dueCents: live.reduce((n, s) => n + (s.amountDueCents ?? 0), 0),
    };
  }, [sheets]);
  const isToday = date === today;
  const showVenue = !locationId && venues.length > 1;
  const venueName = venues.find((v) => v.id === locationId)?.name;

  return (
    <div className="party-print mx-auto max-w-5xl space-y-5">
      <style>{`@media print {
        aside, header, nav, .no-print { display: none !important; }
        .party-print { max-width: none; }
        .party-sheet { break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; border-color: #d6d3d1 !important; }
        body { background: #fff !important; }
      }`}</style>

      {/* Title + live */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="no-print flex h-11 w-11 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#8a6d12]">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              Run sheets <span className="font-normal text-stone-500">· {dayLabel(date)}</span>
            </h1>
            <div className="no-print text-sm">
              <PartiesLiveStatus fetching={q.isFetching} updatedAt={q.dataUpdatedAt} failed={Boolean(q.error)} onRefresh={() => void q.refetch()} />
            </div>
            {venueName ? <p className="hidden text-sm text-stone-600 print:block">{venueName}</p> : null}
          </div>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {!inDesk ? (
            <AdminPendingLink href="/admin/parties" className={toolbarBtn}>
              <ChevronLeft className="h-4 w-4" />
              Parties
            </AdminPendingLink>
          ) : null}
          <button type="button" className={primaryBtn} onClick={() => print()} disabled={!sheets.length}>
            <Printer className="h-4 w-4" />
            {onlyBookingId ? 'Print this party' : 'Print day'}
          </button>
        </div>
      </div>

      {/* Day navigator */}
      <section className="no-print flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={toolbarBtn}
            onMouseEnter={() => warmDay(shiftYmd(date, -1))}
            onClick={() => go(shiftYmd(date, -1), 'prev')}
            aria-label="Previous day"
          >
            {pendingKey === 'prev' && switching ? <Spin /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5">
            {[
              { key: 'yesterday', label: 'Yesterday', value: shiftYmd(today, -1) },
              { key: 'today', label: 'Today', value: today },
              { key: 'tomorrow', label: 'Tomorrow', value: shiftYmd(today, 1) },
            ].map((d) => (
              <button
                key={d.key}
                type="button"
                onMouseEnter={() => warmDay(d.value)}
                onClick={() => go(d.value, d.key)}
                aria-pressed={date === d.value}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  date === d.value ? 'bg-white text-stone-900 shadow-sm ring-1 ring-[#D4AF37]/50' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {pendingKey === d.key && switching ? <Spin className="h-3 w-3 text-[#D4AF37]" /> : null}
                {d.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={toolbarBtn}
            onMouseEnter={() => warmDay(shiftYmd(date, 1))}
            onClick={() => go(shiftYmd(date, 1), 'next')}
            aria-label="Next day"
          >
            {pendingKey === 'next' && switching ? <Spin /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <label className="relative">
            <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && go(e.target.value, 'date')}
              className="h-9 rounded-lg border border-stone-200 bg-white pl-8 pr-2 text-sm shadow-sm focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
              aria-label="Run sheet date"
            />
          </label>
          {pendingKey === 'date' && switching ? <Spin className="h-4 w-4 text-[#D4AF37]" /> : null}
          <span className="text-xs text-stone-500">{relDay(date, today)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!scopedLocationId && venues.length > 1 ? (
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="h-9 rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-800 shadow-sm focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
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
          <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-sm" role="group" aria-label="Layout">
            {[
              { v: false, label: 'Detailed' },
              { v: true, label: 'Compact' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setCompact(o.v)}
                aria-pressed={compact === o.v}
                className={`rounded-md px-3 py-1 font-medium transition ${compact === o.v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {onlyBookingId ? (
        <div className="no-print flex items-center justify-between rounded-lg bg-[#D4AF37]/10 px-3 py-2 text-sm text-stone-700">
          <span>Showing one party.</span>
          <button type="button" className="font-semibold text-[#8a6d12] hover:underline" onClick={() => setOnlyBookingId('')}>
            Show the whole day
          </button>
        </div>
      ) : null}

      {/* Day at a glance */}
      {!firstLoad && sheets.length ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { icon: <PartyPopper className="h-4 w-4" />, label: 'Parties', value: totals.parties },
            { icon: <Users className="h-4 w-4" />, label: 'Guests', value: totals.guests },
            { icon: <DoorOpen className="h-4 w-4" />, label: 'Rooms in use', value: totals.rooms },
            { icon: <UtensilsCrossed className="h-4 w-4" />, label: 'With food', value: totals.food },
            { icon: <Wallet className="h-4 w-4" />, label: 'Still due', value: centsLabel(totals.dueCents) },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-sm">
              <span className="text-[#8a6d12]">{s.icon}</span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{s.label}</p>
                <p className="truncate text-lg font-semibold tabular-nums text-stone-900">{s.value}</p>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <PartiesErrorBanner error={q.error} />

      {firstLoad ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex animate-pulse gap-4 rounded-2xl border border-stone-200 bg-white p-4">
              <div className="w-20 space-y-2">
                <div className="h-5 w-14 rounded bg-stone-200" />
                <div className="h-3 w-10 rounded bg-stone-100" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="h-5 w-56 rounded bg-stone-200" />
                <div className="h-3 w-72 rounded bg-stone-100" />
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="h-16 rounded-lg bg-stone-100" />
                  <div className="h-16 rounded-lg bg-stone-100" />
                  <div className="h-16 rounded-lg bg-stone-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : sheets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a6d12]">
            <ClipboardList className="h-7 w-7" />
          </span>
          <p className="text-base font-semibold text-stone-900">No parties on {dayLabel(date)}</p>
          <p className="max-w-sm text-sm text-stone-500">Run sheets appear here automatically as parties are booked for this day.</p>
          <button
            type="button"
            className={`${toolbarBtn} no-print`}
            onMouseEnter={() => warmDay(shiftYmd(date, 1))}
            onClick={() => go(shiftYmd(date, 1), 'empty-next')}
          >
            {pendingKey === 'empty-next' && switching ? <Spin /> : null}
            Check the next day
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${switching ? 'opacity-50' : ''}`}>
          {sheets.map((s) => {
            const t = isToday ? partyTiming(s, now) : null;
            const items = [...s.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            const currentIdx = isToday
              ? items.reduce((idx, it, i) => (it.startsAt && Date.parse(it.startsAt) <= now ? i : idx), -1)
              : -1;
            const closed = ['cancelled', 'expired', 'refunded'].includes(s.status);
            return (
              <article
                key={s.bookingId}
                className={`party-sheet flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row ${
                  t?.live ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-stone-200'
                } ${closed ? 'opacity-60' : ''}`}
              >
                {/* Time rail */}
                <div className="flex shrink-0 items-baseline gap-2 sm:w-24 sm:flex-col sm:gap-0.5 sm:border-r sm:border-stone-100 sm:pr-4">
                  <p className="text-xl font-semibold tabular-nums text-stone-900">{timeInZone(s.visitStartsAt, s.timezone)}</p>
                  {s.visitEndsAt ? <p className="text-xs text-stone-500">to {timeInZone(s.visitEndsAt, s.timezone)}</p> : null}
                  {t ? (
                    <p className={`no-print flex items-center gap-1 text-xs font-medium ${t.live ? 'text-emerald-700' : 'text-stone-500'}`}>
                      {t.live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> : null}
                      {t.label}
                    </p>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-stone-900">
                        {s.partyName ?? s.publicId}
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OPS_TONE[s.opsStatus ?? ''] ?? 'bg-stone-100 text-stone-700'}`}>
                          {OPS_STATUS_LABELS[s.opsStatus ?? ''] ?? s.status.replace(/_/g, ' ')}
                        </span>
                        {s.amountDueCents ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">{centsLabel(s.amountDueCents)} due</span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">Paid</span>
                        )}
                      </h2>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-stone-600">
                        {s.honoreeName ? <span>🎂 {s.honoreeName}</span> : null}
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-stone-400" />
                          {s.kidCount ?? 0} kids · {s.adultCount ?? 0} adults
                        </span>
                        <span className={`inline-flex items-center gap-1 ${s.room?.name ? '' : 'font-medium text-amber-700'}`}>
                          <DoorOpen className="h-3.5 w-3.5 text-stone-400" />
                          {s.room?.name ?? 'No room'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3.5 w-3.5 text-stone-400" />
                          {s.hostName ?? 'No host'}
                        </span>
                        {showVenue && s.location ? <span className="text-stone-500">{s.location.name}</span> : null}
                        <span className="text-stone-400">{s.publicId}</span>
                      </p>
                    </div>
                    <div className="no-print flex items-center gap-1.5">
                      <button type="button" className={toolbarBtn} onClick={() => print(s.bookingId)} title="Print this party">
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      <AdminPendingLink href={`/admin/parties/${s.bookingId}?tab=Run%20sheet`} className={toolbarBtn}>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        Open
                      </AdminPendingLink>
                    </div>
                  </div>

                  {!compact ? (
                    <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
                      <Section icon={<ListChecks className="h-3.5 w-3.5" />} title="Timeline">
                        {items.length ? (
                          <ol className="relative space-y-2 border-l-2 border-stone-100 pl-4">
                            {items.map((it, i) => {
                              const done = currentIdx > i;
                              const current = currentIdx === i;
                              return (
                                <li key={it.id} className="relative">
                                  <span
                                    className={`absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                      current ? 'bg-emerald-500' : done ? 'bg-stone-300' : 'bg-[#D4AF37]'
                                    }`}
                                  />
                                  <p className={`text-sm ${done ? 'text-stone-400' : 'text-stone-800'}`}>
                                    {it.startsAt ? (
                                      <span className="mr-2 font-semibold tabular-nums">
                                        {formatInZone(it.startsAt, s.timezone, { hour: 'numeric', minute: '2-digit' })}
                                      </span>
                                    ) : null}
                                    <span className={current ? 'font-semibold' : ''}>{it.title || 'Untitled'}</span>
                                    {current ? <span className="ml-2 text-xs font-medium text-emerald-700">now</span> : null}
                                  </p>
                                  {it.notes ? <p className="text-xs text-stone-500">{it.notes}</p> : null}
                                </li>
                              );
                            })}
                          </ol>
                        ) : (
                          <p className="text-sm text-stone-400">No timeline yet — add steps from the party&apos;s Run sheet tab.</p>
                        )}
                      </Section>
                      <div className="space-y-4">
                        <Section icon={<UtensilsCrossed className="h-3.5 w-3.5" />} title="Food">
                          {s.food?.length ? (
                            <ul className="space-y-0.5 text-sm text-stone-800">
                              {s.food.map((f, i) => (
                                <li key={i}>
                                  <span className="font-semibold tabular-nums">{f.qty}×</span> {f.nameSnapshot}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-stone-400">None</p>
                          )}
                          {s.foodNotes ? <p className="rounded-md bg-orange-50 px-2 py-1 text-xs text-orange-900">Kitchen: {s.foodNotes}</p> : null}
                        </Section>
                        <Section icon={<Sparkles className="h-3.5 w-3.5" />} title="Add-ons">
                          {s.addOns?.length ? (
                            <ul className="space-y-0.5 text-sm text-stone-800">
                              {s.addOns.map((a, i) => (
                                <li key={i}>
                                  <span className="font-semibold tabular-nums">{a.qty}×</span> {a.name}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-stone-400">None</p>
                          )}
                        </Section>
                        {s.hostNotes || s.notes ? (
                          <Section icon={<NotebookPen className="h-3.5 w-3.5" />} title="Staff notes">
                            {s.hostNotes ? <p className="rounded-md bg-[#D4AF37]/10 px-2 py-1 text-sm text-stone-800">Host: {s.hostNotes}</p> : null}
                            {s.notes ? <p className="text-sm text-stone-600">{s.notes}</p> : null}
                          </Section>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
