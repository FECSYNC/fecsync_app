'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  CreditCard,
  Link2,
  Mail,
  PartyPopper,
  Phone,
  Search,
  ShieldAlert,
  Wallet,
  X,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { invalidatePartyQueries, usePartyBalancesQuery } from '@/hooks/useParties';
import { createAdminBookingPaymentLink } from '@/services/adminBookings';
import { adminPartyKeys, getAdminParty } from '@/services/adminParties';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import TakePaymentModal from '../bookings/TakePaymentModal';
import { PartiesErrorBanner, PartiesPageHeader, PartyScopeBanner, useActiveVenues } from './partiesUi';
import PartiesLiveStatus, { useNow } from './PartiesLiveStatus';
import { centsLabel, formatInZone, partyErrorMessage, zonedLocalToIso } from './partyFormat';

type BalanceRow = {
  bookingId: string;
  publicId: string;
  status: string;
  partyName: string;
  location: { id: string; name: string };
  timezone: string | null;
  visitStartsAt: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  depositDueAt: string | null;
  balanceDueAt: string | null;
};

type Segment = 'all' | 'overdue' | 'week' | 'deposit';
type SortKey = 'due' | 'amount' | 'visit';

/** All outstanding balances in one request — venue / segment / search / date filter in the browser, instantly. */
const ALL_BALANCES = { take: 500 } as const;
const DAY = 86_400_000;

const smallBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50';
const payBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

const depositOwed = (r: BalanceRow) => Math.max(0, r.depositRequiredCents - r.depositPaidCents);

/** Effective due moment: an unpaid deposit's date wins when it is earlier. */
function dueAt(r: BalanceRow): number | null {
  const bal = r.balanceDueAt ? Date.parse(r.balanceDueAt) : null;
  const dep = depositOwed(r) > 0 && r.depositDueAt ? Date.parse(r.depositDueAt) : null;
  if (bal == null) return dep;
  if (dep == null) return bal;
  return Math.min(bal, dep);
}

function urgency(r: BalanceRow, now: number): { tone: 'overdue' | 'soon' | 'later' | 'none'; label: string } {
  const at = dueAt(r);
  if (at == null) return { tone: 'none', label: 'No due date' };
  const days = Math.round((at - now) / DAY);
  if (at < now) return { tone: 'overdue', label: days === 0 ? 'Overdue today' : `Overdue by ${-days} day${days === -1 ? '' : 's'}` };
  if (days <= 0) return { tone: 'soon', label: 'Due today' };
  if (days === 1) return { tone: 'soon', label: 'Due tomorrow' };
  if (days <= 7) return { tone: 'soon', label: `Due in ${days} days` };
  return { tone: 'later', label: `Due in ${days} days` };
}

