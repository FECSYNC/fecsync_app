'use client';

import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  Clock,
  DoorOpen,
  Eye,
  EyeOff,
  PackagePlus,
  PartyPopper,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  useArchivePartyPackageMutation,
  usePartyPackagesQuery,
  usePatchPartyPackageMutation,
} from '@/hooks/useParties';
import {
  adminPartyKeys,
  getAdminPartyPackage,
  listAdminPartyMenu,
  listAdminPartyRooms,
  type PartyPackageDto,
} from '@/services/adminParties';
import PartyPackageEditorModal from './PartyPackageEditorModal';
import {
  PartiesErrorBanner,
  PartiesPageHeader,
  PartyScopeBanner,
  formatCents,
  useActiveVenues,
  usePartyCatalogPermissions,
} from './partiesUi';
import PartiesLiveStatus from './PartiesLiveStatus';
import { partyErrorMessage } from './partyFormat';

type StatusKey = 'active' | 'published' | 'draft' | 'archived' | 'all';

const STATUS_TABS: Array<{ key: StatusKey; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

/** One list for every filter: status / venue / search are applied in the browser, so switching is instant. */
const ALL_PACKAGES = { status: 'all' } as const;

const STATUS_CHIP: Record<PartyPackageDto['status'], { label: string; className: string }> = {
  published: { label: 'Published', className: 'bg-emerald-500/90 text-white' },
  draft: { label: 'Draft', className: 'bg-stone-800/80 text-white' },
  archived: { label: 'Archived', className: 'bg-red-500/85 text-white' },
};

const toolbarBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-60';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

function matchesStatus(p: PartyPackageDto, status: StatusKey) {
  if (status === 'all') return true;
  if (status === 'active') return p.status !== 'archived';
  return p.status === status;
}

/** What still blocks publishing (mirrors the server's publish checks we can see in the list DTO). */
function setupGaps(p: PartyPackageDto): string[] {
  const gaps: string[] = [];
  if (p.config.basePriceCents == null) gaps.push('a price');
  if (!p.config.roomAssignedAtBooking && !p.room) gaps.push('a room');
  if (!p.config.durationMinutes) gaps.push('a length');
  return gaps;
}

function durationLabel(min: number) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m} min`;
}

/* ───────────────────────────── pieces ───────────────────────────── */

function StatCard({
  label,
  value,
  hint,
  active,
  onClick,
  tone = 'gold',
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  active?: boolean;
  onClick?: () => void;
  tone?: 'gold' | 'green' | 'stone' | 'red';
  loading?: boolean;
}) {
  const bar = { gold: 'bg-[#D4AF37]', green: 'bg-emerald-500', stone: 'bg-stone-400', red: 'bg-red-400' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': active } : {})}
      className={`relative overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition ${
        active ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/30' : 'border-stone-200'
      } ${onClick ? 'hover:border-[#D4AF37]/60 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/40' : ''}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
      <span className="block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {loading ? (
        <span className="mt-1.5 block h-7 w-14 animate-pulse rounded bg-stone-200" />
      ) : (
        <span className="mt-0.5 block text-2xl font-semibold tabular-nums text-stone-900">{value}</span>
      )}
      <span className="block truncate text-xs text-stone-500">{hint}</span>
    </Tag>
  );
}

