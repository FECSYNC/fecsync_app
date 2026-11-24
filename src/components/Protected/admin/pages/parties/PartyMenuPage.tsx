'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Cake,
  Check,
  CupSoda,
  Link2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  useCreatePartyMenuItemMutation,
  usePartyMenuPosProductsQuery,
  usePartyMenuQuery,
  usePatchPartyMenuItemMutation,
} from '@/hooks/useParties';
import { adminPartyKeys, partyFieldErrors, type PartyMenuItemDto } from '@/services/adminParties';
import {
  FieldError,
  PartiesErrorBanner,
  PartiesPageHeader,
  PartyScopeBanner,
  centsToInput,
  formatCents,
  inputToCents,
  useActiveVenues,
  usePartyCatalogPermissions,
} from './partiesUi';
import PartiesLiveStatus from './PartiesLiveStatus';
import { partyErrorMessage } from './partyFormat';

type Kind = PartyMenuItemDto['kind'];
type StatusKey = 'active' | 'hidden' | 'archived' | 'all';

const KINDS: Array<{ value: Kind; label: string; plural: string; icon: ReactNode; tint: string }> = [
  { value: 'food', label: 'Food', plural: 'Food', icon: <UtensilsCrossed className="h-4 w-4" />, tint: 'bg-orange-50 text-orange-700' },
  { value: 'beverage', label: 'Drink', plural: 'Drinks', icon: <CupSoda className="h-4 w-4" />, tint: 'bg-sky-50 text-sky-700' },
  { value: 'cake', label: 'Cake', plural: 'Cakes', icon: <Cake className="h-4 w-4" />, tint: 'bg-pink-50 text-pink-700' },
  { value: 'other', label: 'Other', plural: 'Other', icon: <Sparkles className="h-4 w-4" />, tint: 'bg-violet-50 text-violet-700' },
];
const KIND_META = Object.fromEntries(KINDS.map((k) => [k.value, k])) as Record<Kind, (typeof KINDS)[number]>;

/** Every item (archived included) in one fetch — kind / status / venue / search filter in the browser, instantly. */
const ALL_ITEMS = { includeArchived: true } as const;

type Draft = { name: string; description: string; kind: Kind; price: string; sortOrder: string; posProductId: string };
const EMPTY: Draft = { name: '', description: '', kind: 'food', price: '', sortOrder: '0', posProductId: '' };

const fieldBase =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 shadow-sm transition placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30 disabled:opacity-60';
const smallBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:cursor-not-allowed disabled:opacity-60';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

function KindPicker({ value, onChange, disabled }: { value: Kind; onChange: (k: Kind) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
      {KINDS.map((k) => {
        const active = value === k.value;
        return (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(k.value)}
            className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
              active ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
            }`}
          >
            {k.icon}
            {k.label}
          </button>
        );
      })}
    </div>
  );
}

function PriceInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
      <input
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        placeholder="0.00"
        className={`${fieldBase} pl-7 tabular-nums`}
        aria-label="Price"
      />
    </div>
  );
}

function Toggle({ on, onChange, disabled, busy, label }: { on: boolean; onChange: () => void; disabled?: boolean; busy?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'bg-emerald-500' : 'bg-stone-300'
      }`}
    >
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`}>
        {busy ? <Spin className="h-3 w-3 text-stone-400" /> : null}
      </span>
    </button>
  );
}

function StatCard({ label, value, hint, loading, tone }: { label: string; value: ReactNode; hint: string; loading?: boolean; tone: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${tone}`} aria-hidden />
      <span className="block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {loading ? (
        <span className="mt-1.5 block h-7 w-14 animate-pulse rounded bg-stone-200" />
      ) : (
        <span className="mt-0.5 block truncate text-2xl font-semibold tabular-nums text-stone-900">{value}</span>
      )}
      <span className="block truncate text-xs text-stone-500">{hint}</span>
    </div>
  );
}

/* ───────────────────────────── one item row ───────────────────────────── */

