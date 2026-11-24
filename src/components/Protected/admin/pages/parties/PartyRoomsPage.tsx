'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Check,
  DoorOpen,
  Minus,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  useCreatePartyRoomMutation,
  usePartiesQuery,
  usePartyRoomsQuery,
  usePatchPartyRoomMutation,
} from '@/hooks/useParties';
import { adminPartyKeys, type PartyListRow, type PartyRoomDto } from '@/services/adminParties';
import {
  PartiesErrorBanner,
  PartiesPageHeader,
  PartyScopeBanner,
  useActiveVenues,
  usePartyCatalogPermissions,
} from './partiesUi';
import PartiesLiveStatus, { useNow } from './PartiesLiveStatus';
import { partyErrorMessage, timeInZone } from './partyFormat';

type StatusKey = 'active' | 'archived' | 'all';

/** Every room (archived included) in one fetch — status / venue / search filter in the browser, instantly. */
const ALL_ROOMS = { includeArchived: true } as const;
/** Same key the Parties list uses for today → shared cache, no extra request. */
const TODAY_PARTIES = { date: 'today', take: 25, skip: 0 } as const;

const fieldBase =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 shadow-sm transition placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30 disabled:opacity-60';
const smallBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:cursor-not-allowed disabled:opacity-60';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

