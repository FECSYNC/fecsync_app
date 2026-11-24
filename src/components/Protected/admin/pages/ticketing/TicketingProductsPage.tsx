'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import {
  listBookingCategories,
  bookingCategoryKeys,
} from '@/services/bookingCategories';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import {
  listParkMarketplaceAccounts,
  marketplaceKeys,
} from '@/services/marketplace';
import { isStorefrontOrgSession } from '@/services/auth';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import {
  ticketingKeys,
  type AdmissionProductDto,
  type AdmissionProductType,
} from '@/services/ticketing';
import {
  useTicketingProductsQuery,
  useArchiveTicketingProductMutation,
  usePatchTicketingProductMutation,
} from '@/hooks/useTicketing';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  PRODUCT_TYPE_OPTIONS,
  btnPrimaryClass,
  fieldClass,
  formatMoney,
  formatProductType,
} from './ticketingUi';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TICKETING_PRODUCTS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import CreateTicketProductModal from './CreateTicketProductModal';

type ActionsMenuPos = { top: number; left: number };

const ACTIONS_MENU_WIDTH = 188;

function productHasSessions(type: AdmissionProductType) {
  return (
    type === 'timed_session' ||
    type === 'group' ||
    type === 'party_package' ||
    type === 'camp_event'
  );
}

