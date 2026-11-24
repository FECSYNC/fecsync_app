'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import {
  useTicketingProductsQuery,
  useCreateTicketingProductMutation,
  usePatchTicketingProductMutation,
  useCreateStockPeriodMutation,
  useDeleteStockPeriodMutation,
  useStockPeriodsQuery,
} from '@/hooks/useTicketing';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import { ClockDateTimeInput } from '@/components/common/ClockTimeFields';
import { formatClockDateTime } from '@/lib/timeClock';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TICKETING_ADD_ONS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import {
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  formatMoney,
} from './ticketingUi';

export default function TicketingAddOnsPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.TicketingAddOnsWrite) || can(P.TicketingWrite);
  const [guideOpen, setGuideOpen] = useState(false);

  const {
    scopedLocationId,
    parkLocked,
  } = useHqLocationFilter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createLocationId, setCreateLocationId] = useState('');
  const [amount, setAmount] = useState('');
  const [published, setPublished] = useState(false);

  const [stockProductId, setStockProductId] = useState('');
  const [stockLocationId, setStockLocationId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [kind, setKind] = useState<'available' | 'blocked'>('available');
  const [quantity, setQuantity] = useState('');

  const { hour12, timeFormat } = useTimeClockFormat(
    stockLocationId || createLocationId || scopedLocationId || null
  );

  // Prefetch-aligned keys (no locationId) → instant cache hit; filter client-side.
  const venueKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venueKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venueKey),
    placeholderData: (previous) => previous,
  });
  const addOnsQuery = useTicketingProductsQuery({
    type: 'add_on',
    includeArchived: false,
  });
  const stockQuery = useStockPeriodsQuery({});
  const createProduct = useCreateTicketingProductMutation();
  const patchProduct = usePatchTicketingProductMutation();
  const createStock = useCreateStockPeriodMutation();
  const deleteStock = useDeleteStockPeriodMutation();

  const venues = useMemo(
    () =>
      (venuesQuery.data ?? []).filter((v) => {
        if (v.status === 'archived') return false;
        if (scopedLocationId) return v.id === scopedLocationId;
        return true;
      }),
    [venuesQuery.data, scopedLocationId]
  );

  const addOns = useMemo(() => {
    const rows = addOnsQuery.data ?? [];
    if (!scopedLocationId) return rows;
    return rows.filter((a) => a.locationId === scopedLocationId);
  }, [addOnsQuery.data, scopedLocationId]);

  const stockPeriods = useMemo(() => {
    const rows = stockQuery.data ?? [];
    if (!scopedLocationId) return rows;
    return rows.filter((s) => s.locationId === scopedLocationId);
  }, [stockQuery.data, scopedLocationId]);

  useEffect(() => {
    if (scopedLocationId) {
      setCreateLocationId(scopedLocationId);
      setStockLocationId(scopedLocationId);
    } else if (!parkLocked) {
      setCreateLocationId('');
      setStockLocationId('');
    }
  }, [scopedLocationId, parkLocked]);

  const stockAddOnOptions = useMemo(() => {
    if (!stockLocationId) return addOns;
    return addOns.filter((a) => a.locationId === stockLocationId);
  }, [addOns, stockLocationId]);

  const onCreateAddOn = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    try {
      await createProduct.mutateAsync({
        type: 'add_on',
        name: name.trim(),
        description: description.trim() || null,
        locationId: createLocationId,
        prices: [{ code: 'standard', amount: Number(amount) }],
        published,
      });
      addToast('Add-on created', 'success');
      setName('');
      setDescription('');
      setAmount('');
      setPublished(false);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not create add-on',
        'error'
      );
    }
  };

  const onCreateStock = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    try {
      await createStock.mutateAsync({
        locationId: stockLocationId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        kind,
        quantity: quantity === '' ? null : Number(quantity),
        productIds: stockProductId ? [stockProductId] : [],
      });
      addToast('Stock period created', 'success');
      setStartsAt('');
      setEndsAt('');
      setQuantity('');
      setStockProductId('');
      setKind('available');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not create stock period',
        'error'
      );
    }
  };

  const togglePublish = async (id: string, next: boolean) => {
    if (!canWrite) return;
    try {
      await patchProduct.mutateAsync({ id, payload: { published: next } });
      addToast(next ? 'Add-on published' : 'Add-on unpublished', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not update publish state',
        'error'
      );
    }
  };

  const onDeleteStock = async (id: string) => {
    if (!canWrite) return;
    if (!window.confirm('Delete this stock period?')) return;
    try {
      await deleteStock.mutateAsync(id);
      addToast('Stock period deleted', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not delete stock period',
        'error'
      );
    }
  };

  const showInitialLoading =
    (addOnsQuery.isPending && !addOnsQuery.data) ||
    (stockQuery.isPending && !stockQuery.data);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/ticketing"
            className="text-sm text-stone-500 hover:text-[#D4AF37]"
          >
            ← Products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">Add-ons</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Upsell SKUs (socks, food, photos) with optional stock windows. Open
            the guide if you are doing this for the first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Add-ons"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TICKETING_ADD_ONS_GUIDE_STEPS}
      />

      {canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            onSubmit={onCreateAddOn}
            className="space-y-3 rounded-lg border border-stone-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-stone-800">
              Create add-on
            </h2>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className={fieldClass}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className={fieldClass}
            />
            <select
              required
              value={createLocationId}
              onChange={(e) => setCreateLocationId(e.target.value)}
              disabled={Boolean(scopedLocationId)}
              className={fieldClass}
            >
              <option value="">Venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0.01}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Price"
              className={fieldClass}
            />
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              Publish for online booking
            </label>
            <button
              type="submit"
              disabled={createProduct.isPending}
              className={btnPrimaryClass}
            >
              {createProduct.isPending ? <ButtonSpinner /> : null}
              Create add-on
            </button>
          </form>

          <form
            onSubmit={onCreateStock}
            className="space-y-3 rounded-lg border border-stone-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-stone-800">
              Create stock period
            </h2>
            <p className="text-xs text-stone-500">
              Attach an add-on so availability and remaining quantity gate
              bookings. Leave product empty only for venue-wide notes — attach
              SKUs for enforcement.
            </p>
            <select
              required
              value={stockLocationId}
              onChange={(e) => {
                setStockLocationId(e.target.value);
                setStockProductId('');
              }}
              disabled={Boolean(scopedLocationId)}
              className={fieldClass}
            >
              <option value="">Venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              value={stockProductId}
              onChange={(e) => setStockProductId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Add-on product (recommended)</option>
              {stockAddOnOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <ClockDateTimeInput
              required
              value={startsAt}
              onChange={setStartsAt}
              hour12={hour12}
              aria-label="Stock starts"
            />
            <ClockDateTimeInput
              required
              value={endsAt}
              onChange={setEndsAt}
              hour12={hour12}
              aria-label="Stock ends"
            />
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as 'available' | 'blocked')
              }
              className={fieldClass}
            >
              <option value="available">Available</option>
              <option value="blocked">Blocked</option>
            </select>
            <input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Remaining qty (optional)"
              className={fieldClass}
              disabled={kind === 'blocked'}
            />
            <button
              type="submit"
              disabled={createStock.isPending}
              className={btnPrimaryClass}
            >
              {createStock.isPending ? <ButtonSpinner /> : null}
              Create stock period
            </button>
          </form>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">
            Add-on catalog
          </h2>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Price</th>
              <th className="px-4 py-3 font-semibold">Venue</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Parent links</th>
              <th className="px-4 py-3 font-semibold">Stock</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {showInitialLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : addOns.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-stone-500">
                  No add-ons yet.
                </td>
              </tr>
            ) : (
              addOns.map((a) => {
                const periods = stockPeriods.filter((s) =>
                  s.productIds.includes(a.id)
                );
                let stockLabel = 'Unlimited';
                if (periods.length === 1) {
                  const p = periods[0];
                  const qtyBit =
                    p.quantity != null ? ` · qty ${p.quantity}` : '';
                  stockLabel = `${p.kind}${qtyBit}`;
                } else if (periods.length > 1) {
                  stockLabel = `${periods.length} periods`;
                }
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-900">{a.name}</div>
                      {a.description ? (
                        <div className="mt-0.5 line-clamp-1 text-xs text-stone-500">
                          {a.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{formatMoney(a.priceFrom)}</td>
                    <td className="px-4 py-3">{a.location?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.published
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-stone-100 text-stone-600'
                        }`}
                      >
                        {a.published ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{a.parentLinksCount}</td>
                    <td className="px-4 py-3 capitalize text-stone-700">
                      {stockLabel}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/ticketing/products/${a.id}`}
                          className="text-sm font-medium text-[#D4AF37] hover:underline"
                        >
                          Edit
                        </Link>
                        {canWrite ? (
                          <button
                            type="button"
                            className="text-sm text-stone-600 hover:text-stone-900"
                            disabled={patchProduct.isPending}
                            onClick={() =>
                              void togglePublish(a.id, !a.published)
                            }
                          >
                            {a.published ? 'Unpublish' : 'Publish'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">
            Stock periods
          </h2>
        </div>
        <ul className="divide-y divide-stone-100 text-sm">
          {stockPeriods.slice(0, 40).map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div>
                <span className="font-medium capitalize">{s.kind}</span>
                {' · '}
                {formatClockDateTime(s.startsAt, timeFormat)} →{' '}
                {formatClockDateTime(s.endsAt, timeFormat)}
                {s.quantity != null ? ` · remaining ${s.quantity}` : ''}
                {s.products?.length
                  ? ` · ${(s.products.filter(Boolean) as { name: string }[])
                      .map((p) => p.name)
                      .join(', ')}`
                  : ' · (no product attached)'}
              </div>
              {canWrite ? (
                <button
                  type="button"
                  className={btnSecondaryClass}
                  disabled={deleteStock.isPending}
                  onClick={() => void onDeleteStock(s.id)}
                >
                  Delete
                </button>
              ) : null}
            </li>
          ))}
          {!stockQuery.isLoading && stockPeriods.length === 0 ? (
            <li className="px-4 py-6 text-stone-500">No stock periods.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
