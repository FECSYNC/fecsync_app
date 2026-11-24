'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import {
  useTicketingProductQuery,
  usePatchTicketingProductMutation,
  useArchiveTicketingProductMutation,
  useReplaceProductPricesMutation,
  useLinkProductAddOnMutation,
  useUnlinkProductAddOnMutation,
  usePatchProductExpiryMutation,
  useTicketSessionsQuery,
  useTicketingProductsQuery,
  useStockPeriodsQuery,
  useCreateStockPeriodMutation,
  useCapacityResourcesQuery,
} from '@/hooks/useTicketing';
import { ClockDateTimeInput } from '@/components/common/ClockTimeFields';
import { formatClockDateTime, formatClockTime } from '@/lib/timeClock';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import {
  listBookingCategories,
  bookingCategoryKeys,
} from '@/services/bookingCategories';
import type { PriceBandInput, TicketSessionDto } from '@/services/ticketing';
import { uploadCatalogImages } from '@/services/upload';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import {
  PRODUCT_RESOURCE_POLICY,
  btnPrimaryClass,
  btnSecondaryClass,
  btnDangerClass,
  fieldClass,
  filterResourcesForProductType,
  formatProductType,
  groupResourcesByType,
} from './ticketingUi';

type Tab =
  | 'details'
  | 'prices'
  | 'sessions'
  | 'addons'
  | 'expiry'
  | 'stock'
  | 'danger';

const TABS: { id: Tab; label: string; timedOnly?: boolean; editOnly?: boolean }[] = [
  { id: 'details', label: 'Details' },
  { id: 'prices', label: 'Prices' },
  { id: 'sessions', label: 'Sessions', timedOnly: true },
  { id: 'addons', label: 'Add-ons' },
  { id: 'expiry', label: 'Pass expiry' },
  { id: 'stock', label: 'Stock periods' },
  { id: 'danger', label: 'Danger', editOnly: true },
];

type ProductPageMode = 'view' | 'edit';

type SessionSlotGroup = {
  key: string;
  label: string;
  sessions: TicketSessionDto[];
};

function groupSessionsBySlot(sessions: TicketSessionDto[]): SessionSlotGroup[] {
  const order: string[] = [];
  const map = new Map<string, TicketSessionDto[]>();
  for (const session of sessions) {
    const label = session.label?.trim() || '';
    const key = label || '__unnamed__';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(session);
  }
  return order
    .map((key) => {
      const rows = map.get(key) ?? [];
      rows.sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
      return {
        key,
        label: key === '__unnamed__' ? 'Unnamed slot' : key,
        sessions: rows,
      };
    })
    .sort((a, b) => {
      const aAt = a.sessions[0]
        ? new Date(a.sessions[0].startsAt).getTime()
        : Number.POSITIVE_INFINITY;
      const bAt = b.sessions[0]
        ? new Date(b.sessions[0].startsAt).getTime()
        : Number.POSITIVE_INFINITY;
      return aAt - bAt;
    });
}