function Stepper({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const n = Number(value) || 0;
  return (
    <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/30">
      <button
        type="button"
        disabled={disabled || n <= 1}
        onClick={() => onChange(String(Math.max(1, n - 1)))}
        className="px-2.5 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 disabled:opacity-40"
        aria-label={`Decrease ${label}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        className="w-16 border-x border-stone-200 text-center text-sm font-semibold tabular-nums text-stone-900 focus:outline-none"
        aria-label={label}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(String(n + 1))}
        className="px-2.5 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 disabled:opacity-40"
        aria-label={`Increase ${label}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function StatCard({ label, value, hint, loading, tone = 'gold' }: { label: string; value: React.ReactNode; hint: string; loading?: boolean; tone?: 'gold' | 'green' | 'stone' | 'violet' }) {
  const bar = { gold: 'bg-[#D4AF37]', green: 'bg-emerald-500', stone: 'bg-stone-400', violet: 'bg-violet-500' }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
      <span className="block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {loading ? (
        <span className="mt-1.5 block h-7 w-14 animate-pulse rounded bg-stone-200" />
      ) : (
        <span className="mt-0.5 block text-2xl font-semibold tabular-nums text-stone-900">{value}</span>
      )}
      <span className="block truncate text-xs text-stone-500">{hint}</span>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-xl bg-[#D4AF37]/20" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-1/2 animate-pulse rounded bg-stone-200" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-stone-100" />
        </div>
      </div>
      <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
      <div className="flex gap-2">
        <div className="h-8 w-16 animate-pulse rounded-lg bg-stone-100" />
        <div className="h-8 w-20 animate-pulse rounded-lg bg-stone-100" />
      </div>
    </div>
  );
}

type RoomUse = { today: number; current: PartyListRow | null; next: PartyListRow | null };

/* ───────────────────────────── page ───────────────────────────── */

export default function PartyRoomsPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { canRooms } = usePartyCatalogPermissions();
  const { locationId, setLocationId, scopedLocationId, scopedLocationName, locationScoped } = useHqLocationFilter();
  const { venues } = useActiveVenues(scopedLocationId);

  const roomsQuery = usePartyRoomsQuery(ALL_ROOMS);
  const todayQuery = usePartiesQuery(TODAY_PARTIES);
  const createMutation = useCreatePartyRoomMutation();
  const patchMutation = usePatchPartyRoomMutation();
  const now = useNow(30_000);

  const [status, setStatus] = useState<StatusKey>('active');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<{ id: string; action: 'save' | 'archive' | 'restore' } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; capacity: string } | null>(null);

  // Add-room form: venue defaults to the filter / the only venue.
  const defaultVenue = scopedLocationId || locationId || (venues.length === 1 ? venues[0]!.id : '');
  const [newVenue, setNewVenue] = useState('');
  const [newName, setNewName] = useState('');
  const [newCapacity, setNewCapacity] = useState('20');
  useEffect(() => {
    if (defaultVenue) setNewVenue(defaultVenue);
  }, [defaultVenue]);

  const all = roomsQuery.data ?? [];
  const firstLoad = !roomsQuery.data && roomsQuery.isPending;
  const inVenue = useMemo(() => all.filter((r) => !locationId || r.locationId === locationId), [all, locationId]);
  const counts = useMemo(
    () => ({
      active: inVenue.filter((r) => !r.archivedAt).length,
      archived: inVenue.filter((r) => r.archivedAt).length,
      all: inVenue.length,
    }),
    [inVenue]
  );
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      inVenue
        .filter((r) => (status === 'all' ? true : status === 'active' ? !r.archivedAt : Boolean(r.archivedAt)))
        .filter((r) => !term || r.name.toLowerCase().includes(term) || (r.location?.name ?? '').toLowerCase().includes(term))
        .sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.name.localeCompare(b.name)),
    [inVenue, status, term]
  );

  /* Today's parties per room (live parties only). */
  const usage = useMemo(() => {
    const map = new Map<string, RoomUse>();
    for (const p of todayQuery.data?.parties ?? []) {
      if (!p.room?.id || ['cancelled', 'expired', 'refunded'].includes(p.status)) continue;
      const u = map.get(p.room.id) ?? { today: 0, current: null, next: null };
      u.today += 1;
      const start = p.visitStartsAt ? Date.parse(p.visitStartsAt) : NaN;
      const end = p.visitEndsAt ? Date.parse(p.visitEndsAt) : start + 2 * 3_600_000;
      if (start <= now && now < end) u.current = p;
      else if (start > now && (!u.next || start < Date.parse(u.next.visitStartsAt!))) u.next = p;
      map.set(p.room.id, u);
    }
    return map;
  }, [todayQuery.data, now]);
  const activeRooms = inVenue.filter((r) => !r.archivedAt);
  const totalCapacity = activeRooms.reduce((s, r) => s + r.defaultCapacity, 0);
  const inUseNow = activeRooms.filter((r) => usage.get(r.id)?.current).length;
  const bookedToday = activeRooms.filter((r) => (usage.get(r.id)?.today ?? 0) > 0).length;
  const showVenue = !locationId && venues.length > 1;

  /* Optimistic cache edits — cards update instantly, the catalog refetch confirms. */
  const listKey = adminPartyKeys.rooms(ALL_ROOMS);
  const patchCache = useCallback(
    (fn: (rows: PartyRoomDto[]) => PartyRoomDto[]) => {
      const prev = qc.getQueryData<PartyRoomDto[]>(listKey);
      if (prev) qc.setQueryData<PartyRoomDto[]>(listKey, fn(prev));
      return () => {
        if (prev) qc.setQueryData(listKey, prev);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc]
  );

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const cap = Number(newCapacity);
    if (!newVenue) return addToast('Choose the venue for this room', 'error');
    if (newName.trim().length < 2) return addToast('Give the room a name (2+ characters)', 'error');
    if (!Number.isInteger(cap) || cap < 1) return addToast('Capacity must be at least 1 guest', 'error');
    try {
      const room = await createMutation.mutateAsync({ locationId: newVenue, name: newName.trim(), defaultCapacity: cap });
      patchCache((rows) => (rows.some((r) => r.id === room.id) ? rows : [...rows, room]));
      addToast(`“${room.name}” added`, 'success');
      setNewName('');
      if (status === 'archived') setStatus('active');
    } catch (err) {
      addToast(partyErrorMessage(err, 'Could not create the room'), 'error');
    }
  };

  const saveEdit = () => {
    if (!editing) return;
    const cap = Number(editing.capacity);
    if (editing.name.trim().length < 2) return addToast('Room name needs 2+ characters', 'error');
    if (!Number.isInteger(cap) || cap < 1) return addToast('Capacity must be at least 1 guest', 'error');
    const { id } = editing;
    setBusy({ id, action: 'save' });
    const rollback = patchCache((rows) => rows.map((r) => (r.id === id ? { ...r, name: editing.name.trim(), defaultCapacity: cap } : r)));
    patchMutation.mutate(
      { id, payload: { name: editing.name.trim(), defaultCapacity: cap } },
      {
        onSuccess: () => {
          addToast('Room updated', 'success');
          setEditing(null);
        },
        onError: (err) => {
          rollback();
          addToast(partyErrorMessage(err, 'Could not update the room'), 'error');
        },
        onSettled: () => setBusy(null),
      }
    );
  };

  const archive = (r: PartyRoomDto) => {
    const upcoming = usage.get(r.id)?.today ?? 0;
    const extra = upcoming ? ` It has ${upcoming} part${upcoming === 1 ? 'y' : 'ies'} today — those keep the room.` : '';
    if (!window.confirm(`Archive “${r.name}”? New parties can no longer pick it.${extra}`)) return;
    setBusy({ id: r.id, action: 'archive' });
    const rollback = patchCache((rows) => rows.map((x) => (x.id === r.id ? { ...x, archivedAt: new Date().toISOString() } : x)));
    patchMutation.mutate(
      { id: r.id, payload: { archive: true } },
      {
        onSuccess: () => addToast(`“${r.name}” archived`, 'success'),
        onError: (err) => {
          rollback();
          addToast(partyErrorMessage(err, 'Archive failed'), 'error');
        },
        onSettled: () => setBusy(null),
      }
    );
  };

  const restore = (r: PartyRoomDto) => {
    setBusy({ id: r.id, action: 'restore' });
    const rollback = patchCache((rows) => rows.map((x) => (x.id === r.id ? { ...x, archivedAt: null } : x)));
    patchMutation.mutate(
      { id: r.id, payload: { unarchive: true } },
      {
        onSuccess: () => addToast(`“${r.name}” restored`, 'success'),
        onError: (err) => {
          rollback();
          addToast(partyErrorMessage(err, 'Restore failed'), 'error');
        },
        onSettled: () => setBusy(null),
      }
    );
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setEditing(null);
    }
  };

  return (
    <div className="space-y-5">
      <PartiesPageHeader
        title="Party rooms"
        description={
          <div className="space-y-1">
            <p>Rooms a party can occupy. A room holds one party at a time; its capacity caps the headcount.</p>
            <PartiesLiveStatus
              fetching={roomsQuery.isFetching || todayQuery.isFetching}
              updatedAt={roomsQuery.dataUpdatedAt}
              failed={Boolean(roomsQuery.error)}
              onRefresh={() => {
                void roomsQuery.refetch();
                void todayQuery.refetch();
              }}
            />
          </div>
        }
      />
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <PartiesErrorBanner error={roomsQuery.error} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active rooms" tone="gold" loading={firstLoad} value={activeRooms.length} hint={`${counts.archived} archived`} />
        <StatCard label="Total capacity" tone="stone" loading={firstLoad} value={totalCapacity} hint="guests across active rooms" />
        <StatCard
          label="In use now"
          tone="green"
          loading={firstLoad}
          value={inUseNow}
          hint={inUseNow ? 'a party is in the room right now' : 'no party in a room right now'}
        />
        <StatCard
          label="Booked today"
          tone="violet"
          loading={firstLoad}
          value={bookedToday}
          hint={`of ${activeRooms.length} active room${activeRooms.length === 1 ? '' : 's'}`}
        />
      </section>

      {canRooms ? (
        <form onSubmit={onCreate} className="rounded-2xl border border-[#D4AF37]/40 bg-gradient-to-r from-[#D4AF37]/10 via-white to-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D4AF37]/20 text-[#8a6d12]">
              <Plus className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-stone-900">Add a party room</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto_auto] md:items-end">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Venue</span>
              <select
                value={newVenue}
                onChange={(e) => setNewVenue(e.target.value)}
                disabled={Boolean(scopedLocationId) || createMutation.isPending}
                className={fieldBase}
              >
                <option value="">Choose a venue…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Room name</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Party Room A"
                disabled={createMutation.isPending}
                className={fieldBase}
              />
            </label>
            <div className="space-y-1">
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Capacity</span>
              <Stepper value={newCapacity} onChange={setNewCapacity} disabled={createMutation.isPending} label="capacity" />
            </div>
            <button type="submit" disabled={createMutation.isPending || !newVenue || newName.trim().length < 2} className={primaryBtn}>
              {createMutation.isPending ? <Spin className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {createMutation.isPending ? 'Adding…' : 'Add room'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {(
            [
              { key: 'active', label: 'Active' },
              { key: 'archived', label: 'Archived' },
              { key: 'all', label: 'All' },
            ] as const
          ).map((t) => {
            const active = status === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                  active ? 'bg-stone-900 text-white shadow-sm' : 'bg-stone-100 text-stone-600 hover:bg-[#D4AF37]/15 hover:text-stone-900'
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? 'bg-white/20' : 'bg-white text-stone-500'}`}>
                  {counts[t.key]}
                </span>
              </button>
            );
          })}
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms"
              className="h-9 w-52 rounded-lg border border-stone-200 bg-white pl-9 pr-8 text-sm shadow-sm placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
              aria-label="Search rooms"
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
        </div>
      </section>

      <section className="relative">
        <div className={`pointer-events-none absolute inset-x-0 -top-2 h-0.5 overflow-hidden transition-opacity ${roomsQuery.isFetching && !firstLoad ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-full w-1/3 animate-[roombar_1.1s_ease-in-out_infinite] rounded-full bg-[#D4AF37]" />
        </div>
        <style>{`@keyframes roombar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

        {firstLoad ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a6d12]">
              <DoorOpen className="h-6 w-6" />
            </span>
            <p className="font-semibold text-stone-900">
              {all.length === 0 ? 'No party rooms yet' : term ? 'No rooms match your search' : `No ${status === 'archived' ? 'archived' : 'active'} rooms`}
            </p>
            <p className="max-w-sm text-sm text-stone-500">
              {all.length === 0
                ? 'Add your first room above — packages and new parties can then reserve it, and double-booking is blocked automatically.'
                : 'Try another status, venue or search.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((r) => {
              const use = usage.get(r.id);
              const isEditing = editing?.id === r.id;
              const rowBusy = busy?.id === r.id ? busy.action : null;
              return (
                <article
                  key={r.id}
                  className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:border-[#D4AF37]/50 hover:shadow-md ${
                    r.archivedAt ? 'border-stone-200 opacity-70' : use?.current ? 'border-emerald-300' : 'border-stone-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        r.archivedAt ? 'bg-stone-100 text-stone-400' : 'bg-[#D4AF37]/15 text-[#8a6d12]'
                      }`}
                    >
                      <DoorOpen className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          onKeyDown={onEditKey}
                          className={fieldBase}
                          aria-label="Room name"
                        />
                      ) : (
                        <h3 className="truncate text-base font-semibold text-stone-900">{r.name}</h3>
                      )}
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                        {showVenue && r.location ? <span>{r.location.name}</span> : null}
                        {r.archivedAt ? (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">Archived</span>
                        ) : use?.current ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            In use now
                          </span>
                        ) : (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800">Available</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                      <Users className="h-3.5 w-3.5" />
                      Capacity
                    </span>
                    {isEditing ? (
                      <Stepper
                        value={editing.capacity}
                        onChange={(v) => setEditing({ ...editing, capacity: v })}
                        label="capacity"
                      />
                    ) : (
                      <span className="text-lg font-semibold tabular-nums text-stone-900">
                        {r.defaultCapacity}
                        <span className="ml-1 text-xs font-normal text-stone-500">guests</span>
                      </span>
                    )}
                  </div>

                  {!r.archivedAt ? (
                    <div className="space-y-1 text-xs text-stone-600">
                      {use?.current ? (
                        <p className="truncate">
                          <span className="font-medium text-emerald-700">Now:</span> {use.current.partyName} · until{' '}
                          {timeInZone(use.current.visitEndsAt, use.current.timezone)}
                        </p>
                      ) : null}
                      {use?.next ? (
                        <p className="truncate">
                          <span className="font-medium text-stone-800">Next:</span> {timeInZone(use.next.visitStartsAt, use.next.timezone)} ·{' '}
                          {use.next.partyName}
                        </p>
                      ) : null}
                      <p className="text-stone-500">
                        {use?.today ? `${use.today} part${use.today === 1 ? 'y' : 'ies'} today` : 'No parties today'}
                      </p>
                    </div>
                  ) : null}

                  {canRooms ? (
                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                      {isEditing ? (
                        <>
                          <button type="button" className={`${smallBtn} border-[#D4AF37] bg-[#D4AF37] text-stone-950 hover:bg-[#c4a030]`} disabled={rowBusy === 'save'} onClick={saveEdit}>
                            {rowBusy === 'save' ? <Spin /> : <Check className="h-3.5 w-3.5" />}
                            Save
                          </button>
                          <button type="button" className={smallBtn} disabled={rowBusy === 'save'} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </>
                      ) : r.archivedAt ? (
                        <button type="button" className={smallBtn} disabled={Boolean(rowBusy)} onClick={() => restore(r)}>
                          {rowBusy === 'restore' ? <Spin /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={smallBtn}
                            disabled={Boolean(rowBusy)}
                            onClick={() => setEditing({ id: r.id, name: r.name, capacity: String(r.defaultCapacity) })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${smallBtn} ml-auto text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800`}
                            disabled={Boolean(rowBusy)}
                            onClick={() => archive(r)}
                          >
                            {rowBusy === 'archive' ? <Spin /> : <Archive className="h-3.5 w-3.5" />}
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