const URGENCY_STYLE = {
  overdue: { bar: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  soon: { bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  later: { bar: 'bg-stone-300', chip: 'bg-stone-100 text-stone-600 ring-stone-200' },
  none: { bar: 'bg-stone-200', chip: 'bg-stone-100 text-stone-500 ring-stone-200' },
} as const;

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
  active,
  onClick,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint: string;
  tone: string;
  active?: boolean;
  onClick?: () => void;
  loading?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': active } : {})}
      className={`flex items-center gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition ${
        active ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/30' : 'border-stone-200'
      } ${onClick ? 'hover:border-[#D4AF37]/60 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/40' : ''}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
        {loading ? (
          <span className="mt-1.5 block h-6 w-20 animate-pulse rounded bg-stone-200" />
        ) : (
          <span className="mt-0.5 block truncate text-2xl font-semibold tabular-nums text-stone-900">{value}</span>
        )}
        <span className="block truncate text-xs text-stone-500">{hint}</span>
      </span>
    </Tag>
  );
}

export default function PartyBalancesPage() {
  const can = useAuthStore((s) => s.can);
  const canPay = can(P.BookingsPaymentsTake);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const { locationId, setLocationId, scopedLocationId, scopedLocationName, locationScoped } = useHqLocationFilter();
  const { venues } = useActiveVenues(scopedLocationId);
  const now = useNow(60_000);

  const [segment, setSegment] = useState<Segment>('all');
  const [sort, setSort] = useState<SortKey>('due');
  const [search, setSearch] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [paying, setPaying] = useState<BalanceRow | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkDone, setLinkDone] = useState<string | null>(null);

  const query = usePartyBalancesQuery(ALL_BALANCES);
  const all = (query.data?.balances ?? []) as unknown as BalanceRow[];
  const firstLoad = !query.data && query.isPending;
  const truncated = (query.data?.total ?? 0) > all.length;

  const inVenue = useMemo(() => all.filter((r) => !locationId || r.location.id === locationId), [all, locationId]);
  const dueBeforeMs = useMemo(() => {
    if (!dueBefore) return null;
    const iso = zonedLocalToIso(`${dueBefore}T23:59`, venues.find((v) => v.id === locationId)?.timezone ?? null);
    return iso ? Date.parse(iso) : null;
  }, [dueBefore, venues, locationId]);

  const segOf = useCallback(
    (r: BalanceRow, s: Segment) => {
      if (s === 'all') return true;
      if (s === 'deposit') return depositOwed(r) > 0;
      const at = dueAt(r);
      if (at == null) return false;
      if (s === 'overdue') return at < now;
      return at >= now && at < now + 7 * DAY;
    },
    [now]
  );

  const stats = useMemo(() => {
    const sum = (rows: BalanceRow[], f: (r: BalanceRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const overdue = inVenue.filter((r) => segOf(r, 'overdue'));
    const week = inVenue.filter((r) => segOf(r, 'week'));
    const deposit = inVenue.filter((r) => segOf(r, 'deposit'));
    return {
      total: { n: inVenue.length, cents: sum(inVenue, (r) => r.amountDueCents) },
      overdue: { n: overdue.length, cents: sum(overdue, (r) => r.amountDueCents) },
      week: { n: week.length, cents: sum(week, (r) => r.amountDueCents) },
      deposit: { n: deposit.length, cents: sum(deposit, depositOwed) },
    };
  }, [inVenue, segOf]);

  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = inVenue
      .filter((r) => segOf(r, segment))
      .filter((r) => {
        if (dueBeforeMs == null) return true;
        const at = r.balanceDueAt ? Date.parse(r.balanceDueAt) : null;
        return at != null && at < dueBeforeMs;
      })
      .filter(
        (r) =>
          !term ||
          r.partyName.toLowerCase().includes(term) ||
          r.publicId.toLowerCase().includes(term) ||
          (r.contactName ?? '').toLowerCase().includes(term) ||
          (r.contactEmail ?? '').toLowerCase().includes(term) ||
          (r.contactPhone ?? '').includes(term)
      );
    const big = Number.MAX_SAFE_INTEGER;
    return list.sort((a, b) =>
      sort === 'amount'
        ? b.amountDueCents - a.amountDueCents
        : sort === 'visit'
          ? (a.visitStartsAt ? Date.parse(a.visitStartsAt) : big) - (b.visitStartsAt ? Date.parse(b.visitStartsAt) : big)
          : (dueAt(a) ?? big) - (dueAt(b) ?? big)
    );
  }, [inVenue, segOf, segment, dueBeforeMs, term, sort]);
  const shownCents = rows.reduce((s, r) => s + r.amountDueCents, 0);
  const showVenue = !locationId && venues.length > 1;
  const filtersActive = segment !== 'all' || Boolean(term) || Boolean(dueBefore);

  /* Hover → warm the party detail so "Open" paints instantly. */
  const hoverTimer = useRef<number | null>(null);
  const warmParty = useCallback(
    (bookingId: string) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        void qc.prefetchQuery({ queryKey: adminPartyKeys.detail(bookingId), queryFn: () => getAdminParty(bookingId), staleTime: 15_000 });
      }, 150);
    },
    [qc]
  );

  async function sendLink(r: BalanceRow) {
    setLinkBusy(r.bookingId);
    try {
      const link = await createAdminBookingPaymentLink(r.bookingId, {
        amount: r.amountDueCents / 100,
        to: r.contactEmail ?? undefined,
        sendVia: ['email'],
      });
      invalidatePartyQueries(qc, r.bookingId);
      const url = link.payUrl || `${window.location.origin}/booking/pay/${link.token}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      addToast(r.contactEmail ? `Payment link emailed to ${r.contactEmail} and copied` : 'Payment link copied', 'success');
      setLinkDone(r.bookingId);
      window.setTimeout(() => setLinkDone((v) => (v === r.bookingId ? null : v)), 2500);
    } catch (err) {
      addToast(partyErrorMessage(err, 'Could not create the payment link'), 'error');
    } finally {
      setLinkBusy(null);
    }
  }

  const clearFilters = () => {
    setSegment('all');
    setSearch('');
    setDueBefore('');
  };

  return (
    <div className="space-y-5">
      <PartiesPageHeader
        title="Outstanding party balances"
        description={
          <div className="space-y-1">
            <p>Parties that still owe money, soonest due first. Payments taken here update the party, bookings and run sheets.</p>
            <PartiesLiveStatus
              fetching={query.isFetching}
              updatedAt={query.dataUpdatedAt}
              failed={Boolean(query.error)}
              onRefresh={() => void query.refetch()}
            />
          </div>
        }
      />
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <PartiesErrorBanner error={query.error} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          tone="bg-[#D4AF37]/15 text-[#8a6d12]"
          label="Outstanding"
          loading={firstLoad}
          value={centsLabel(stats.total.cents)}
          hint={`${stats.total.n} part${stats.total.n === 1 ? 'y' : 'ies'} owe money`}
          active={segment === 'all'}
          onClick={() => setSegment('all')}
        />
        <StatCard
          icon={<AlarmClock className="h-5 w-5" />}
          tone="bg-red-100 text-red-700"
          label="Overdue"
          loading={firstLoad}
          value={centsLabel(stats.overdue.cents)}
          hint={stats.overdue.n ? `${stats.overdue.n} past their due date` : 'nothing overdue'}
          active={segment === 'overdue'}
          onClick={() => setSegment(segment === 'overdue' ? 'all' : 'overdue')}
        />
        <StatCard
          icon={<CircleDollarSign className="h-5 w-5" />}
          tone="bg-amber-100 text-amber-800"
          label="Due in 7 days"
          loading={firstLoad}
          value={centsLabel(stats.week.cents)}
          hint={`${stats.week.n} part${stats.week.n === 1 ? 'y' : 'ies'} coming due`}
          active={segment === 'week'}
          onClick={() => setSegment(segment === 'week' ? 'all' : 'week')}
        />
        <StatCard
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="bg-sky-100 text-sky-800"
          label="Deposits unpaid"
          loading={firstLoad}
          value={centsLabel(stats.deposit.cents)}
          hint={`${stats.deposit.n} deposit${stats.deposit.n === 1 ? '' : 's'} still owed`}
          active={segment === 'deposit'}
          onClick={() => setSegment(segment === 'deposit' ? 'all' : 'deposit')}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Party, contact, email, phone, ID"
              className="h-9 w-64 rounded-lg border border-stone-200 bg-white pl-9 pr-8 text-sm shadow-sm placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
              aria-label="Search balances"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-stone-600">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Balance due by</span>
            <input
              type="date"
              value={dueBefore}
              onChange={(e) => setDueBefore(e.target.value)}
              className="h-9 rounded-lg border border-stone-200 bg-white px-2 text-sm shadow-sm focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
            />
          </label>
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
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-9 rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-800 shadow-sm focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
            aria-label="Sort"
          >
            <option value="due">Soonest due</option>
            <option value="amount">Largest balance</option>
            <option value="visit">Party date</option>
          </select>
          {filtersActive ? (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900">
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          ) : null}
        </div>
      </section>

      {truncated ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Showing the {all.length} soonest-due balances of {query.data?.total}. Pick a venue to narrow the list.
        </p>
      ) : null}

      <section className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity ${query.isFetching && !firstLoad ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-full w-1/3 animate-[balbar_1.1s_ease-in-out_infinite] rounded-full bg-[#D4AF37]" />
        </div>
        <style>{`@keyframes balbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

        {firstLoad ? (
          <div className="divide-y divide-stone-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
                <div className="h-12 w-1 rounded-full bg-stone-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-48 rounded bg-stone-200" />
                  <div className="h-2.5 w-32 rounded bg-stone-100" />
                </div>
                <div className="hidden h-2 w-40 rounded-full bg-stone-100 md:block" />
                <div className="h-5 w-20 rounded bg-stone-200" />
                <div className="h-8 w-28 rounded-lg bg-stone-100" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              {all.length === 0 ? <PartyPopper className="h-7 w-7" /> : <Search className="h-7 w-7" />}
            </span>
            <p className="text-base font-semibold text-stone-900">
              {all.length === 0 ? 'All parties are paid up' : 'No balances match these filters'}
            </p>
            <p className="max-w-sm text-sm text-stone-500">
              {all.length === 0
                ? 'New balances appear here automatically when a party is booked or changed.'
                : 'Try another segment, date or search.'}
            </p>
            {all.length > 0 && filtersActive ? (
              <button type="button" className={smallBtn} onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-stone-100">
              {rows.map((r) => {
                const u = urgency(r, now);
                const style = URGENCY_STYLE[u.tone];
                const paidPct = r.totalCents > 0 ? Math.min(100, Math.round((r.amountPaidCents / r.totalCents) * 100)) : 0;
                const depOwed = depositOwed(r);
                return (
                  <li
                    key={r.bookingId}
                    onMouseEnter={() => warmParty(r.bookingId)}
                    className="grid gap-3 px-4 py-4 transition hover:bg-stone-50/70 md:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1.2fr)_auto_auto] md:items-center"
                  >
                    <span className={`hidden h-12 w-1 rounded-full md:block ${style.bar}`} aria-hidden />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-stone-900">{r.partyName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style.chip}`}>{u.label}</span>
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {formatInZone(r.visitStartsAt, r.timezone)} · {r.publicId}
                        {showVenue ? ` · ${r.location.name}` : ''}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-600">
                        <span className="font-medium text-stone-700">{r.contactName ?? 'No contact'}</span>
                        {r.contactEmail ? (
                          <a href={`mailto:${r.contactEmail}`} className="inline-flex items-center gap-1 hover:text-[#8a6d12]">
                            <Mail className="h-3 w-3" />
                            {r.contactEmail}
                          </a>
                        ) : null}
                        {r.contactPhone ? (
                          <a href={`tel:${r.contactPhone}`} className="inline-flex items-center gap-1 hover:text-[#8a6d12]">
                            <Phone className="h-3 w-3" />
                            {r.contactPhone}
                          </a>
                        ) : null}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex justify-between text-xs text-stone-500">
                        <span>
                          Paid {centsLabel(r.amountPaidCents)} of {centsLabel(r.totalCents)}
                        </span>
                        <span className="tabular-nums">{paidPct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${paidPct}%` }} />
                      </div>
                      {r.depositRequiredCents > 0 ? (
                        depOwed > 0 ? (
                          <p className="text-xs text-sky-800">
                            Deposit {centsLabel(depOwed)} owed
                            {r.depositDueAt ? ` · by ${formatInZone(r.depositDueAt, r.timezone, { dateStyle: 'medium' })}` : ''}
                          </p>
                        ) : (
                          <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <Check className="h-3 w-3" />
                            Deposit paid
                          </p>
                        )
                      ) : null}
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-xl font-semibold tabular-nums text-stone-900">{centsLabel(r.amountDueCents)}</p>
                      <p className="text-xs text-stone-500">
                        {r.balanceDueAt ? `due ${formatInZone(r.balanceDueAt, r.timezone, { dateStyle: 'medium' })}` : 'balance due'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                      {canPay ? (
                        <>
                          <button type="button" className={payBtn} onClick={() => setPaying(r)}>
                            <CreditCard className="h-3.5 w-3.5" />
                            Take payment
                          </button>
                          <button
                            type="button"
                            className={smallBtn}
                            disabled={linkBusy === r.bookingId}
                            onClick={() => void sendLink(r)}
                            title={r.contactEmail ? `Email a payment link to ${r.contactEmail} and copy it` : 'Create a payment link and copy it'}
                          >
                            {linkBusy === r.bookingId ? (
                              <Spin />
                            ) : linkDone === r.bookingId ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Link2 className="h-3.5 w-3.5" />
                            )}
                            {linkBusy === r.bookingId ? 'Sending…' : linkDone === r.bookingId ? 'Sent' : 'Pay link'}
                          </button>
                        </>
                      ) : null}
                      <AdminPendingLink href={`/admin/parties/${r.bookingId}`} className={smallBtn}>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        Open
                      </AdminPendingLink>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3 text-sm">
              <span className="text-stone-600">
                {rows.length} part{rows.length === 1 ? 'y' : 'ies'}
                {rows.length !== inVenue.length ? ` of ${inVenue.length}` : ''}
              </span>
              <span className="font-semibold text-stone-900">
                Total due <span className="tabular-nums">{centsLabel(shownCents)}</span>
              </span>
            </div>
          </>
        )}
      </section>

      {paying ? (
        <TakePaymentModal
          booking={{
            id: paying.bookingId,
            publicId: paying.publicId,
            amountDue: paying.amountDueCents / 100,
            primaryContactEmail: paying.contactEmail,
          }}
          showRefund={false}
          onClose={() => setPaying(null)}
        />
      ) : null}
    </div>
  );
}