export default function TicketingProductEditPage({
  mode = 'edit',
}: {
  mode?: ProductPageMode;
}) {
  const params = useParams();
  const productId = String(params?.productId ?? '');
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.TicketingProductsWrite) || can(P.TicketingWrite);
  const isViewMode = mode === 'view';

  const productQuery = useTicketingProductQuery(productId);
  const product = productQuery.data;
  const router = useRouter();
  // Party packages have one editor (PartyPackageConfig rules live there).
  const isPartyPackage = product?.type === 'party_package';
  useEffect(() => {
    if (isPartyPackage) router.replace(`/admin/parties/packages/${productId}`);
  }, [isPartyPackage, productId, router]);
  const { hour12, timeFormat } = useTimeClockFormat(product?.locationId ?? null);
  const showSessions =
    product?.type === 'timed_session' ||
    product?.type === 'group' ||
    product?.type === 'camp_event' ||
    product?.type === 'party_package';

  const resourcePolicy = product
    ? PRODUCT_RESOURCE_POLICY[product.type]
    : PRODUCT_RESOURCE_POLICY.timed_session;
  const showResourceField =
    resourcePolicy.mode !== 'hidden' || Boolean(product?.resourceId);

  const [tab, setTab] = useState<Tab>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [pasteUrl, setPasteUrl] = useState('');
  const [uploadingImages, setUploadingImages] = useState(false);
  const [resourceId, setResourceId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [minGuests, setMinGuests] = useState('');
  const [maxGuests, setMaxGuests] = useState('');
  const [waiverRequired, setWaiverRequired] = useState(false);
  const [taxExemptDefault, setTaxExemptDefault] = useState(false);
  const [published, setPublished] = useState(false);
  const [priceRows, setPriceRows] = useState<
    { code: string; amount: string; minAge: string; maxAge: string }[]
  >([]);
  const [expiryDays, setExpiryDays] = useState('');
  const [addOnProductId, setAddOnProductId] = useState('');
  const [addOnRequired, setAddOnRequired] = useState(false);
  const [addOnMaxQty, setAddOnMaxQty] = useState('');
  const [addOnStockPeriodId, setAddOnStockPeriodId] = useState('');
  const [stockForm, setStockForm] = useState({
    startsAt: '',
    endsAt: '',
    kind: 'available' as 'available' | 'blocked',
    quantity: '',
  });
  /** Collapsed-by-default slot groups on the Sessions tab. */
  const [openSessionSlots, setOpenSessionSlots] = useState<Set<string>>(
    () => new Set()
  );

  const patchMutation = usePatchTicketingProductMutation();
  const archiveMutation = useArchiveTicketingProductMutation();
  const pricesMutation = useReplaceProductPricesMutation();
  const linkAddOnMutation = useLinkProductAddOnMutation();
  const unlinkAddOnMutation = useUnlinkProductAddOnMutation();
  const expiryMutation = usePatchProductExpiryMutation();
  const stockMutation = useCreateStockPeriodMutation();

  const sessionsQuery = useTicketSessionsQuery(
    { productId, includeClosed: true },
    Boolean(productId) && showSessions && tab === 'sessions'
  );
  const sessionSlotGroups = useMemo(
    () => groupSessionsBySlot(sessionsQuery.data ?? []),
    [sessionsQuery.data]
  );

  useEffect(() => {
    // Drop open keys that no longer exist after refetch.
    setOpenSessionSlots((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(sessionSlotGroups.map((g) => g.key));
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        if (valid.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sessionSlotGroups]);

  function toggleSessionSlot(key: string) {
    setOpenSessionSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const addOnsCatalog = useTicketingProductsQuery(
    { type: 'add_on', locationId: product?.locationId },
    Boolean(product?.locationId) && tab === 'addons'
  );
  const stockQuery = useStockPeriodsQuery(
    { productId },
    Boolean(productId) && tab === 'stock'
  );
  const addOnStockQuery = useStockPeriodsQuery(
    { locationId: product?.locationId },
    Boolean(product?.locationId) && tab === 'addons'
  );
  const resourcesQuery = useCapacityResourcesQuery(
    { locationId: product?.locationId },
    Boolean(product?.locationId)
  );

  const locationResources = useMemo(
    () =>
      (resourcesQuery.data ?? []).filter(
        (r) => !r.archivedAt && r.locationId === product?.locationId
      ),
    [resourcesQuery.data, product?.locationId]
  );

  const resourceOptions = useMemo(() => {
    const productType = product?.type ?? 'timed_session';
    const base = filterResourcesForProductType(locationResources, productType);
    // Keep the currently assigned resource visible even if archived / filtered out.
    const currentId = product?.resourceId;
    if (
      currentId &&
      !base.some((r) => r.id === currentId) &&
      product?.resource
    ) {
      return [
        {
          id: product.resource.id,
          name: `${product.resource.name} (current)`,
          type: 'other' as const,
          defaultCapacity: product.resource.defaultCapacity,
          locationId: product.locationId,
          orgId: product.orgId,
          archivedAt: null as string | null,
          createdAt: '',
          updatedAt: '',
          location: null,
        },
        ...base,
      ];
    }
    return base;
  }, [locationResources, product]);

  const resourceGroups = useMemo(
    () => groupResourcesByType(resourceOptions),
    [resourceOptions]
  );

  const categoriesQuery = useQuery({
    queryKey: bookingCategoryKeys.list(false),
    queryFn: () => listBookingCategories({ includeArchived: false }),
    ...adminListQueryDefaults,
  });
  const categories = categoriesQuery.data ?? [];
  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    // Keep current assignment visible if list omitted it (e.g. race after rename).
    if (product?.categoryId && product.category?.name) {
      map.set(product.categoryId, product.category.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [categories, product?.categoryId, product?.category?.name]);

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setDescription(product.description ?? '');
    setImages(product.images ?? []);
    setPasteUrl('');
    setResourceId(product.resourceId ?? '');
    setCategoryId(product.categoryId ?? '');
    setMinGuests(product.minGuests == null ? '' : String(product.minGuests));
    setMaxGuests(product.maxGuests == null ? '' : String(product.maxGuests));
    setWaiverRequired(product.waiverRequired);
    setTaxExemptDefault(product.taxExemptDefault);
    setPublished(product.published);
    setExpiryDays(
      product.defaultPassExpiryDays == null
        ? ''
        : String(product.defaultPassExpiryDays)
    );
    setPriceRows(
      (product.prices ?? []).map((p) => ({
        code: p.code,
        amount: String(p.amount),
        minAge: p.minAge == null ? '' : String(p.minAge),
        maxAge: p.maxAge == null ? '' : String(p.maxAge),
      }))
    );
  }, [product]);

  useEffect(() => {
    if (!isViewMode) return;
    setTab((current) => (current === 'danger' ? 'details' : current));
  }, [isViewMode]);

  if (productQuery.isLoading) {
    return (
      <p className="py-10 text-sm text-stone-500">Loading product…</p>
    );
  }
  if (isPartyPackage) {
    return (
      <p className="py-10 text-sm text-stone-500">
        Opening the party package editor…{' '}
        <Link href={`/admin/parties/packages/${productId}`} className="text-[#D4AF37]">
          Open now
        </Link>
      </p>
    );
  }
  if (productQuery.isError || !product) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">
          {(productQuery.error as Error)?.message || 'Product not found'}
        </p>
        <Link href="/admin/ticketing" className="text-sm text-[#D4AF37]">
          Back to products
        </Link>
      </div>
    );
  }

  const visibleTabs = TABS.filter(
    (t) =>
      (!t.timedOnly || showSessions) &&
      (!t.editOnly || !isViewMode)
  );
  /** View mode is always read-only; archived products stay read-only except Danger → Restore. */
  const writeLocked = isViewMode || !canWrite || Boolean(product.archivedAt);
  const detailsLocked = writeLocked;

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (detailsLocked) return;
    if (isPartyPackage && !resourceId) {
      addToast(
        'Party packages require a room / party_room capacity resource',
        'error'
      );
      return;
    }
    if (isPartyPackage && published && !resourceId) {
      addToast('Cannot publish a party package without a room resource', 'error');
      return;
    }
    try {
      await patchMutation.mutateAsync({
        id: product.id,
        payload: {
          name: name.trim(),
          description: description.trim() || null,
          images,
          resourceId: resourceId || null,
          categoryId: categoryId || null,
          minGuests: minGuests === '' ? null : Number(minGuests),
          maxGuests: maxGuests === '' ? null : Number(maxGuests),
          waiverRequired,
          taxExemptDefault,
          published,
        },
      });
      addToast('Details saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const savePrices = async (e: FormEvent) => {
    e.preventDefault();
    if (detailsLocked) return;
    const prices: PriceBandInput[] = priceRows
      .filter((p) => p.code.trim() && p.amount.trim())
      .map((p) => ({
        code: p.code.trim(),
        amount: Number(p.amount),
        minAge: p.minAge === '' ? null : Number(p.minAge),
        maxAge: p.maxAge === '' ? null : Number(p.maxAge),
      }));
    try {
      await pricesMutation.mutateAsync({ productId: product.id, prices });
      addToast('Prices saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/ticketing"
            className="text-sm text-stone-500 hover:text-[#D4AF37]"
          >
            ← Products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">
            {product.name}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {isViewMode ? 'View · ' : 'Edit · '}
            {formatProductType(product.type)}
            {product.location?.name ? ` · ${product.location.name}` : ''}
            {product.archivedAt ? ' · Archived' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isViewMode && canWrite ? (
            <Link
              href={`/admin/ticketing/products/${product.id}/edit`}
              className={btnPrimaryClass}
            >
              Edit
            </Link>
          ) : null}
          {!isViewMode ? (
            <Link
              href={`/admin/ticketing/products/${product.id}`}
              className={btnSecondaryClass}
            >
              View details
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-2">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.id
                ? 'bg-[#D4AF37]/15 text-stone-900'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isViewMode && writeLocked && !product.archivedAt && !canWrite ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          You can view this product. Editing requires Ticketing write access.
        </p>
      ) : null}
      {isViewMode && product.archivedAt ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This product is archived. Open Edit to restore it.
        </p>
      ) : null}

      {tab === 'details' ? (
        <form
          onSubmit={saveDetails}
          className="max-w-2xl space-y-4 rounded-lg border border-stone-200 bg-white p-5"
        >
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
              disabled={detailsLocked}
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Category
            </span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={fieldClass}
              disabled={detailsLocked}
            >
              <option value="">
                {categoryOptions.length
                  ? 'Uncategorized'
                  : 'No categories available'}
              </option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {product.archivedAt ? (
              <p className="text-xs text-stone-500">
                Archived products are read-only. Restore first to edit details or
                category (archive cleared any prior category).
              </p>
            ) : !categoriesQuery.isLoading && categoryOptions.length === 0 ? (
              <p className="text-xs text-stone-500">
                No categories available.{' '}
                <Link
                  href="/admin/ticketing/categories"
                  className="text-[#D4AF37]"
                >
                  Create booking categories
                </Link>{' '}
                first.
              </p>
            ) : (
              <p className="text-xs text-stone-500">
                Optional folder from Online Booking → Booking category.
              </p>
            )}
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Description
            </span>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={fieldClass}
              disabled={detailsLocked}
            />
          </label>
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Images
            </span>
            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {images.map((url) => (
                  <div
                    key={url}
                    className="relative h-20 w-20 overflow-hidden rounded-md border border-stone-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {!detailsLocked ? (
                      <button
                        type="button"
                        className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] text-white"
                        onClick={() =>
                          setImages((prev) => prev.filter((u) => u !== url))
                        }
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-500">No images yet.</p>
            )}
            {!detailsLocked ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploadingImages}
                  className={fieldClass}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (!files.length) return;
                    setUploadingImages(true);
                    try {
                      const urls = await uploadCatalogImages(files, 'products');
                      setImages((prev) => [...prev, ...urls]);
                      addToast(
                        urls.length === 1
                          ? 'Image uploaded'
                          : `${urls.length} images uploaded`,
                        'success'
                      );
                    } catch (err) {
                      addToast(
                        err instanceof Error
                          ? err.message
                          : 'Could not upload images',
                        'error'
                      );
                    } finally {
                      setUploadingImages(false);
                    }
                  }}
                />
                {uploadingImages ? (
                  <p className="text-xs text-stone-500">Uploading…</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={pasteUrl}
                    onChange={(e) => setPasteUrl(e.target.value)}
                    className={`${fieldClass} flex-1`}
                    placeholder="Or paste image URL"
                  />
                  <button
                    type="button"
                    className={btnSecondaryClass}
                    onClick={() => {
                      const url = pasteUrl.trim();
                      if (!url) return;
                      setImages((prev) =>
                        prev.includes(url) ? prev : [...prev, url]
                      );
                      setPasteUrl('');
                    }}
                  >
                    Add URL
                  </button>
                </div>
              </>
            ) : null}
          </div>
          {showResourceField ? (
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              {resourcePolicy.fieldLabel}
              {isPartyPackage ? ' *' : ''}
            </span>
            <select
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className={fieldClass}
              disabled={detailsLocked}
              required={isPartyPackage}
            >
              <option value="">{resourcePolicy.placeholder}</option>
              {resourceGroups.map((group) => (
                <optgroup key={group.type} label={group.label}>
                  {group.items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · cap {r.defaultCapacity}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-stone-500">{resourcePolicy.venueHint}</p>
            {isPartyPackage && resourceOptions.length === 0 ? (
              <p className="text-xs text-amber-800">
                No Room or Party room at this venue.{' '}
                <Link
                  href={`/admin/ticketing/resources?type=party_room&locationId=${encodeURIComponent(product.locationId)}`}
                  className="font-medium text-[#D4AF37]"
                >
                  Create a party room
                </Link>
                {locationResources.length > 0
                  ? ' — other resource types are hidden for party packages.'
                  : ''}
              </p>
            ) : null}
          </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="number"
              placeholder="Min guests"
              value={minGuests}
              onChange={(e) => setMinGuests(e.target.value)}
              className={fieldClass}
              disabled={detailsLocked}
            />
            <input
              type="number"
              placeholder="Max guests"
              value={maxGuests}
              onChange={(e) => setMaxGuests(e.target.value)}
              className={fieldClass}
              disabled={detailsLocked}
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label
              className="inline-flex items-center gap-2"
              title="Saved on this product. A booking confirmation can include a signing link when this ticket requires a waiver and a published template exists. The desk reports it missing until a requirement is set. Check-in does not block on it yet."
            >
              <input
                type="checkbox"
                checked={waiverRequired}
                onChange={(e) => setWaiverRequired(e.target.checked)}
                disabled={detailsLocked}
              />
              Waiver required
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={taxExemptDefault}
                onChange={(e) => setTaxExemptDefault(e.target.checked)}
                disabled={detailsLocked}
              />
              Tax exempt default
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                disabled={detailsLocked}
              />
              Published
            </label>
          </div>
          {!detailsLocked ? (
            <button
              type="submit"
              disabled={patchMutation.isPending}
              className={btnPrimaryClass}
            >
              {patchMutation.isPending ? <ButtonSpinner /> : null}
              Save details
            </button>
          ) : null}
        </form>
      ) : null}

      {tab === 'prices' ? (
        <form
          onSubmit={savePrices}
          className="max-w-3xl space-y-3 rounded-lg border border-stone-200 bg-white p-5"
        >
          {priceRows.map((row, idx) => (
            <div
              key={idx}
              className="space-y-2 rounded-md border border-stone-200 bg-stone-50/50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Band {idx + 1}
                </span>
                {!writeLocked ? (
                  <button
                    type="button"
                    className={btnDangerClass}
                    disabled={priceRows.length <= 1}
                    onClick={() => {
                      if (priceRows.length <= 1) {
                        addToast('At least one price band is required', 'error');
                        return;
                      }
                      setPriceRows((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
              <input
                value={row.code}
                disabled={writeLocked}
                onChange={(e) => {
                  const next = [...priceRows];
                  next[idx] = { ...row, code: e.target.value };
                  setPriceRows(next);
                }}
                className={fieldClass}
                placeholder="Code"
              />
              <input
                type="number"
                step="0.01"
                value={row.amount}
                disabled={writeLocked}
                onChange={(e) => {
                  const next = [...priceRows];
                  next[idx] = { ...row, amount: e.target.value };
                  setPriceRows(next);
                }}
                className={fieldClass}
                placeholder="Amount"
              />
              <input
                type="number"
                value={row.minAge}
                disabled={writeLocked}
                onChange={(e) => {
                  const next = [...priceRows];
                  next[idx] = { ...row, minAge: e.target.value };
                  setPriceRows(next);
                }}
                className={fieldClass}
                placeholder="Min age"
              />
              <input
                type="number"
                value={row.maxAge}
                disabled={writeLocked}
                onChange={(e) => {
                  const next = [...priceRows];
                  next[idx] = { ...row, maxAge: e.target.value };
                  setPriceRows(next);
                }}
                className={fieldClass}
                placeholder="Max age"
              />
              </div>
            </div>
          ))}
          {!writeLocked ? (
            <div className="flex gap-2">
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={() =>
                  setPriceRows((p) => [
                    ...p,
                    { code: '', amount: '', minAge: '', maxAge: '' },
                  ])
                }
              >
                Add band
              </button>
              <button
                type="submit"
                disabled={pricesMutation.isPending}
                className={btnPrimaryClass}
              >
                {pricesMutation.isPending ? <ButtonSpinner /> : null}
                Save prices
              </button>
            </div>
          ) : product.archivedAt ? (
            <p className="text-xs text-stone-500">
              Restore the product to edit prices.
            </p>
          ) : null}
        </form>
      ) : null}

      {tab === 'sessions' ? (
        <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-800">Sessions</h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Named slots are listed below. Expand a slot to see every
                bookable date/time under it.
              </p>
            </div>
            <AdminPendingLink
              href={`/admin/ticketing/sessions?productId=${product.id}`}
              pendingLabel="Opening…"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#D4AF37] hover:underline"
            >
              Manage on Sessions page
            </AdminPendingLink>
          </div>
          {sessionsQuery.isLoading && sessionSlotGroups.length === 0 ? (
            <p className="text-sm text-stone-500">Loading…</p>
          ) : sessionSlotGroups.length === 0 ? (
            <p className="text-sm text-stone-500">No sessions yet.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-stone-500">
                {sessionSlotGroups.length} slot
                {sessionSlotGroups.length === 1 ? '' : 's'} ·{' '}
                {(sessionsQuery.data ?? []).length.toLocaleString()} timeslot
                {(sessionsQuery.data ?? []).length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-2">
                {sessionSlotGroups.map((group) => {
                  const open = openSessionSlots.has(group.key);
                  return (
                    <li
                      key={group.key}
                      className="overflow-hidden rounded-md border border-stone-200"
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleSessionSlot(group.key)}
                        className="flex w-full items-center justify-between gap-3 bg-stone-50 px-3 py-2.5 text-left hover:bg-stone-100"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-stone-900">
                            {group.label}
                          </span>
                          <span className="text-xs text-stone-500">
                            {group.sessions.length.toLocaleString()} session
                            {group.sessions.length === 1 ? '' : 's'}
                            {group.sessions[0]
                              ? ` · ${formatClockTime(group.sessions[0].startsAt, timeFormat)}–${formatClockTime(group.sessions[0].endsAt, timeFormat)}`
                              : ''}
                          </span>
                        </span>
                        <svg
                          className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${
                            open ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>
                      {open ? (
                        <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto bg-white text-sm">
                          {group.sessions.map((s) => (
                            <li
                              key={s.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                            >
                              <span className="text-stone-800">
                                {formatClockDateTime(s.startsAt, timeFormat)} →{' '}
                                {formatClockTime(s.endsAt, timeFormat)}
                              </span>
                              <span className="text-xs text-stone-500">
                                {s.remaining}/{s.capacity}
                                {s.isClosed ? ' · closed' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'addons' ? (
        <div className="max-w-xl space-y-4 rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-800">
            Linked add-ons
          </h2>
          <p className="text-xs text-stone-500">
            Only linked add-ons appear in staff and online booking. Required /
            max qty are enforced at checkout.
          </p>
          {(product.addOnLinks ?? []).length === 0 ? (
            <p className="text-sm text-stone-500">No add-ons linked.</p>
          ) : (
            <ul className="space-y-2 text-sm text-stone-700">
              {(product.addOnLinks ?? []).map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-100 px-3 py-2"
                >
                  <div>
                    <span className="font-medium">
                      {l.addOnProduct?.name ?? l.addOnProductId}
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {l.required ? 'Required' : 'Optional'}
                      {l.maxQty != null ? ` · max ${l.maxQty}` : ''}
                      {l.stockPeriodId ? ' · stock period linked' : ''}
                    </span>
                  </div>
                  {!writeLocked ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-red-700 hover:underline"
                      disabled={unlinkAddOnMutation.isPending}
                      onClick={() =>
                        unlinkAddOnMutation.mutate(
                          {
                            productId: product.id,
                            addOnProductId: l.addOnProductId,
                          },
                          {
                            onSuccess: () => {
                              addToast('Add-on unlinked', 'success');
                              void productQuery.refetch();
                            },
                            onError: (err: Error) =>
                              addToast(err.message || 'Unlink failed', 'error'),
                          }
                        )
                      }
                    >
                      Unlink
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {!writeLocked ? (
            <form
              className="space-y-3 border-t border-stone-100 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!addOnProductId) return;
                linkAddOnMutation.mutate(
                  {
                    productId: product.id,
                    payload: {
                      addOnProductId,
                      required: addOnRequired,
                      maxQty:
                        addOnMaxQty === '' ? null : Number(addOnMaxQty),
                      stockPeriodId: addOnStockPeriodId || null,
                    },
                  },
                  {
                    onSuccess: () => {
                      addToast('Add-on linked', 'success');
                      setAddOnProductId('');
                      setAddOnRequired(false);
                      setAddOnMaxQty('');
                      setAddOnStockPeriodId('');
                      void productQuery.refetch();
                    },
                    onError: (err: Error) =>
                      addToast(err.message || 'Link failed', 'error'),
                  }
                );
              }}
            >
              <select
                value={addOnProductId}
                onChange={(e) => setAddOnProductId(e.target.value)}
                className={fieldClass}
                required
              >
                <option value="">Select add-on</option>
                {(addOnsCatalog.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={addOnRequired}
                  onChange={(e) => setAddOnRequired(e.target.checked)}
                />
                Required on bookings
              </label>
              <input
                type="number"
                min={1}
                value={addOnMaxQty}
                onChange={(e) => setAddOnMaxQty(e.target.value)}
                placeholder="Max qty (optional)"
                className={fieldClass}
              />
              <select
                value={addOnStockPeriodId}
                onChange={(e) => setAddOnStockPeriodId(e.target.value)}
                className={fieldClass}
              >
                <option value="">Stock period override (optional)</option>
                {(addOnStockQuery.data ?? [])
                  .filter(
                    (s) =>
                      !s.productIds.length ||
                      s.productIds.includes(addOnProductId) ||
                      !addOnProductId
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.kind} · {new Date(s.startsAt).toLocaleDateString()} →{' '}
                      {new Date(s.endsAt).toLocaleDateString()}
                      {s.quantity != null ? ` · qty ${s.quantity}` : ''}
                    </option>
                  ))}
              </select>
              <button type="submit" className={btnPrimaryClass}>
                Link add-on
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === 'expiry' ? (
        <form
          className="max-w-md space-y-3 rounded-lg border border-stone-200 bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (writeLocked) return;
            expiryMutation.mutate(
              {
                productId: product.id,
                defaultPassExpiryDays:
                  expiryDays === '' ? null : Number(expiryDays),
              },
              {
                onSuccess: () => addToast('Pass expiry saved', 'success'),
                onError: (err: Error) =>
                  addToast(err.message || 'Save failed', 'error'),
              }
            );
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Default pass expiry (days)
            </span>
            <input
              type="number"
              min={0}
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              className={fieldClass}
              disabled={writeLocked}
            />
          </label>
          {!writeLocked ? (
            <button type="submit" className={btnPrimaryClass}>
              Save expiry
            </button>
          ) : null}
        </form>
      ) : null}

      {tab === 'stock' ? (
        <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-800">
            Stock periods for this product
          </h2>
          {(stockQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-stone-500">No stock periods.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {(stockQuery.data ?? []).map((s) => (
                <li key={s.id} className="py-2">
                  {s.kind} · {formatClockDateTime(s.startsAt, timeFormat)} →{' '}
                  {formatClockDateTime(s.endsAt, timeFormat)}
                  {s.quantity != null ? ` · qty ${s.quantity}` : ''}
                </li>
              ))}
            </ul>
          )}
          {!writeLocked ? (
            <form
              className="grid max-w-xl gap-2 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                stockMutation.mutate(
                  {
                    locationId: product.locationId,
                    startsAt: new Date(stockForm.startsAt).toISOString(),
                    endsAt: new Date(stockForm.endsAt).toISOString(),
                    kind: stockForm.kind,
                    quantity:
                      stockForm.quantity === ''
                        ? null
                        : Number(stockForm.quantity),
                    productIds: [product.id],
                  },
                  {
                    onSuccess: () => {
                      addToast('Stock period created', 'success');
                      void stockQuery.refetch();
                    },
                    onError: (err: Error) =>
                      addToast(err.message || 'Create failed', 'error'),
                  }
                );
              }}
            >
              <ClockDateTimeInput
                required
                value={stockForm.startsAt}
                onChange={(startsAt) =>
                  setStockForm((f) => ({ ...f, startsAt }))
                }
                hour12={hour12}
                aria-label="Stock starts"
              />
              <ClockDateTimeInput
                required
                value={stockForm.endsAt}
                onChange={(endsAt) => setStockForm((f) => ({ ...f, endsAt }))}
                hour12={hour12}
                aria-label="Stock ends"
              />
              <select
                value={stockForm.kind}
                onChange={(e) =>
                  setStockForm((f) => ({
                    ...f,
                    kind: e.target.value as 'available' | 'blocked',
                  }))
                }
                className={fieldClass}
              >
                <option value="available">Available</option>
                <option value="blocked">Blocked</option>
              </select>
              <input
                type="number"
                min={0}
                placeholder="Quantity (optional)"
                value={stockForm.quantity}
                onChange={(e) =>
                  setStockForm((f) => ({ ...f, quantity: e.target.value }))
                }
                className={fieldClass}
              />
              <button type="submit" className={btnPrimaryClass}>
                Create stock period
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === 'danger' ? (
        <div className="max-w-md space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-5">
          <h2 className="text-sm font-semibold text-red-900">Archive product</h2>
          <p className="text-sm text-stone-600">
            Soft-archive only. Existing booking line snapshots stay intact.
            Category assignment is cleared so Catalog categories can still be
            deleted when nothing else uses them.
          </p>
          {canWrite && !product.archivedAt ? (
            <button
              type="button"
              className={btnDangerClass}
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (!window.confirm(`Archive “${product.name}”?`)) return;
                archiveMutation.mutate(product.id, {
                  onSuccess: () => addToast('Product archived', 'success'),
                  onError: (err: Error) =>
                    addToast(err.message || 'Archive failed', 'error'),
                });
              }}
            >
              Archive product
            </button>
          ) : product.archivedAt && canWrite ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={patchMutation.isPending}
              onClick={() => {
                patchMutation.mutate(
                  { id: product.id, payload: { unarchive: true } },
                  {
                    onSuccess: () => {
                      addToast(
                        'Product restored — reassign a category if needed',
                        'success'
                      );
                      void productQuery.refetch();
                    },
                    onError: (err: Error) =>
                      addToast(err.message || 'Restore failed', 'error'),
                  }
                );
              }}
            >
              Unarchive product
            </button>
          ) : product.archivedAt ? (
            <p className="text-sm text-stone-600">Already archived.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