function Fact({ icon, children, tone = 'default' }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'warn' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${tone === 'warn' ? 'text-amber-800' : 'text-stone-600'}`}>
      <span className={tone === 'warn' ? 'text-amber-600' : 'text-stone-400'}>{icon}</span>
      {children}
    </span>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="h-28 animate-pulse bg-gradient-to-br from-[#D4AF37]/20 to-stone-100" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200" />
        <div className="h-3 w-full animate-pulse rounded bg-stone-100" />
        <div className="h-6 w-24 animate-pulse rounded bg-stone-200" />
        <div className="flex gap-2">
          <div className="h-3 w-16 animate-pulse rounded bg-stone-100" />
          <div className="h-3 w-20 animate-pulse rounded bg-stone-100" />
        </div>
        <div className="flex gap-2 pt-2">
          <div className="h-8 w-16 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-8 w-20 animate-pulse rounded-lg bg-stone-100" />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function PartyPackagesPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { canPackages } = usePartyCatalogPermissions();
  const { locationId, setLocationId, scopedLocationId, scopedLocationName, locationScoped } = useHqLocationFilter();
  const { venues } = useActiveVenues(scopedLocationId);

  const [status, setStatus] = useState<StatusKey>('active');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<{ id: string; action: 'publish' | 'archive' | 'restore' } | null>(null);
  const packagesQuery = usePartyPackagesQuery(ALL_PACKAGES);
  const patchMutation = usePatchPartyPackageMutation();
  const archiveMutation = useArchivePartyPackageMutation();

  const all = packagesQuery.data ?? [];
  const firstLoad = !packagesQuery.data && packagesQuery.isPending;
  const inVenue = useMemo(() => all.filter((p) => !locationId || p.locationId === locationId), [all, locationId]);
  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = { active: 0, published: 0, draft: 0, archived: 0, all: inVenue.length };
    for (const p of inVenue) {
      c[p.status] += 1;
      if (p.status !== 'archived') c.active += 1;
    }
    return c;
  }, [inVenue]);
  const fromPrice = useMemo(() => {
    const prices = inVenue
      .filter((p) => p.status === 'published' && p.config.basePriceCents != null)
      .map((p) => p.config.basePriceCents as number);
    return prices.length ? Math.min(...prices) : null;
  }, [inVenue]);
  const needsSetup = useMemo(() => inVenue.filter((p) => p.status === 'draft' && setupGaps(p).length > 0).length, [inVenue]);

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const order = { published: 0, draft: 1, archived: 2 } as const;
    return inVenue
      .filter((p) => matchesStatus(p, status))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.description ?? '').toLowerCase().includes(term) ||
          (p.location?.name ?? '').toLowerCase().includes(term)
      )
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  }, [inVenue, status, term]);

  const showVenue = !locationId && venues.length > 1;
  const filtersActive = Boolean(term) || status !== 'active' || Boolean(locationId && !scopedLocationId);

  /* Optimistic cache edit → the card flips instantly; the catalog refetch then confirms. */
  const listKey = adminPartyKeys.packages(ALL_PACKAGES);
  const patchCache = useCallback(
    (id: string, patch: Partial<PartyPackageDto>) => {
      const prev = qc.getQueryData<PartyPackageDto[]>(listKey);
      if (prev) qc.setQueryData<PartyPackageDto[]>(listKey, prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      return () => {
        if (prev) qc.setQueryData(listKey, prev);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc]
  );

  function togglePublish(p: PartyPackageDto) {
    const next = !p.published;
    if (next) {
      const gaps = setupGaps(p);
      if (gaps.length) {
        addToast(`Add ${gaps.join(' and ')} before publishing — open the package to finish setup.`, 'info');
        return;
      }
    }
    setBusy({ id: p.id, action: 'publish' });
    const rollback = patchCache(p.id, { published: next, status: next ? 'published' : 'draft' });
    patchMutation.mutate(
      { id: p.id, payload: { published: next } },
      {
        onSuccess: () => addToast(next ? `“${p.name}” is live for online booking` : `“${p.name}” moved to drafts`, 'success'),
        onError: (err) => {
          rollback();
          addToast(partyErrorMessage(err, 'Could not update the package'), 'error');
        },
        onSettled: () => setBusy(null),
      }
    );
  }

  function archive(p: PartyPackageDto) {
    if (!window.confirm(`Archive “${p.name}”? It stops selling; existing parties are kept.`)) return;
    setBusy({ id: p.id, action: 'archive' });
    const rollback = patchCache(p.id, { status: 'archived', published: false, archivedAt: new Date().toISOString() });
    archiveMutation.mutate(p.id, {
      onSuccess: () => addToast(`“${p.name}” archived`, 'success'),
      onError: (err) => {
        rollback();
        addToast(partyErrorMessage(err, 'Archive failed'), 'error');
      },
      onSettled: () => setBusy(null),
    });
  }

  function restore(p: PartyPackageDto) {
    setBusy({ id: p.id, action: 'restore' });
    const rollback = patchCache(p.id, { status: p.published ? 'published' : 'draft', archivedAt: null });
    patchMutation.mutate(
      { id: p.id, payload: { unarchive: true } },
      {
        onSuccess: () => addToast(`“${p.name}” restored`, 'success'),
        onError: (err) => {
          rollback();
          addToast(partyErrorMessage(err, 'Could not restore the package'), 'error');
        },
        onSettled: () => setBusy(null),
      }
    );
  }

  /* Hover → warm what the editor reads (package, rooms, menu) so the sheet paints filled. */
  const hoverTimer = useRef<number | null>(null);
  const warmEditor = useCallback(
    (id?: string) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        const warm = <T,>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
          void qc.prefetchQuery({ queryKey, queryFn, staleTime: 30_000 }).catch(() => undefined);
        if (id) warm(adminPartyKeys.package(id), () => getAdminPartyPackage(id));
        warm(adminPartyKeys.rooms({}), () => listAdminPartyRooms({}));
        warm(adminPartyKeys.menu({}), () => listAdminPartyMenu({}));
      }, 100);
    },
    [qc]
  );

  /** Package editor sheet: undefined id = create. Modified clicks still open the full page in a new tab. */
  const [editor, setEditor] = useState<{ id?: string } | null>(null);
  const openEditor = (id: string | undefined, e?: MouseEvent) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) {
      e.preventDefault();
      window.open(`/admin/parties/packages/${id ?? 'new'}`, '_blank', 'noopener');
      return;
    }
    e?.preventDefault();
    setEditor({ id });
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('active');
    if (!scopedLocationId) setLocationId('');
  };

  return (
    <div className="space-y-5">
      <PartiesPageHeader
        title="Party packages"
        description={
          <div className="space-y-1">
            <p>Everything a party includes — length, guests, room, deposit, food and add-ons — and whether guests can book it online.</p>
            <PartiesLiveStatus
              fetching={packagesQuery.isFetching}
              updatedAt={packagesQuery.dataUpdatedAt}
              failed={Boolean(packagesQuery.error)}
              onRefresh={() => void packagesQuery.refetch()}
            />
          </div>
        }
        actions={
          canPackages ? (
            <a
              href="/admin/parties/packages/new"
              className={primaryBtn}
              onMouseEnter={() => warmEditor()}
              onFocus={() => warmEditor()}
              onClick={(e) => openEditor(undefined, e)}
            >
              <Plus className="h-4 w-4" />
              New package
            </a>
          ) : null
        }
      />
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <PartiesErrorBanner error={packagesQuery.error} />

      {/* At a glance */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bookable online"
          tone="green"
          loading={firstLoad}
          value={counts.published}
          hint={counts.published ? 'published packages guests can book' : 'publish a package to take bookings'}
          active={status === 'published'}
          onClick={() => setStatus(status === 'published' ? 'active' : 'published')}
        />
        <StatCard
          label="Drafts"
          tone="stone"
          loading={firstLoad}
          value={counts.draft}
          hint={needsSetup ? `${needsSetup} still need setup before publishing` : 'not visible to guests yet'}
          active={status === 'draft'}
          onClick={() => setStatus(status === 'draft' ? 'active' : 'draft')}
        />
        <StatCard
          label="Archived"
          tone="red"
          loading={firstLoad}
          value={counts.archived}
          hint="retired — existing parties kept"
          active={status === 'archived'}
          onClick={() => setStatus(status === 'archived' ? 'active' : 'archived')}
        />
        <StatCard
          label="Parties from"
          tone="gold"
          loading={firstLoad}
          value={fromPrice != null ? formatCents(fromPrice) : '—'}
          hint="lowest published package price"
        />
      </section>

      {/* Toolbar */}
      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_TABS.map((t) => {
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
              placeholder="Search packages"
              className="h-9 w-56 rounded-lg border border-stone-200 bg-white pl-9 pr-8 text-sm shadow-sm placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
              aria-label="Search packages"
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

      {/* Packages */}
      <section className="relative">
        <div className={`pointer-events-none absolute inset-x-0 -top-2 h-0.5 overflow-hidden transition-opacity ${packagesQuery.isFetching && !firstLoad ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-full w-1/3 animate-[pkgbar_1.1s_ease-in-out_infinite] rounded-full bg-[#D4AF37]" />
        </div>
        <style>{`@keyframes pkgbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

        {firstLoad ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : all.length === 0 && !packagesQuery.error ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#D4AF37]/50 bg-gradient-to-b from-[#D4AF37]/10 to-white px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D4AF37]/20 text-[#8a6d12]">
              <PackagePlus className="h-7 w-7" />
            </span>
            <p className="text-lg font-semibold text-stone-900">Create your first party package</p>
            <p className="max-w-md text-sm text-stone-600">
              Set the length, included guests, price, room and deposit once — staff and guests book from it, and every party
              stays in sync with Bookings, Balances and Run sheets.
            </p>
            {canPackages ? (
              <a
                href="/admin/parties/packages/new"
                className={primaryBtn}
                onMouseEnter={() => warmEditor()}
                onClick={(e) => openEditor(undefined, e)}
              >
                <Plus className="h-4 w-4" />
                New package
              </a>
            ) : null}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-stone-200 bg-white px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
              <Search className="h-6 w-6" />
            </span>
            <p className="font-semibold text-stone-900">No packages match these filters</p>
            {filtersActive ? (
              <button type="button" className={toolbarBtn} onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => {
              const chip = STATUS_CHIP[p.status];
              const gaps = p.status === 'draft' ? setupGaps(p) : [];
              const rowBusy = busy?.id === p.id ? busy.action : null;
              const opening = editor?.id === p.id;
              const extras = [
                p.config.extraKidPriceCents != null ? `+${formatCents(p.config.extraKidPriceCents)} per extra kid` : null,
                p.config.extraAdultPriceCents != null ? `+${formatCents(p.config.extraAdultPriceCents)} per extra adult` : null,
              ].filter(Boolean);
              return (
                <article
                  key={p.id}
                  onMouseEnter={() => warmEditor(p.id)}
                  onFocus={() => warmEditor(p.id)}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a,button')) return;
                    openEditor(p.id, e);
                  }}
                  className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#D4AF37]/60 hover:shadow-lg ${
                    p.status === 'archived' ? 'border-stone-200 opacity-75' : 'border-stone-200'
                  } ${opening ? 'ring-2 ring-[#D4AF37]/50' : ''}`}
                >
                  <div className="relative h-28 overflow-hidden">
                    {p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0]} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#D4AF37]/35 via-[#f6ecd0] to-stone-100">
                        <PartyPopper className="h-10 w-10 text-[#8a6d12]/70" />
                      </div>
                    )}
                    <span className={`absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-sm ${chip.className}`}>
                      {chip.label}
                    </span>
                    {showVenue && p.location ? (
                      <span className="absolute right-3 top-3 max-w-[60%] truncate rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-medium text-stone-700 shadow-sm">
                        {p.location.name}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div>
                      <h3 className="truncate text-base font-semibold text-stone-900 group-hover:text-[#8a6d12]">{p.name}</h3>
                      {p.description ? <p className="mt-0.5 line-clamp-2 text-xs text-stone-500">{p.description}</p> : null}
                    </div>

                    <div className="flex items-end justify-between gap-2">
                      {p.config.basePriceCents != null ? (
                        <p className="text-2xl font-semibold tabular-nums text-stone-900">
                          {formatCents(p.config.basePriceCents)}
                          <span className="ml-1 text-xs font-normal text-stone-500">/ party</span>
                        </p>
                      ) : (
                        <p className="text-sm font-medium text-amber-700">No price yet</p>
                      )}
                      {p.depositPreviewCents > 0 ? (
                        <span className="rounded-full bg-[#D4AF37]/15 px-2 py-0.5 text-[11px] font-medium text-[#8a6d12]">
                          Deposit {formatCents(p.depositPreviewCents)}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      <Fact icon={<Clock className="h-3.5 w-3.5" />}>{durationLabel(p.config.durationMinutes)}</Fact>
                      <Fact icon={<Users className="h-3.5 w-3.5" />}>
                        {p.config.includedKids} kids · {p.config.includedAdults} adults
                        {p.maxGuests ? ` · max ${p.maxGuests}` : ''}
                      </Fact>
                      <Fact
                        icon={<DoorOpen className="h-3.5 w-3.5" />}
                        tone={!p.config.roomAssignedAtBooking && !p.room ? 'warn' : 'default'}
                      >
                        {p.config.roomAssignedAtBooking ? 'Room picked at booking' : (p.room?.name ?? 'No room')}
                      </Fact>
                      {p.config.includesFood ? <Fact icon={<UtensilsCrossed className="h-3.5 w-3.5" />}>Food included</Fact> : null}
                      {p.addOns.length ? (
                        <Fact icon={<Sparkles className="h-3.5 w-3.5" />}>
                          {p.addOns.length} add-on{p.addOns.length === 1 ? '' : 's'}
                        </Fact>
                      ) : null}
                      {p.waiverRequired ? <Fact icon={<ShieldCheck className="h-3.5 w-3.5" />}>Waiver required</Fact> : null}
                    </div>

                    {extras.length ? <p className="text-[11px] text-stone-500">{extras.join(' · ')}</p> : null}

                    {gaps.length ? (
                      <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Add {gaps.join(' and ')} to publish this package.
                      </p>
                    ) : null}

                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                      <a
                        href={`/admin/parties/packages/${p.id}`}
                        className={toolbarBtn}
                        onClick={(e) => openEditor(p.id, e)}
                      >
                        {canPackages ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {canPackages ? 'Edit' : 'View'}
                      </a>
                      {canPackages && p.status !== 'archived' ? (
                        <button type="button" className={toolbarBtn} disabled={Boolean(rowBusy)} onClick={() => togglePublish(p)}>
                          {rowBusy === 'publish' ? (
                            <Spin />
                          ) : p.published ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                          {p.published ? 'Unpublish' : 'Publish'}
                        </button>
                      ) : null}
                      {canPackages ? (
                        p.status === 'archived' ? (
                          <button type="button" className={toolbarBtn} disabled={Boolean(rowBusy)} onClick={() => restore(p)}>
                            {rowBusy === 'restore' ? <Spin /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${toolbarBtn} ml-auto text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800`}
                            disabled={Boolean(rowBusy)}
                            onClick={() => archive(p)}
                          >
                            {rowBusy === 'archive' ? <Spin /> : <Archive className="h-3.5 w-3.5" />}
                            Archive
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editor ? (
        <PartyPackageEditorModal
          productId={editor.id}
          onClose={() => setEditor(null)}
          onCreated={(id) => setEditor({ id })}
        />
      ) : null}
    </div>
  );
}
