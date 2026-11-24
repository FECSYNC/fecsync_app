'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  useCreatePartyPackageMutation,
  useCreatePartyPackageSessionsMutation,
  usePartyMenuQuery,
  usePartyPackageQuery,
  usePartyPackageSessionsQuery,
  usePartyRoomsQuery,
  usePatchPartyPackageMutation,
} from '@/hooks/useParties';
import { listTicketingProducts, ticketingKeys } from '@/services/ticketing';
import { partyFieldErrors, type PartyPackageDto, type PartyPackageInput } from '@/services/adminParties';
import {
  FieldError,
  PartiesErrorBanner,
  PartiesPageHeader,
  PartyScopeBanner,
  btnPrimaryClass,
  btnSecondaryClass,
  centsToInput,
  fieldClass,
  formatCents,
  inputToCents,
  useActiveVenues,
  usePartyCatalogPermissions,
} from './partiesUi';

type Form = {
  locationId: string;
  name: string;
  description: string;
  minGuests: string;
  maxGuests: string;
  durationMinutes: string;
  includedKids: string;
  includedAdults: string;
  extraKidPrice: string;
  extraAdultPrice: string;
  packagePrice: string;
  roomResourceId: string;
  roomAssignedAtBooking: boolean;
  depositPercent: string;
  depositFixed: string;
  includesFood: boolean;
  defaultMenuItemIds: string[];
  addOnIds: string[];
  published: boolean;
};