export default function TicketingProductsPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canWrite = can(P.TicketingProductsWrite) || can(P.TicketingWrite);
  const canReadPayouts = can(P.PayoutsRead);
  const storefront = isStorefrontOrgSession(user);

  const [type, setType] = useState<AdmissionProductType | 'all'>('all');
  const [published, setPublished] = useState<'all' | 'true' | 'false'>('all');
  const [categoryId, setCategoryId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null);
  const [actionsMenuPos, setActionsMenuPos] = useState<ActionsMenuPos | null>(
    null
  );
  const actionsTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const fromUrl = searchParams.get('categoryId');
    if (fromUrl) setCategoryId(fromUrl);
  }, [searchParams]);
  const {
    locationId,
    setLocationId,
    scopedLocationId,
    parkLocked,
  } = useHqLocationFilter();

  const filters = useMemo(
    () => ({
      type,
      published:
        published === 'all' ? ('all' as const) : published === 'true',
      ...(locationId ? { locationId } : {}),
      ...(categoryId ? { categoryId } : {}),
      includeArchived,
    }),
    [type, published, locationId, categoryId, includeArchived]
  );

  const venuesKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
    placeholderData: (previous) => previous,
  });
  const categoriesQuery = useQuery({
    queryKey: bookingCategoryKeys.list(false),
    queryFn: () => listBookingCategories({ includeArchived: false }),
    ...adminListQueryDefaults,
  });
  const categories = categoriesQuery.data ?? [];

  const productsQuery = useTicketingProductsQuery(filters);
  const archiveMutation = useArchiveTicketingProductMutation();
  const patchMutation = usePatchTicketingProductMutation();

  const parkAccountsQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: canReadPayouts && !storefront,
    staleTime: 60_000,
  });

  const products = productsQuery.data ?? [];
  const busy = archiveMutation.isPending || patchMutation.isPending;
  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });

  const parkPayoutGap = useMemo(() => {
    const parks = parkAccountsQuery.data ?? [];
    if (!parks.length) return null;
    const publishedLocIds = new Set(
      products
        .filter((p) => p.published && !p.archivedAt && p.locationId)
        .map((p) => p.locationId)
    );
    const blocked = parks.find(
      (p) =>
        p.isFranchise &&
        !p.chargeReady &&
        publishedLocIds.has(p.locationId)
    );
    return blocked
      ? { locationId: blocked.locationId, locationName: blocked.locationName }
      : null;
  }, [parkAccountsQuery.data, products]);

  const parkChargeReadyById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of parkAccountsQuery.data ?? []) {
      map.set(p.locationId, Boolean(p.chargeReady));
    }
    return map;
  }, [parkAccountsQuery.data]);

  const franchiseLocationIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of parkAccountsQuery.data ?? []) {
      if (p.isFranchise) set.add(p.locationId);
    }
    for (const v of venuesQuery.data ?? []) {
      if (v.isFranchise) set.add(v.id);
    }
    return set;
  }, [parkAccountsQuery.data, venuesQuery.data]);

  const actionsProduct =
    products.find((p) => p.id === actionsMenuId) ?? null;

  useLayoutEffect(() => {
    if (!actionsMenuId) {
      setActionsMenuPos(null);
      return;
    }

    const syncPosition = () => {
      const trigger = actionsTriggerRefs.current.get(actionsMenuId);
      if (!trigger) {
        setActionsMenuPos(null);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const menuEl = document.querySelector(
        '[data-product-actions-menu]'
      ) as HTMLElement | null;
      const menuHeight = menuEl?.offsetHeight || 0;
      const menuWidth = menuEl?.offsetWidth || ACTIONS_MENU_WIDTH;
      const gap = 4;

      let top = rect.bottom + gap;
      if (
        menuHeight > 0 &&
        top + menuHeight > window.innerHeight - 8 &&
        rect.top - menuHeight - gap >= 8
      ) {
        top = rect.top - menuHeight - gap;
      }

      let left = rect.right - menuWidth;
      left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

      setActionsMenuPos((prev) => {
        if (prev && prev.top === top && prev.left === left) return prev;
        return { top, left };
      });
    };

    syncPosition();
    const raf = window.requestAnimationFrame(() => syncPosition());

    const onScrollOrResize = () => syncPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [actionsMenuId]);

  useEffect(() => {
    if (!actionsMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-product-actions-menu]')) return;
      if (target.closest(`[data-product-actions="${actionsMenuId}"]`)) return;
      setActionsMenuId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsMenuId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionsMenuId]);

  function closeActions() {
    setActionsMenuId(null);
  }

  function togglePublish(p: AdmissionProductDto) {
    closeActions();
    const publishing = !p.published;
    patchMutation.mutate(
      { id: p.id, payload: { published: publishing } },
      {
        onSuccess: () => {
          addToast(publishing ? 'Published' : 'Unpublished', 'success');
          if (
            publishing &&
            p.locationId &&
            franchiseLocationIds.has(p.locationId) &&
            parkChargeReadyById.get(p.locationId) === false
          ) {
            addToast(
              'Publish OK; park payouts not ready — online pay blocked until Connect on /admin/payouts.',
              'info'
            );
          }
        },
        onError: (err: Error) =>
          addToast(err.message || 'Update failed', 'error'),
      }
    );
  }

  function restoreProduct(p: AdmissionProductDto) {
    closeActions();
    patchMutation.mutate(
      { id: p.id, payload: { unarchive: true } },
      {
        onSuccess: () => addToast('Product restored', 'success'),
        onError: (err: Error) =>
          addToast(err.message || 'Restore failed', 'error'),
      }
    );
  }

  function deleteProduct(p: AdmissionProductDto) {
    closeActions();
    if (
      !window.confirm(
        `Delete “${p.name}”? This soft-archives the product (bookings keep their line history). You can restore it later.`
      )
    ) {
      return;
    }
    archiveMutation.mutate(p.id, {
      onSuccess: () =>
        addToast('Product deleted — removed from list', 'success'),
      onError: (err: Error) =>
        addToast(err.message || 'Delete failed', 'error'),
    });
  }

  const colCount = 11;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Ticketing
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            Ticket products
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Your sellable menu for venues. New here? Open the guide for types,
            sessions, and how to publish online.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canWrite ? (
            <button
              type="button"
              className={`${btnPrimaryClass} shrink-0`}
              onClick={() => setCreateOpen(true)}
            >
              Create product
            </button>
          ) : null}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Ticket products"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TICKETING_PRODUCTS_GUIDE_STEPS}
      />

      <CreateTicketProductModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        preferLocationId={locationId || undefined}
      />

      {canReadPayouts && parkPayoutGap ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Publish OK; park payouts not ready — online pay blocked until Connect
          on{' '}
          <Link
            href={`/admin/payouts?locationId=${encodeURIComponent(parkPayoutGap.locationId)}`}
            className="font-semibold underline"
          >
            /admin/payouts
          </Link>
          {parkPayoutGap.locationName
            ? ` (${parkPayoutGap.locationName})`
            : ''}
          .
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <select
          value={type}
          onChange={(e) =>
            setType(e.target.value as AdmissionProductType | 'all')
          }
          className={`${fieldClass} w-auto min-w-[10rem]`}
        >
          <option value="all">All types</option>
          {PRODUCT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${fieldClass} w-auto min-w-[12rem]`}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={published}
          onChange={(e) =>
            setPublished(e.target.value as 'all' | 'true' | 'false')
          }
          className={`${fieldClass} w-auto min-w-[10rem]`}
        >
          <option value="all">Published: all</option>
          <option value="true">Published</option>
          <option value="false">Unpublished</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          disabled={Boolean(scopedLocationId) || parkLocked}
          className={`${fieldClass} w-auto min-w-[12rem]`}
        >
          {!parkLocked ? <option value="">All venues</option> : null}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2 text-xs text-stone-500 sm:ml-auto sm:items-center">
          <AdminPendingLink href="/admin/ticketing/sessions" className="hover:text-[#D4AF37]">
            Sessions
          </AdminPendingLink>
          <span>·</span>
          <AdminPendingLink href="/admin/ticketing/resources" className="hover:text-[#D4AF37]">
            Resources
          </AdminPendingLink>
          <span>·</span>
          <AdminPendingLink href="/admin/ticketing/add-ons" className="hover:text-[#D4AF37]">
            Add-ons
          </AdminPendingLink>
          <span>·</span>
          <AdminPendingLink href="/admin/ticketing/passes" className="hover:text-[#D4AF37]">
            Passes
          </AdminPendingLink>
          <span>·</span>
          <AdminPendingLink href="/admin/ticketing/settings" className="hover:text-[#D4AF37]">
            Settings
          </AdminPendingLink>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="w-12 px-3 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Venue</th>
                <th className="px-4 py-3 font-semibold">Price from</th>
                <th className="px-4 py-3 font-semibold">Capacity / resource</th>
                <th className="px-4 py-3 font-semibold">Published</th>
                <th className="px-4 py-3 font-semibold">Archived</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {productsQuery.isPending && !(productsQuery.data?.length) ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-stone-500">
                    Loading products…
                  </td>
                </tr>
              ) : productsQuery.isError ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-red-600">
                    {(productsQuery.error as Error)?.message ||
                      'Failed to load products'}
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-stone-500">
                    No products yet.
                    {canWrite ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 font-medium text-[#D4AF37] underline-offset-2 hover:underline"
                          onClick={() => setCreateOpen(true)}
                        >
                          Create your first product
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ) : (
                products.map((p, index) => (
                  <tr key={p.id} className="align-middle">
                    <td className="px-3 py-3 tabular-nums text-stone-500">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3 font-medium text-stone-900">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {p.category?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {formatProductType(p.type)}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {p.location?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {formatMoney(p.priceFrom)}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {p.resource
                        ? `${p.resource.name} (${p.resource.defaultCapacity})`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                          p.published
                            ? 'bg-emerald-50 text-emerald-900'
                            : 'bg-stone-100 text-stone-600'
                        }`}
                      >
                        {p.published ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {p.archivedAt ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500">
                      {new Date(p.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="inline-block text-left"
                        data-product-actions={p.id}
                      >
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) actionsTriggerRefs.current.set(p.id, el);
                            else actionsTriggerRefs.current.delete(p.id);
                          }}
                          disabled={busy}
                          aria-haspopup="menu"
                          aria-expanded={actionsMenuId === p.id}
                          onClick={() =>
                            setActionsMenuId((id) =>
                              id === p.id ? null : p.id
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
                        >
                          Actions
                          <svg
                            className={`h-3.5 w-3.5 text-stone-500 transition-transform ${
                              actionsMenuId === p.id ? 'rotate-180' : ''
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {actionsProduct && actionsMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="menu"
              data-product-actions-menu
              style={{
                position: 'fixed',
                top: actionsMenuPos.top,
                left: actionsMenuPos.left,
                width: ACTIONS_MENU_WIDTH,
              }}
              className="z-[60] overflow-hidden rounded-md border border-stone-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  closeActions();
                  router.push(
                    `/admin/ticketing/products/${actionsProduct.id}`
                  );
                }}
              >
                View
              </button>
              {canWrite ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                  onClick={() => {
                    closeActions();
                    router.push(
                      `/admin/ticketing/products/${actionsProduct.id}/edit`
                    );
                  }}
                >
                  Edit
                </button>
              ) : null}
              {productHasSessions(actionsProduct.type) ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                  onClick={() => {
                    closeActions();
                    router.push(
                      `/admin/ticketing/sessions?productId=${actionsProduct.id}`
                    );
                  }}
                >
                  Manage sessions
                </button>
              ) : null}
              {canWrite && !actionsProduct.archivedAt ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                  onClick={() => togglePublish(actionsProduct)}
                >
                  {actionsProduct.published ? 'Unpublish' : 'Publish'}
                </button>
              ) : null}
              {canWrite && actionsProduct.archivedAt ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                  onClick={() => restoreProduct(actionsProduct)}
                >
                  Restore
                </button>
              ) : null}
              {canWrite && !actionsProduct.archivedAt ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50"
                  onClick={() => deleteProduct(actionsProduct)}
                >
                  Delete
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