function MenuItemRow({
  item,
  canMenu,
  showVenue,
  busy,
  onToggle,
  onSave,
  onArchive,
  onRestore,
}: {
  item: PartyMenuItemDto;
  canMenu: boolean;
  showVenue: boolean;
  busy: 'toggle' | 'save' | 'archive' | 'restore' | null;
  onToggle: () => void;
  onSave: (d: Draft, done: () => void) => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const [edit, setEdit] = useState<Draft | null>(null);
  // POS options load only while this row is being edited.
  const posQ = usePartyMenuPosProductsQuery(edit ? item.locationId : null);
  const meta = KIND_META[item.kind] ?? KIND_META.other;
  const archived = Boolean(item.archivedAt);

  const startEdit = () =>
    setEdit({
      name: item.name,
      description: item.description ?? '',
      kind: item.kind,
      price: centsToInput(item.priceCents),
      sortOrder: String(item.sortOrder),
      posProductId: item.posProductId ?? '',
    });
  const save = () => edit && onSave(edit, () => setEdit(null));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setEdit(null);
    }
  };

  if (edit) {
    return (
      <li className="space-y-3 bg-[#D4AF37]/[0.06] px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_0.6fr]">
          <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={onKey} className={fieldBase} aria-label="Name" />
          <PriceInput value={edit.price} onChange={(v) => setEdit({ ...edit, price: v })} />
          <input
            type="number"
            value={edit.sortOrder}
            onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })}
            onKeyDown={onKey}
            className={fieldBase}
            aria-label="Sort order"
            title="Lower numbers show first"
          />
        </div>
        <KindPicker value={edit.kind} onChange={(k) => setEdit({ ...edit, kind: k })} />
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={edit.description}
            onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            onKeyDown={onKey}
            placeholder="Description (optional)"
            className={fieldBase}
            aria-label="Description"
          />
          <select value={edit.posProductId} onChange={(e) => setEdit({ ...edit, posProductId: e.target.value })} className={fieldBase} aria-label="POS product">
            <option value="">{posQ.isFetching && !posQ.data ? 'Loading POS products…' : 'No POS link'}</option>
            {(posQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatCents(p.priceCents)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" className={`${smallBtn} border-[#D4AF37] bg-[#D4AF37] text-stone-950 hover:bg-[#c4a030]`} disabled={busy === 'save'} onClick={save}>
            {busy === 'save' ? <Spin /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
          <button type="button" className={smallBtn} disabled={busy === 'save'} onClick={() => setEdit(null)}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`group flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-stone-50/70 ${archived ? 'opacity-60' : ''}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`truncate font-semibold ${item.available || archived ? 'text-stone-900' : 'text-stone-500'}`}>{item.name}</span>
          {archived ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">Archived</span>
          ) : !item.available ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Hidden</span>
          ) : null}
          {item.posProductId ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#D4AF37]/15 px-2 py-0.5 text-[11px] font-medium text-[#8a6d12]" title="Kitchen orders use the linked POS product">
              <Link2 className="h-3 w-3" />
              POS linked
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-stone-500">
          {[item.description, showVenue ? item.location?.name : null].filter(Boolean).join(' · ') || meta.label}
        </p>
      </div>
      <span className="w-20 text-right text-base font-semibold tabular-nums text-stone-900">{formatCents(item.priceCents)}</span>
      {canMenu ? (
        <div className="flex items-center gap-2">
          {!archived ? (
            <Toggle
              on={item.available}
              busy={busy === 'toggle'}
              disabled={Boolean(busy)}
              onChange={onToggle}
              label={item.available ? `Hide ${item.name}` : `Show ${item.name}`}
            />
          ) : null}
          {archived ? (
            <button type="button" className={smallBtn} disabled={Boolean(busy)} onClick={onRestore}>
              {busy === 'restore' ? <Spin /> : <ArchiveRestore className="h-3.5 w-3.5" />}
              Restore
            </button>
          ) : (
            <>
              <button type="button" className={smallBtn} disabled={Boolean(busy)} onClick={startEdit} aria-label={`Edit ${item.name}`}>
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                type="button"
                className={`${smallBtn} text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800`}
                disabled={Boolean(busy)}
                onClick={onArchive}
                aria-label={`Archive ${item.name}`}
              >
                {busy === 'archive' ? <Spin /> : <Archive className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function PartyMenuPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { canMenu } = usePartyCatalogPermissions();
  const { locationId, setLocationId, scopedLocationId, scopedLocationName, locationScoped } = useHqLocationFilter();
  const { venues } = useActiveVenues(scopedLocationId);

  const menuQuery = usePartyMenuQuery(ALL_ITEMS);
  const createMutation = useCreatePartyMenuItemMutation();
  const patchMutation = usePatchPartyMenuItemMutation();

  const [status, setStatus] = useState<StatusKey>('active');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<{ id: string; action: 'toggle' | 'save' | 'archive' | 'restore' } | null>(null);

  // Add form
  const defaultVenue = scopedLocationId || locationId || (venues.length === 1 ? venues[0]!.id : '');
  const [formVenue, setFormVenue] = useState('');
  useEffect(() => {
    if (defaultVenue) setFormVenue(defaultVenue);
  }, [defaultVenue]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const posQuery = usePartyMenuPosProductsQuery(canMenu ? formVenue || null : null);
  const posProducts = posQuery.data ?? [];

  const all = menuQuery.data ?? [];
  const firstLoad = !menuQuery.data && menuQuery.isPending;
  const inVenue = useMemo(() => all.filter((i) => !locationId || i.locationId === locationId), [all, locationId]);
  const statusCounts = useMemo(
    () => ({
      active: inVenue.filter((i) => !i.archivedAt).length,
      hidden: inVenue.filter((i) => !i.archivedAt && !i.available).length,
      archived: inVenue.filter((i) => i.archivedAt).length,
      all: inVenue.length,
    }),
    [inVenue]
  );
  const byStatus = useMemo(
    () =>
      inVenue.filter((i) =>
        status === 'all' ? true : status === 'archived' ? Boolean(i.archivedAt) : status === 'hidden' ? !i.archivedAt && !i.available : !i.archivedAt
      ),
    [inVenue, status]
  );
  const kindCounts = useMemo(() => {
    const c: Record<string, number> = { all: byStatus.length };
    for (const i of byStatus) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [byStatus]);
  const term = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const list = byStatus
      .filter((i) => kind === 'all' || i.kind === kind)
      .filter((i) => !term || i.name.toLowerCase().includes(term) || (i.description ?? '').toLowerCase().includes(term))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return KINDS.map((k) => ({ ...k, items: list.filter((i) => i.kind === k.value) })).filter((g) => g.items.length);
  }, [byStatus, kind, term]);
  const visibleCount = groups.reduce((s, g) => s + g.items.length, 0);

  const live = inVenue.filter((i) => !i.archivedAt);
  const onMenu = live.filter((i) => i.available);
  const prices = onMenu.map((i) => i.priceCents);
  const priceRange = prices.length ? `${formatCents(Math.min(...prices))} – ${formatCents(Math.max(...prices))}` : '—';
  const linked = live.filter((i) => i.posProductId).length;
  const showVenue = !locationId && venues.length > 1;

  /* Optimistic cache edits — rows update instantly, the catalog refetch confirms. */
  const listKey = adminPartyKeys.menu(ALL_ITEMS);
  const patchCache = useCallback(
    (fn: (rows: PartyMenuItemDto[]) => PartyMenuItemDto[]) => {
      const prev = qc.getQueryData<PartyMenuItemDto[]>(listKey);
      if (prev) qc.setQueryData<PartyMenuItemDto[]>(listKey, fn(prev));
      return () => {
        if (prev) qc.setQueryData(listKey, prev);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc]
  );

  const runPatch = (
    item: PartyMenuItemDto,
    action: 'toggle' | 'save' | 'archive' | 'restore',
    payload: Record<string, unknown>,
    optimistic: Partial<PartyMenuItemDto>,
    done: string,
    after?: () => void
  ) => {
    setBusy({ id: item.id, action });
    const rollback = patchCache((rows) => rows.map((r) => (r.id === item.id ? { ...r, ...optimistic } : r)));
    patchMutation.mutate(
      { id: item.id, payload },
      {
        onSuccess: () => {
          addToast(done, 'success');
          after?.();
        },
        onError: (err) => {
          rollback();
          addToast(partyErrorMessage(err, 'Could not update the item'), 'error');
        },
        onSettled: () => setBusy(null),
      }
    );
  };

  const onPickPos = (id: string) => {
    const p = posProducts.find((x) => x.id === id);
    setDraft((d) => ({
      ...d,
      posProductId: id,
      // Fill blanks from the POS product so linking is one click.
      name: d.name.trim() || !p ? d.name : p.name,
      price: d.price.trim() || !p ? d.price : centsToInput(p.priceCents),
    }));
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!formVenue) return void addToast('Choose the venue for this item', 'error');
    if (draft.name.trim().length < 2) return void addToast('Give the item a name', 'error');
    const priceCents = inputToCents(draft.price);
    if (priceCents == null || priceCents < 0) return void addToast('Enter a price (0 or more)', 'error');
    setErrors({});
    try {
      const item = await createMutation.mutateAsync({
        locationId: formVenue,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        kind: draft.kind,
        priceCents,
        sortOrder: Number(draft.sortOrder) || 0,
        posProductId: draft.posProductId || null,
      });
      patchCache((rows) => (rows.some((r) => r.id === item.id) ? rows : [...rows, item]));
      addToast(`“${item.name}” added to the menu`, 'success');
      setDraft({ ...EMPTY, kind: draft.kind });
      if (status === 'archived' || status === 'hidden') setStatus('active');
    } catch (err) {
      setErrors(partyFieldErrors(err));
      addToast(partyErrorMessage(err, 'Could not create the item'), 'error');
    }
  };

  return (
    <div className="space-y-5">
      <PartiesPageHeader
        title="Party menu"
        description={
          <div className="space-y-1">
            <p>Food, drinks and cakes staff and hosts can add to a party. Linking a POS product uses its price and kitchen route.</p>
            <PartiesLiveStatus
              fetching={menuQuery.isFetching}
              updatedAt={menuQuery.dataUpdatedAt}
              failed={Boolean(menuQuery.error)}
              onRefresh={() => void menuQuery.refetch()}
            />
          </div>
        }
      />
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <PartiesErrorBanner error={menuQuery.error} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="On the menu" tone="bg-emerald-500" loading={firstLoad} value={onMenu.length} hint="available to order" />
        <StatCard label="Hidden" tone="bg-amber-400" loading={firstLoad} value={statusCounts.hidden} hint="kept, but not orderable" />
        <StatCard label="POS linked" tone="bg-[#D4AF37]" loading={firstLoad} value={linked} hint="route straight to the kitchen" />
        <StatCard label="Price range" tone="bg-stone-400" loading={firstLoad} value={priceRange} hint="across available items" />
      </section>

      {canMenu ? (
        <form onSubmit={onCreate} className="space-y-3 rounded-2xl border border-[#D4AF37]/40 bg-gradient-to-r from-[#D4AF37]/10 via-white to-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D4AF37]/20 text-[#8a6d12]">
              <Plus className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-stone-900">Add a menu item</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1.6fr_0.8fr]">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Venue</span>
              <select
                value={formVenue}
                onChange={(e) => {
                  setFormVenue(e.target.value);
                  setDraft((d) => ({ ...d, posProductId: '' }));
                }}
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
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Cheese pizza (large)"
                disabled={createMutation.isPending}
                className={fieldBase}
              />
              <FieldError message={errors.name} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Price</span>
              <PriceInput value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} disabled={createMutation.isPending} />
              <FieldError message={errors.priceCents} />
            </label>
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Kind</span>
            <KindPicker value={draft.kind} onChange={(k) => setDraft({ ...draft, kind: k })} disabled={createMutation.isPending} />
          </div>
          <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_0.5fr]">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Description (optional)</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="e.g. Serves 8"
                disabled={createMutation.isPending}
                className={fieldBase}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">POS product (optional)</span>
              <select
                value={draft.posProductId}
                onChange={(e) => onPickPos(e.target.value)}
                disabled={!formVenue || createMutation.isPending}
                className={fieldBase}
              >
                <option value="">
                  {!formVenue ? 'Choose a venue first' : posQuery.isFetching && !posQuery.data ? 'Loading POS products…' : 'No POS link'}
                </option>
                {posProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCents(p.priceCents)})
                  </option>
                ))}
              </select>
              <FieldError message={errors.posProductId} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Sort</span>
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                disabled={createMutation.isPending}
                className={fieldBase}
                title="Lower numbers show first"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={createMutation.isPending || !formVenue || draft.name.trim().length < 2} className={primaryBtn}>
              {createMutation.isPending ? <Spin className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {createMutation.isPending ? 'Adding…' : 'Add to menu'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {(
              [
                { key: 'active', label: 'Active' },
                { key: 'hidden', label: 'Hidden' },
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
                    {statusCounts[t.key]}
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
                placeholder="Search the menu"
                className="h-9 w-52 rounded-lg border border-stone-200 bg-white pl-9 pr-8 text-sm shadow-sm placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
                aria-label="Search the menu"
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
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-stone-100 pt-3" role="group" aria-label="Filter by kind">
          {[{ value: 'all' as const, plural: 'All kinds', icon: null }, ...KINDS].map((k) => {
            const active = kind === k.value;
            return (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  active ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-stone-900' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                }`}
              >
                {k.icon}
                {k.plural}
                <span className="tabular-nums text-stone-400">{kindCounts[k.value] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="relative">
        <div className={`pointer-events-none absolute inset-x-0 -top-2 h-0.5 overflow-hidden transition-opacity ${menuQuery.isFetching && !firstLoad ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-full w-1/3 animate-[menubar_1.1s_ease-in-out_infinite] rounded-full bg-[#D4AF37]" />
        </div>
        <style>{`@keyframes menubar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

        {firstLoad ? (
          <div className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-3">
                <div className="h-9 w-9 rounded-lg bg-stone-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-40 rounded bg-stone-200" />
                  <div className="h-2.5 w-24 rounded bg-stone-100" />
                </div>
                <div className="h-4 w-14 rounded bg-stone-200" />
                <div className="h-6 w-11 rounded-full bg-stone-100" />
              </div>
            ))}
          </div>
        ) : visibleCount === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a6d12]">
              <UtensilsCrossed className="h-6 w-6" />
            </span>
            <p className="font-semibold text-stone-900">{all.length === 0 ? 'Your party menu is empty' : 'Nothing matches these filters'}</p>
            <p className="max-w-sm text-sm text-stone-500">
              {all.length === 0
                ? 'Add pizzas, drinks and cakes above. Packages can include them, and staff or hosts can order them for a party.'
                : 'Try another status, kind, venue or search.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.value} className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50/70 px-4 py-2.5">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-md ${g.tint}`}>{g.icon}</span>
                  <h3 className="text-sm font-semibold text-stone-800">{g.plural}</h3>
                  <span className="text-xs text-stone-400">{g.items.length}</span>
                </div>
                <ul className="divide-y divide-stone-100">
                  {g.items.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      canMenu={canMenu}
                      showVenue={showVenue}
                      busy={busy?.id === item.id ? busy.action : null}
                      onToggle={() =>
                        runPatch(
                          item,
                          'toggle',
                          { available: !item.available },
                          { available: !item.available },
                          item.available ? `“${item.name}” hidden from ordering` : `“${item.name}” is back on the menu`
                        )
                      }
                      onSave={(d, done) => {
                        const priceCents = inputToCents(d.price);
                        if (d.name.trim().length < 2) return addToast('Give the item a name', 'error');
                        if (priceCents == null || priceCents < 0) return addToast('Enter a price (0 or more)', 'error');
                        const payload = {
                          name: d.name.trim(),
                          description: d.description.trim() || null,
                          kind: d.kind,
                          priceCents,
                          sortOrder: Number(d.sortOrder) || 0,
                          posProductId: d.posProductId || null,
                        };
                        runPatch(item, 'save', payload, payload, 'Menu item updated', done);
                      }}
                      onArchive={() => {
                        if (!window.confirm(`Archive “${item.name}”? It leaves the menu; past orders keep it.`)) return;
                        runPatch(item, 'archive', { archive: true }, { archivedAt: new Date().toISOString() }, `“${item.name}” archived`);
                      }}
                      onRestore={() => runPatch(item, 'restore', { unarchive: true }, { archivedAt: null }, `“${item.name}” restored`)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