const EMPTY: Form = {
  locationId: '',
  name: '',
  description: '',
  minGuests: '1',
  maxGuests: '20',
  durationMinutes: '120',
  includedKids: '10',
  includedAdults: '2',
  extraKidPrice: '',
  extraAdultPrice: '',
  packagePrice: '',
  roomResourceId: '',
  roomAssignedAtBooking: false,
  depositPercent: '',
  depositFixed: '',
  includesFood: false,
  defaultMenuItemIds: [],
  addOnIds: [],
  published: false,
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fromPackage(p: PartyPackageDto): Form {
  return {
    locationId: p.locationId,
    name: p.name,
    description: p.description ?? '',
    minGuests: p.minGuests == null ? '' : String(p.minGuests),
    maxGuests: p.maxGuests == null ? '' : String(p.maxGuests),
    durationMinutes: String(p.config.durationMinutes),
    includedKids: String(p.config.includedKids),
    includedAdults: String(p.config.includedAdults),
    extraKidPrice: centsToInput(p.config.extraKidPriceCents),
    extraAdultPrice: centsToInput(p.config.extraAdultPriceCents),
    packagePrice: centsToInput(p.config.basePriceCents),
    roomResourceId: p.config.roomResourceId ?? '',
    roomAssignedAtBooking: p.config.roomAssignedAtBooking,
    depositPercent: p.config.depositPercentOverride == null ? '' : String(p.config.depositPercentOverride),
    depositFixed: centsToInput(p.config.depositFixedCentsOverride),
    includesFood: p.config.includesFood,
    defaultMenuItemIds: p.config.defaultMenuItemIds,
    addOnIds: p.addOns.map((a) => a.productId),
    published: p.published,
  };
}

function intOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export default function PartyPackageEditorPage({
  productId,
  inModal = false,
  onCreated,
  onDirtyChange,
}: {
  productId?: string;
  /** Rendered inside PartyPackageEditorModal: compact header, no page nav. */
  inModal?: boolean;
  /** Modal flow: switch to editing the new package instead of routing. */
  onCreated?: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const { canPackages, canSessions } = usePartyCatalogPermissions();
  const { scopedLocationId, scopedLocationName, locationScoped } = useHqLocationFilter();
  const { venues } = useActiveVenues(scopedLocationId);
  const packageQuery = usePartyPackageQuery(productId);
  const createMutation = useCreatePartyPackageMutation();
  const patchMutation = usePatchPartyPackageMutation();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newAddOnName, setNewAddOnName] = useState('');
  const [newAddOnPrice, setNewAddOnPrice] = useState('');
  const [pendingNewAddOns, setPendingNewAddOns] = useState<Array<{ name: string; priceCents: number }>>([]);
  /** Last saved / loaded form — "dirty" means the user changed something since. */
  const baseline = useRef(JSON.stringify(EMPTY));

  // Refetches (other tabs, catalog invalidation) re-seed the form only when it has no unsaved edits.
  useEffect(() => {
    if (!packageQuery.data) return;
    const next = fromPackage(packageQuery.data);
    setForm((f) => {
      if (JSON.stringify(f) !== baseline.current) return f;
      baseline.current = JSON.stringify(next);
      return next;
    });
  }, [packageQuery.data]);

  // New package: preselect the venue when there is only one choice (park-locked or single venue).
  const onlyVenueId = scopedLocationId || (venues.length === 1 ? venues[0]!.id : '');
  useEffect(() => {
    if (productId || !onlyVenueId) return;
    setForm((f) => {
      if (f.locationId) return f;
      const untouched = JSON.stringify(f) === baseline.current;
      const next = { ...f, locationId: onlyVenueId };
      if (untouched) baseline.current = JSON.stringify(next);
      return next;
    });
  }, [productId, onlyVenueId]);

  const dirty = JSON.stringify(form) !== baseline.current || pendingNewAddOns.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const locationId = form.locationId;
  const roomsQuery = usePartyRoomsQuery({});
  const menuQuery = usePartyMenuQuery({});
  const addOnQuery = useQuery({
    queryKey: ticketingKeys.products({ type: 'add_on', locationId: locationId || undefined }),
    queryFn: () => listTicketingProducts({ type: 'add_on', locationId: locationId || undefined }),
    enabled: Boolean(locationId),
  });
  const rooms = (roomsQuery.data ?? []).filter((r) => r.locationId === locationId && !r.archivedAt);
  const menuItems = (menuQuery.data ?? []).filter((m) => m.locationId === locationId && !m.archivedAt);
  const addOns = (addOnQuery.data ?? []).filter((a) => !a.archivedAt);
  const readOnly = !canPackages || Boolean(packageQuery.data?.archivedAt);

  const payload = useMemo<PartyPackageInput>(
    () => ({
      ...(productId ? {} : { locationId: form.locationId }),
      name: form.name.trim(),
      description: form.description.trim() || null,
      minGuests: intOrNull(form.minGuests),
      maxGuests: intOrNull(form.maxGuests),
      durationMinutes: intOrNull(form.durationMinutes),
      includedKids: intOrNull(form.includedKids),
      includedAdults: intOrNull(form.includedAdults),
      extraKidPriceCents: inputToCents(form.extraKidPrice),
      extraAdultPriceCents: inputToCents(form.extraAdultPrice),
      packagePriceCents: inputToCents(form.packagePrice),
      roomResourceId: form.roomAssignedAtBooking ? null : form.roomResourceId || null,
      roomAssignedAtBooking: form.roomAssignedAtBooking,
      depositPercentOverride: form.depositPercent.trim() ? Number(form.depositPercent) : null,
      depositFixedCentsOverride: inputToCents(form.depositFixed),
      includesFood: form.includesFood,
      defaultMenuItemIds: form.includesFood ? form.defaultMenuItemIds : [],
      addOns: form.addOnIds.map((id) => ({ productId: id })),
      newAddOns: pendingNewAddOns,
      published: form.published,
    }),
    [form, pendingNewAddOns, productId]
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      if (productId) {
        await patchMutation.mutateAsync({ id: productId, payload });
        baseline.current = JSON.stringify(form);
        addToast('Package saved', 'success');
      } else {
        const created = await createMutation.mutateAsync(payload);
        baseline.current = JSON.stringify(form);
        if (onCreated) {
          addToast('Package created — add its bookable time slots below', 'success');
          onCreated(created.id);
        } else {
          addToast('Package created', 'success');
          router.push(`/admin/parties/packages/${created.id}`);
        }
      }
      setPendingNewAddOns([]);
    } catch (err) {
      const fields = partyFieldErrors(err);
      setErrors(fields);
      addToast(
        Object.keys(fields).length ? 'Fix the highlighted fields' : err instanceof Error ? err.message : 'Save failed',
        'error'
      );
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = (key: 'defaultMenuItemIds' | 'addOnIds', id: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }));
  const saving = createMutation.isPending || patchMutation.isPending;

  if (productId && packageQuery.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading package">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="h-4 w-32 animate-pulse rounded bg-stone-200" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-9 animate-pulse rounded-md bg-stone-100" />
              <div className="h-9 animate-pulse rounded-md bg-stone-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {inModal ? (
        <p className="text-sm text-stone-600">
          Publishing needs a duration, maximum guests, included kids and adults, a package price, and a room (or room
          assigned at booking).
        </p>
      ) : (
        <PartiesPageHeader
          title={productId ? packageQuery.data?.name ?? 'Party package' : 'New party package'}
          description="Publishing needs a duration, maximum guests, included kids and adults, a package price, and a room (or room assigned at booking)."
          actions={
            <Link href="/admin/parties/packages" className={btnSecondaryClass}>
              ← All packages
            </Link>
          }
        />
      )}
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <PartiesErrorBanner error={packageQuery.error} />
      {packageQuery.data?.archivedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>This package is archived. Restore it (as a draft) before editing.</span>
          {canPackages && productId ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={patchMutation.isPending}
              onClick={() =>
                patchMutation.mutate(
                  { id: productId, payload: { unarchive: true, published: false } },
                  {
                    onSuccess: () => addToast('Package restored as a draft', 'success'),
                    onError: (err: Error) => addToast(err.message || 'Restore failed', 'error'),
                  }
                )
              }
            >
              Restore
            </button>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6">
        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">Basics</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">Name *</span>
              <input disabled={readOnly} value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} />
              <FieldError message={errors.name} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">Venue *</span>
              <select
                disabled={readOnly || Boolean(productId) || Boolean(scopedLocationId)}
                value={form.locationId}
                onChange={(e) => setForm({ ...form, locationId: e.target.value, roomResourceId: '', addOnIds: [], defaultMenuItemIds: [] })}
                className={fieldClass}
              >
                <option value="">Select venue</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <FieldError message={errors.locationId} />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-stone-500">Description</span>
              <textarea
                disabled={readOnly}
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">Guests and length</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['durationMinutes', 'Duration (minutes) *'],
                ['minGuests', 'Minimum guests'],
                ['maxGuests', 'Maximum guests *'],
                ['includedKids', 'Included kids *'],
                ['includedAdults', 'Included adults *'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">{label}</span>
                <input
                  disabled={readOnly}
                  type="number"
                  min={0}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  className={fieldClass}
                />
                <FieldError message={errors[key]} />
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">Pricing and deposit</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['packagePrice', 'Package price *', 'packagePriceCents'],
                ['extraKidPrice', 'Extra kid price', 'extraKidPriceCents'],
                ['extraAdultPrice', 'Extra adult price', 'extraAdultPriceCents'],
                ['depositFixed', 'Deposit override (fixed)', 'depositFixedCentsOverride'],
              ] as const
            ).map(([key, label, errKey]) => (
              <label key={key} className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">{label}</span>
                <input
                  disabled={readOnly}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  className={fieldClass}
                />
                <FieldError message={errors[errKey]} />
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">Deposit override (%)</span>
              <input
                disabled={readOnly}
                inputMode="decimal"
                value={form.depositPercent}
                onChange={(e) => set('depositPercent', e.target.value)}
                className={fieldClass}
              />
              <FieldError message={errors.depositPercentOverride} />
            </label>
          </div>
          <p className="text-xs text-stone-500">
            Leave extra prices empty when this package does not sell extra kids or adults. Leave the deposit empty to use
            party settings.
            {packageQuery.data ? ` Deposit preview on the base price: ${formatCents(packageQuery.data.depositPreviewCents)}.` : ''}
          </p>
        </section>

        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">Room</h2>
          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              disabled={readOnly}
              type="checkbox"
              checked={form.roomAssignedAtBooking}
              onChange={(e) => set('roomAssignedAtBooking', e.target.checked)}
            />
            Room is assigned when the party is booked
          </label>
          {!form.roomAssignedAtBooking ? (
            <label className="block max-w-sm space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">Party room</span>
              <select
                disabled={readOnly || !locationId}
                value={form.roomResourceId}
                onChange={(e) => set('roomResourceId', e.target.value)}
                className={fieldClass}
              >
                <option value="">Select a party room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (cap {r.defaultCapacity})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <FieldError message={errors.roomResourceId} />
          {locationId && !rooms.length ? (
            <p className="text-xs text-stone-500">
              No party rooms at this venue yet. <Link href="/admin/parties/rooms" className="text-[#D4AF37] hover:underline">Add one</Link>.
            </p>
          ) : null}
        </section>

        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">Food</h2>
          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input disabled={readOnly} type="checkbox" checked={form.includesFood} onChange={(e) => set('includesFood', e.target.checked)} />
            Package includes food
          </label>
          {form.includesFood ? (
            <div className="flex flex-wrap gap-2">
              {menuItems.length ? (
                menuItems.map((m) => (
                  <label key={m.id} className="inline-flex items-center gap-2 rounded-md border border-stone-200 px-2 py-1 text-sm">
                    <input
                      disabled={readOnly}
                      type="checkbox"
                      checked={form.defaultMenuItemIds.includes(m.id)}
                      onChange={() => toggle('defaultMenuItemIds', m.id)}
                    />
                    {m.name}
                  </label>
                ))
              ) : (
                <p className="text-xs text-stone-500">No menu items at this venue yet.</p>
              )}
            </div>
          ) : null}
          <FieldError message={errors.defaultMenuItemIds} />
        </section>

        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">Add-ons</h2>
          <div className="flex flex-wrap gap-2">
            {addOns.length ? (
              addOns.map((a) => (
                <label key={a.id} className="inline-flex items-center gap-2 rounded-md border border-stone-200 px-2 py-1 text-sm">
                  <input disabled={readOnly} type="checkbox" checked={form.addOnIds.includes(a.id)} onChange={() => toggle('addOnIds', a.id)} />
                  {a.name}
                </label>
              ))
            ) : (
              <p className="text-xs text-stone-500">No add-on products at this venue yet.</p>
            )}
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">New add-on</span>
                <input value={newAddOnName} onChange={(e) => setNewAddOnName(e.target.value)} placeholder="e.g. Goody bags" className={fieldClass} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">Price</span>
                <input value={newAddOnPrice} onChange={(e) => setNewAddOnPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className={`${fieldClass} w-28`} />
              </label>
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={() => {
                  const cents = inputToCents(newAddOnPrice);
                  if (newAddOnName.trim().length < 2 || !cents || cents < 1) {
                    addToast('New add-ons need a name and a price above 0', 'error');
                    return;
                  }
                  setPendingNewAddOns((list) => [...list, { name: newAddOnName.trim(), priceCents: cents }]);
                  setNewAddOnName('');
                  setNewAddOnPrice('');
                }}
              >
                Add
              </button>
            </div>
          ) : null}
          {pendingNewAddOns.length ? (
            <p className="text-xs text-stone-600">
              Created on save: {pendingNewAddOns.map((a) => `${a.name} (${formatCents(a.priceCents)})`).join(', ')}
            </p>
          ) : null}
          <FieldError message={errors.addOns} />
        </section>

        <section
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4 ${
            inModal ? 'sticky bottom-0 z-10 shadow-[0_-10px_24px_-16px_rgba(28,25,23,0.45)]' : ''
          }`}
        >
          <label className="inline-flex items-center gap-2 text-sm font-medium text-stone-800">
            <input disabled={readOnly} type="checkbox" checked={form.published} onChange={(e) => set('published', e.target.checked)} />
            Published (bookable by staff and online)
          </label>
          {!readOnly ? (
            <button type="submit" disabled={saving || (!productId && !form.locationId)} className={btnPrimaryClass}>
              {saving ? <ButtonSpinner /> : null}
              {productId ? 'Save package' : 'Create package'}
            </button>
          ) : null}
        </section>
      </form>

      {productId && packageQuery.data ? (
        <PackageSessions productId={productId} canWrite={canSessions && !packageQuery.data.archivedAt} durationMinutes={packageQuery.data.config.durationMinutes} />
      ) : null}
    </div>
  );
}

function PackageSessions({
  productId,
  canWrite,
  durationMinutes,
}: {
  productId: string;
  canWrite: boolean;
  durationMinutes: number;
}) {
  const { addToast } = useToast();
  const sessionsQuery = usePartyPackageSessionsQuery(productId);
  const createMutation = useCreatePartyPackageSessionsMutation();
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [label, setLabel] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [untilDate, setUntilDate] = useState('');
  const sessions = sessionsQuery.data ?? [];

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!startsAt) {
      addToast('Pick a start time', 'error');
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        id: productId,
        payload: {
          startsAt: new Date(startsAt).toISOString(),
          capacity: Number(capacity) || 1,
          label: label.trim() || undefined,
          ...(weekdays.length ? { weekdays, untilDate } : {}),
        },
      });
      addToast(`${created.length} session${created.length === 1 ? '' : 's'} created`, 'success');
      setLabel('');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not create sessions', 'error');
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-800">Party time slots</h2>
      <p className="text-xs text-stone-500">
        Each slot lasts {durationMinutes} minutes. Capacity is how many parties can start in that slot.
      </p>
      {canWrite ? (
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">First start *</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={fieldClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">Parties per slot</span>
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={fieldClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Saturday morning" className={fieldClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">Repeat until</span>
            <input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className={fieldClass} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            <span className="text-xs font-semibold uppercase text-stone-500">Weekdays</span>
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="inline-flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={weekdays.includes(i)}
                  onChange={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}
                />
                {d}
              </label>
            ))}
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={createMutation.isPending || (weekdays.length > 0 && !untilDate)} className={btnPrimaryClass}>
              {createMutation.isPending ? <ButtonSpinner /> : null}
              {weekdays.length ? 'Create series' : 'Create slot'}
            </button>
          </div>
        </form>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Starts</th>
              <th className="px-3 py-2 font-semibold">Ends</th>
              <th className="px-3 py-2 font-semibold">Label</th>
              <th className="px-3 py-2 font-semibold">Booked / capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-stone-500">No time slots yet.</td>
              </tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{new Date(s.startsAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{new Date(s.endsAt).toLocaleTimeString()}</td>
                  <td className="px-3 py-2 text-stone-600">{s.label ?? '—'}</td>
                  <td className="px-3 py-2">
                    {s.capacity - s.remaining} / {s.capacity}
                    {s.isClosed ? <span className="ml-2 text-xs text-red-700">closed</span> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
