'use client';

/**
 * Multi-park venues console — create, edit, soft-archive, reactivate.
 * Plan meters gate creates/reactivates; APIs remain source of truth.
 */
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  invalidateBillingUsageQueries,
  useBillingUsageQuery,
  useEnterpriseHqSessionCatchUp,
} from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import { hqKeys, type HqLocationContextDto } from '@/services/hq';
import { parkContextKeys, type ParkContextDto } from '@/services/parkContext';
import {
  archiveAdminVenueLocation,
  createAdminVenueLocation,
  listAdminVenueLocations,
  reactivateAdminVenueLocation,
  updateAdminVenueLocation,
  venueLocationKeys,
  type VenueLocationDto,
} from '@/services/venueLocations';
import {
  applyVenueListMutation,
  removeVenueFromLists,
  upsertVenueInLists,
} from '@/lib/venueLocationCache';
import { invalidateMembershipsQueries } from '@/utils/invalidateMembershipsQueries';
import { invalidateTicketingQueries } from '@/utils/invalidateTicketingQueries';
import { invalidateWaiversQueries } from '@/utils/invalidateWaiversQueries';
import { invalidateMarketingQueries } from '@/utils/invalidateMarketingQueries';
import { invalidateMarketplacePayoutQueries } from '@/utils/invalidateMarketplacePayoutQueries';
import { softGateInlineHint } from '@/utils/planLimitSoftGate';
import { useAuthStore } from '@/store/authStore';
import { isStorefrontOrgSession } from '@/services/auth';
import { P } from '@/lib/auth/permissions';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  listParkMarketplaceAccounts,
  marketplaceKeys,
} from '@/services/marketplace';
import { broadcastHqLocationContextChange } from '@/utils/hqLocationContextSync';
import PlatformOpsTenantAppsPanel, {
  useIsPlatformOpsTenantAppsViewer,
} from '@/components/Protected/admin/pages/hq/PlatformOpsTenantAppsPanel';
import { normalizeVenueSlugInput } from '@/lib/venueFormHelpers';
import { browserPublicOrigin } from '@/lib/tenantDomain';
import VenuePlaceFields from '@/components/Protected/admin/pages/venues/VenuePlaceFields';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredVenuesGuideModal } from '@/components/Protected/admin/pages/venues/DeferredVenuesGuideModal';
import { VENUES_GUIDE_STEPS } from '@/components/Protected/admin/pages/venues/venuesGuides';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
type EditFormState = {
  name: string;
  slug: string;
  city: string;
  timezone: string;
  addressLine1: string;
  publicBookingEnabled: boolean;
  isFranchise: boolean;
  franchiseDisplayName: string;
  franchiseSupportPhone: string;
  franchiseSupportEmail: string;
  franchiseCode: string;
  franchiseNotes: string;
};

type ActionsMenuPos = { top: number; left: number };

const ACTIONS_MENU_WIDTH = 192;

/** Scrollbar mousedown hits the scroller, not "outside" content — keep the menu open. */
function isScrollbarClick(event: MouseEvent): boolean {
  let node: HTMLElement | null = event.target as HTMLElement | null;
  while (node) {
    const { overflowX, overflowY } = getComputedStyle(node);
    const scrollY =
      node.scrollHeight > node.clientHeight &&
      /(auto|scroll|overlay)/.test(overflowY);
    const scrollX =
      node.scrollWidth > node.clientWidth &&
      /(auto|scroll|overlay)/.test(overflowX);
    if (scrollX || scrollY) {
      const rect = node.getBoundingClientRect();
      const sbW = node.offsetWidth - node.clientWidth;
      const sbH = node.offsetHeight - node.clientHeight;
      if (scrollY && sbW > 0 && event.clientX >= rect.right - sbW - 1) return true;
      if (scrollX && sbH > 0 && event.clientY >= rect.bottom - sbH - 1) return true;
    }
    node = node.parentElement;
  }
  return false;
}

const emptyEdit = (): EditFormState => ({
  name: '',
  slug: '',
  city: '',
  timezone: '',
  addressLine1: '',
  publicBookingEnabled: false,
  isFranchise: false,
  franchiseDisplayName: '',
  franchiseSupportPhone: '',
  franchiseSupportEmail: '',
  franchiseCode: '',
  franchiseNotes: '',
});

function refreshMetersAndHq(
  queryClient: QueryClient,
  opts?: { orgId?: string | null }
) {
  invalidateBillingUsageQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ['admin', 'hq'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'park-context'] });
  // Archive soft-archives park-specific membership plans + clears eligibility/settings.
  invalidateMembershipsQueries(queryClient);
  // Create/archive/reactivate also drops park inventory visibility for open tabs.
  invalidateTicketingQueries(queryClient);
  invalidateWaiversQueries(queryClient);
  invalidateMarketingQueries(queryClient);
  // Archive disables park Connect charge-ready — refresh payouts / HQ badges (+ cross-tab).
  invalidateMarketplacePayoutQueries(queryClient, {
    orgId: opts?.orgId,
    broadcast: Boolean(opts?.orgId),
  });
  // Background reconcile — UI already has the row from setQueryData.
  void queryClient.invalidateQueries({
    queryKey: venueLocationKeys.all,
    refetchType: 'active',
  });
}

export default function VenuesPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const { canWriteVenues, canArchiveVenues } = useCatalogActionPermissions();
  const enterpriseHqEnabled = user?.enterpriseHqEnabled === true;
  const {
    scopedLocationId: locationId,
    locationScoped,
    parkLocked,
  } = useHqLocationFilter();
  const isPlatformOpsViewer = useIsPlatformOpsTenantAppsViewer();
  const companyConsole = !isPlatformOpsViewer;
  useEnterpriseHqSessionCatchUp(
    Boolean(user) && !isStorefrontOrgSession(user)
  );
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  /** When true, typing the name no longer overwrites a manually edited slug. */
  const [slugManual, setSlugManual] = useState(false);
  const [createIsFranchise, setCreateIsFranchise] = useState(false);
  const [city, setCity] = useState('');
  const [timezone, setTimezone] = useState('');
  const [editing, setEditing] = useState<VenueLocationDto | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(emptyEdit());
  const [editSlugManual, setEditSlugManual] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null);
  const [actionsMenuPos, setActionsMenuPos] = useState<ActionsMenuPos | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const actionsTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Always load company-wide venues immediately — never wait on HQ context.
  // Park preference filters client-side when a location is selected.
  // API ?scope=all still caps park-locked seats to their assigned set.
  const venuesKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: companyConsole,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
    placeholderData: (previous) => previous,
  });

  const canReadParkPayouts =
    companyConsole &&
    !isStorefrontOrgSession(user) &&
    (can(P.PayoutsRead) || can(P.PayoutsManage));
  const parkAccountsQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: canReadParkPayouts,
  });
  const parkChargeReadyById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of parkAccountsQuery.data ?? []) {
      map.set(p.locationId, Boolean(p.chargeReady));
    }
    return map;
  }, [parkAccountsQuery.data]);

  const usageQuery = useBillingUsageQuery(companyConsole);
  const venuesMeter = usageMeterFor(usageQuery.data, 'venues');
  const usageReady = Boolean(usageQuery.data) || usageQuery.isError;
  const venuesAtLimit =
    !usageQuery.isError &&
    (!usageReady ||
      !venuesMeter ||
      (!venuesMeter.unlimited && (venuesMeter.remaining ?? 0) <= 0));
  const createBlockedHint = !usageReady
    ? 'Checking plan usage…'
    : softGateInlineHint(usageQuery.data, 'venues', venuesAtLimit, {
        zeroCap:
          Boolean(venuesMeter) &&
          !venuesMeter?.unlimited &&
          venuesMeter?.limit === 0,
      });

  useEffect(() => {
    if (!editing) {
      setEditForm(emptyEdit());
      setEditSlugManual(false);
      return;
    }
    setEditForm({
      name: editing.name,
      slug: editing.slug,
      city: editing.city ?? '',
      timezone: editing.timezone ?? '',
      addressLine1: editing.addressLine1 ?? '',
      publicBookingEnabled: Boolean(editing.publicBookingEnabled),
      isFranchise: Boolean(editing.isFranchise),
      franchiseDisplayName: editing.franchiseDisplayName ?? '',
      franchiseSupportPhone: editing.franchiseSupportPhone ?? '',
      franchiseSupportEmail: editing.franchiseSupportEmail ?? '',
      franchiseCode: editing.franchiseCode ?? '',
      franchiseNotes: editing.franchiseNotes ?? '',
    });
    setEditSlugManual(true);
  }, [editing]);

  useLayoutEffect(() => {
    if (!actionsMenuId) {
      setActionsMenuPos(null);
      return;
    }

    const syncPosition = () => {
      const trigger = actionsTriggerRefs.current.get(actionsMenuId);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuEl = document.querySelector(
        '[data-venue-actions-menu]'
      ) as HTMLElement | null;
      const menuHeight = menuEl?.offsetHeight || 0;
      const menuWidth = menuEl?.offsetWidth || ACTIONS_MENU_WIDTH;
      const gap = 4;

      // Always anchor under the button first; flip only after we know height.
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
      if (target?.closest(`[data-venue-actions="${actionsMenuId}"]`)) return;
      if (target?.closest('[data-venue-actions-menu]')) return;
      if (isScrollbarClick(event)) return;
      setActionsMenuId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsMenuId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actionsMenuId]);

  const createMutation = useMutation({
    mutationFn: () =>
      createAdminVenueLocation({
        name: name.trim(),
        slug: slug.trim() || undefined,
        city: city.trim() || null,
        timezone: timezone.trim() || null,
        isFranchise: createIsFranchise,
      }),
    meta: { suppressErrorBanner: true },
    onSuccess: async (venue) => {
      await applyVenueListMutation(queryClient, venue);
      refreshMetersAndHq(queryClient, {
        orgId: useAuthStore.getState().user?.orgId,
      });
      if (enterpriseHqEnabled && locationId) {
        addToast(
          'Venue created — if a park filter is on, switch to All locations to keep it visible',
          'success'
        );
      } else if (locationId) {
        addToast(
          'Venue created — if a park filter is on, switch to All locations to keep it visible',
          'success'
        );
      } else {
        addToast(
          createIsFranchise ? 'Franchise park created' : 'Venue created',
          'success'
        );
      }
      setName('');
      setSlug('');
      setSlugManual(false);
      setCity('');
      setTimezone('');
      setCreateIsFranchise(false);
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      addToast(err.message || 'Could not create venue', 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('No venue selected');
      return updateAdminVenueLocation(editing.id, {
        name: editForm.name.trim(),
        slug: parkLocked ? undefined : editForm.slug.trim() || undefined,
        city: editForm.city.trim() || null,
        timezone: editForm.timezone.trim() || null,
        addressLine1: editForm.addressLine1.trim() || null,
        publicBookingEnabled: parkLocked
          ? undefined
          : editForm.publicBookingEnabled,
        isFranchise: parkLocked ? undefined : editForm.isFranchise,
        franchiseDisplayName: editForm.franchiseDisplayName.trim() || null,
        franchiseSupportPhone: editForm.franchiseSupportPhone.trim() || null,
        franchiseSupportEmail: editForm.franchiseSupportEmail.trim() || null,
        franchiseCode: editForm.franchiseCode.trim() || null,
        franchiseNotes: editForm.franchiseNotes.trim() || null,
      });
    },
    meta: { suppressErrorBanner: true },
    onSuccess: async (venue) => {
      await applyVenueListMutation(queryClient, venue);
      refreshMetersAndHq(queryClient, {
        orgId: useAuthStore.getState().user?.orgId,
      });
      addToast('Venue updated', 'success');
      setEditing(null);
    },
    onError: (err: Error) => {
      addToast(err.message || 'Could not update venue', 'error');
    },
  });

  const publishMutation = useMutation({
    mutationFn: (opts: { id: string; enabled: boolean }) =>
      updateAdminVenueLocation(opts.id, {
        publicBookingEnabled: opts.enabled,
      }),
    meta: { suppressErrorBanner: true },
    onSuccess: async (venue) => {
      await applyVenueListMutation(queryClient, venue);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hq'] });
      addToast(
        venue.publicBookingEnabled
          ? 'Online booking published'
          : 'Online booking unpublished',
        'success'
      );
    },
    onError: (err: Error) => {
      addToast(err.message || 'Could not update online booking', 'error');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveAdminVenueLocation(id),
    meta: { suppressErrorBanner: true },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: venueLocationKeys.all });
      removeVenueFromLists(queryClient, id);
      setActionsMenuId(null);
      setConfirmArchiveId(null);
    },
    onSuccess: (venue, id) => {
      removeVenueFromLists(queryClient, id);
      // Keep archived copy only when "Show archived" is on.
      if (showArchived) upsertVenueInLists(queryClient, venue);
      const ctxKey = hqKeys.locationContext();
      const prev = queryClient.getQueryData<HqLocationContextDto>(ctxKey);
      if (prev?.locationId === id) {
        queryClient.setQueryData<HqLocationContextDto>(ctxKey, {
          ...prev,
          locationId: null,
          location: null,
        });
        const orgId = useAuthStore.getState().user?.orgId;
        if (orgId) {
          broadcastHqLocationContextChange({ orgId, locationId: null });
        }
      }
      const parkKey = parkContextKeys.context();
      const parkPrev = queryClient.getQueryData<ParkContextDto>(parkKey);
      if (parkPrev?.effectiveLocationId === id) {
        // Park-locked seats cannot be All — server heals to another assigned park
        // or unlocks. Never optimistic-null; refetch + force session catch-up.
        void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
        void queryClient.invalidateQueries({
          queryKey: hqKeys.locationContext(),
        });
        const orgId = useAuthStore.getState().user?.orgId;
        if (orgId) {
          broadcastHqLocationContextChange({ orgId, locationId: null });
        }
        void useAuthStore.getState().silentRefresh({ force: true });
      }
      refreshMetersAndHq(queryClient, {
        orgId: useAuthStore.getState().user?.orgId,
      });
      addToast('Venue deleted (archived) — removed from list', 'success');
    },
    onError: (err: Error) => {
      void queryClient.invalidateQueries({ queryKey: venueLocationKeys.all });
      addToast(err.message || 'Could not delete venue', 'error');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateAdminVenueLocation(id),
    meta: { suppressErrorBanner: true },
    onSuccess: async (venue) => {
      await applyVenueListMutation(queryClient, venue);
      refreshMetersAndHq(queryClient, {
        orgId: useAuthStore.getState().user?.orgId,
      });
      addToast('Venue restored', 'success');
    },
    onError: (err: Error) => {
      addToast(err.message || 'Could not restore venue', 'error');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || createMutation.isPending || venuesAtLimit) return;
    if (createBlockedHint) {
      addToast(createBlockedHint, 'error');
      return;
    }
    createMutation.mutate();
  }

  function closeCreateModal() {
    if (createMutation.isPending) return;
    setCreateOpen(false);
  }

  function openCreateModal() {
    setName('');
    setSlug('');
    setSlugManual(false);
    setCity('');
    setTimezone('');
    setCreateOpen(true);
  }

  const { overlayDismissProps: createOverlayDismissProps } =
    useOverlayDismiss(closeCreateModal);

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCreateModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeCreateModal uses mutation pending
  }, [createOpen, createMutation.isPending]);

  const venues = useMemo(() => {
    const all = venuesQuery.data ?? [];
    const scoped = locationId
      ? all.filter((v) => v.id === locationId)
      : all;
    if (showArchived) return scoped;
    return scoped.filter((v) => v.status !== 'archived');
  }, [venuesQuery.data, locationId, showArchived]);

  const busy =
    archiveMutation.isPending ||
    reactivateMutation.isPending ||
    updateMutation.isPending ||
    publishMutation.isPending;

  function bookPath(v: VenueLocationDto) {
    return `/book/${encodeURIComponent(v.slug)}`;
  }

  function copyText(label: string, text: string) {
    void navigator.clipboard
      .writeText(text)
      .then(() => addToast(`${label} copied`, 'success'))
      .catch(() => addToast(text, 'info'));
  }

  const actionsVenue = actionsMenuId
    ? venues.find((v) => v.id === actionsMenuId) ?? null
    : null;
  const actionsPath = actionsVenue ? bookPath(actionsVenue) : null;
  const actionsAbsoluteBook =
    actionsPath && typeof window !== 'undefined'
      ? `${browserPublicOrigin()}${actionsPath}`
      : actionsPath;
  const actionsArchived = actionsVenue?.status === 'archived';

  if (isPlatformOpsViewer) {
    return <PlatformOpsTenantAppsPanel app="venues" />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#D4AF37]">
            Multi-park · Locations
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Venues</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Parks and sites under this company. Soft-archive frees plan quota
            without deleting history. Open the guide if you are doing this for
            the first time.
          </p>
          {enterpriseHqEnabled ? (
            <p className="mt-2 text-sm text-stone-600">
              Enterprise HQ unlocked —{' '}
              <Link
                href="/admin/hq"
                className="font-medium text-[#D4AF37] underline-offset-2 hover:underline"
              >
                open cross-park HQ dashboard
              </Link>
              .
            </p>
          ) : parkLocked ? (
            <p className="mt-2 text-sm text-stone-600">
              Park-locked — this list shows venues in your assignment.
            </p>
          ) : locationScoped ? (
            <p className="mt-2 text-sm text-stone-600">
              Header park filter is active — list narrowed to the selected
              venue.
            </p>
          ) : (
            <p className="mt-2 text-sm text-stone-500">
              Need the HQ venue switcher?{' '}
              <Link
                href="/admin/hq"
                className="font-medium text-stone-800 underline-offset-2 hover:underline"
              >
                See Enterprise HQ
              </Link>{' '}
              or upgrade in{' '}
              <Link
                href="/admin/billing"
                className="font-medium text-stone-800 underline-offset-2 hover:underline"
              >
                Billing
              </Link>
              .
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {!parkLocked && canWriteVenues ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#D4AF37]/90"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Create venue</span>
            </button>
          ) : null}
        </div>
      </div>

      {guideOpen ? (
        <DeferredVenuesGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Venues"
          subtitle="Follow these steps in order — written for first-time admins."
          steps={VENUES_GUIDE_STEPS}
        />
      ) : null}

      {parkLocked ? (
        <p className="max-w-xl rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
          Park-assigned seats can edit assigned venues but cannot create, archive,
          or restore locations. Ask a company-wide admin for those changes.
        </p>
      ) : null}

      {createOpen && !parkLocked && canWriteVenues ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="venue-create-title"
          {...createOverlayDismissProps}
        >
          <div
            className="my-3 flex max-h-[min(92dvh,44rem)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg sm:my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
              <h2
                id="venue-create-title"
                className="text-sm font-semibold text-stone-900"
              >
                Add venue
              </h2>
              <button
                type="button"
                aria-label="Close"
                disabled={createMutation.isPending}
                onClick={closeCreateModal}
                className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 disabled:opacity-50"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form
              onSubmit={onSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
                {venuesMeter && usageQuery.data?.billingEntitled ? (
                  <p className="text-xs text-stone-500">
                    {venuesMeter.unlimited
                      ? `Plan usage: ${venuesMeter.used} venues (unlimited)`
                      : `Plan usage: ${venuesMeter.used}/${venuesMeter.limit ?? 0} venues · ${
                          venuesMeter.remaining ?? 0
                        } remaining`}
                  </p>
                ) : null}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const next = e.target.value;
                    setName(next);
                    if (!slugManual) {
                      setSlug(normalizeVenueSlugInput(next));
                    }
                  }}
                  placeholder="Venue name (e.g. Downtown Trampoline Park)"
                  required
                  minLength={2}
                  disabled={venuesAtLimit}
                  autoFocus
                  className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60"
                />
                <div className="space-y-1">
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlugManual(true);
                      setSlug(normalizeVenueSlugInput(e.target.value));
                    }}
                    placeholder="URL slug (auto from name)"
                    disabled={venuesAtLimit}
                    className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60"
                  />
                  <p className="text-[11px] text-stone-500">
                    Public path uses{' '}
                    <span className="font-mono">
                      /book/{slug || 'venue-slug'}
                    </span>
                    {slugManual ? (
                      <>
                        {' '}
                        ·{' '}
                        <button
                          type="button"
                          className="text-[#D4AF37] underline-offset-2 hover:underline"
                          onClick={() => {
                            setSlugManual(false);
                            setSlug(normalizeVenueSlugInput(name));
                          }}
                        >
                          Reset from name
                        </button>
                      </>
                    ) : (
                      ' · updates automatically from the name'
                    )}
                  </p>
                </div>
                <VenuePlaceFields
                  city={city}
                  timezone={timezone}
                  onCityChange={setCity}
                  onTimezoneChange={setTimezone}
                  disabled={venuesAtLimit}
                />
                <label className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={createIsFranchise}
                    onChange={(e) => setCreateIsFranchise(e.target.checked)}
                    disabled={venuesAtLimit}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">Franchise park</span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      Operate as a franchise unit under this company. Staff stay
                      on the same Organization — not a second subscription.
                    </span>
                  </span>
                </label>
                {createBlockedHint ? (
                  <p className="text-xs text-amber-800">{createBlockedHint}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-stone-100 px-4 py-3">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={createMutation.isPending}
                  className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    createMutation.isPending || !name.trim() || venuesAtLimit
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c4a030] disabled:opacity-60"
                >
                  {createMutation.isPending ? <ButtonSpinner /> : null}
                  {createMutation.isPending ? 'Creating…' : 'Create venue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">
            Locations ({venues.length})
            {!parkLocked ? (
            <label className="ml-3 inline-flex items-center gap-1.5 text-xs font-normal normal-case tracking-normal text-stone-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            ) : null}
          </h2>
        </div>
        {venuesQuery.isPending && !(venuesQuery.data?.length) ? (
          <p className="px-4 py-6 text-sm text-stone-500">Loading venues…</p>
        ) : venuesQuery.isError ? (
          <p className="px-4 py-6 text-sm text-red-600">
            {(venuesQuery.error as Error)?.message || 'Failed to load venues'}
          </p>
        ) : venues.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-stone-500">
              {usageQuery.data && !usageQuery.data.billingEntitled
                ? 'No venues yet — subscribe in Billing (or ask FECSYNC for an ops plan stamp) to unlock creates.'
                : createBlockedHint
                  ? createBlockedHint
                  : 'No venues yet. Create your first park or site.'}
            </p>
            {!parkLocked && canWriteVenues && !createBlockedHint ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#D4AF37]/90"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Create venue</span>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">#</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Venue</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">City / timezone</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Online booking</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {venues.map((v, index) => {
                  const isArchived = v.status === 'archived';
                  const path = bookPath(v);
                  return (
                    <tr key={v.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-stone-500">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-stone-900">{v.name}</p>
                        <p className="font-mono text-[11px] text-stone-500">/{v.slug}</p>
                        {path ? (
                          <p className="mt-0.5 break-all font-mono text-[11px] text-stone-400">
                            {path}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${
                            isArchived
                              ? 'bg-stone-100 text-stone-600'
                              : 'bg-emerald-50 text-emerald-900'
                          }`}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        <p>{v.city || '—'}</p>
                        <p className="text-xs text-stone-500">{v.timezone || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        <div className="flex flex-col gap-0.5">
                          {v.publicBookingEnabled ? (
                            <span className="text-xs font-medium text-emerald-800">Published</span>
                          ) : (
                            <span className="text-xs text-stone-500">Off</span>
                          )}
                          {v.isFranchise ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium text-amber-900">
                                Franchise park
                              </span>
                              {canReadParkPayouts ? (
                                parkChargeReadyById.get(v.id) ? (
                                  <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                    Payouts ready
                                  </span>
                                ) : (
                                  <Link
                                    href={`/admin/payouts?locationId=${encodeURIComponent(v.id)}`}
                                    className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950 hover:underline"
                                    title="Complete park Connect onboarding"
                                  >
                                    Payouts needed
                                  </Link>
                                )
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-block text-left" data-venue-actions={v.id}>
                          <button
                            type="button"
                            ref={(el) => {
                              if (el) actionsTriggerRefs.current.set(v.id, el);
                              else actionsTriggerRefs.current.delete(v.id);
                            }}
                            disabled={busy}
                            aria-haspopup="menu"
                            aria-expanded={actionsMenuId === v.id}
                            onClick={() =>
                              setActionsMenuId((id) => (id === v.id ? null : v.id))
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
                          >
                            Actions
                            <svg
                              className={`h-3.5 w-3.5 text-stone-500 transition-transform ${
                                actionsMenuId === v.id ? 'rotate-180' : ''
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {actionsVenue && actionsMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="menu"
              data-venue-actions-menu
              style={{
                position: 'fixed',
                top: actionsMenuPos.top,
                left: actionsMenuPos.left,
                width: ACTIONS_MENU_WIDTH,
              }}
              className="z-[60] overflow-hidden rounded-md border border-stone-200 bg-white py-1 shadow-lg"
            >
              {canWriteVenues ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  setActionsMenuId(null);
                  setEditing(actionsVenue);
                }}
              >
                Edit
              </button>
              ) : null}
              {!actionsArchived && canWriteVenues ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                  onClick={() => {
                    setActionsMenuId(null);
                    publishMutation.mutate({
                      id: actionsVenue.id,
                      enabled: !actionsVenue.publicBookingEnabled,
                    });
                  }}
                >
                  {actionsVenue.publicBookingEnabled ? 'Unpublish' : 'Publish'}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  setActionsMenuId(null);
                  copyText('Slug', actionsVenue.slug);
                }}
              >
                Copy slug
              </button>
              {actionsVenue.publicBookingEnabled && actionsAbsoluteBook ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                    onClick={() => {
                      setActionsMenuId(null);
                      copyText('Book link', actionsAbsoluteBook);
                    }}
                  >
                    Copy book link
                  </button>
                  {actionsPath ? (
                    <a
                      role="menuitem"
                      href={actionsPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                      onClick={() => setActionsMenuId(null)}
                    >
                      Open booking
                    </a>
                  ) : null}
                </>
              ) : null}
              {!actionsArchived &&
              actionsVenue.isFranchise &&
              (can(P.PayoutsRead) || can(P.PayoutsManage)) ? (
                <Link
                  role="menuitem"
                  href={`/admin/payouts?locationId=${encodeURIComponent(actionsVenue.id)}`}
                  className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50"
                  onClick={() => setActionsMenuId(null)}
                >
                  Park payouts
                </Link>
              ) : null}
              <div className="my-1 border-t border-stone-100" />
              {!parkLocked && canArchiveVenues ? (
                actionsArchived ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={venuesAtLimit}
                  title={
                    venuesAtLimit
                      ? createBlockedHint || 'At venues plan limit'
                      : undefined
                  }
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                  onClick={() => {
                    setActionsMenuId(null);
                    reactivateMutation.mutate(actionsVenue.id);
                  }}
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50"
                  onClick={() => {
                    setActionsMenuId(null);
                    setConfirmArchiveId(actionsVenue.id);
                  }}
                >
                  Delete
                </button>
              )
              ) : null}
            </div>,
            document.body
          )
        : null}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="venue-edit-title"
            className="my-3 flex max-h-[min(92dvh,44rem)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg sm:my-auto"
          >
            <div className="shrink-0 border-b border-stone-100 px-4 py-3">
              <h2
                id="venue-edit-title"
                className="text-sm font-semibold text-stone-900"
              >
                Edit venue
              </h2>
            </div>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                if (!editForm.name.trim() || updateMutation.isPending) return;
                updateMutation.mutate();
              }}
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => {
                  const next = e.target.value;
                  setEditForm((s) => ({
                    ...s,
                    name: next,
                    slug: editSlugManual
                      ? s.slug
                      : normalizeVenueSlugInput(next),
                  }));
                }}
                required
                minLength={2}
                placeholder="Name"
                className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
              <input
                type="text"
                value={editForm.slug}
                onChange={(e) => {
                  setEditSlugManual(true);
                  setEditForm((s) => ({
                    ...s,
                    slug: normalizeVenueSlugInput(e.target.value),
                  }));
                }}
                placeholder="Slug"
                className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
              <input
                type="text"
                value={editForm.addressLine1}
                onChange={(e) =>
                  setEditForm((s) => ({ ...s, addressLine1: e.target.value }))
                }
                placeholder="Address line 1 (optional)"
                className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
              <VenuePlaceFields
                city={editForm.city}
                timezone={editForm.timezone}
                onCityChange={(next) =>
                  setEditForm((s) => ({ ...s, city: next }))
                }
                onTimezoneChange={(next) =>
                  setEditForm((s) => ({ ...s, timezone: next }))
                }
                autoPrefillTimezone={false}
              />
              {!parkLocked ? (
                <label className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={editForm.publicBookingEnabled}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        publicBookingEnabled: e.target.checked,
                      }))
                    }
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">Publish for online booking</span>
                    <span className="mt-0.5 block break-words text-xs text-stone-500">
                      When on, the public booking wizard can list this venue at{' '}
                      <span className="font-mono">
                        /book/{editForm.slug || 'venue-slug'}
                      </span>
                      . Catalog products must still be published separately.
                    </span>
                  </span>
                </label>
              ) : null}
              {!parkLocked ? (
                <label className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={editForm.isFranchise}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        isFranchise: e.target.checked,
                      }))
                    }
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">Franchise park</span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      Franchise unit under this company. Billing and plan meters
                      stay company-wide.
                    </span>
                  </span>
                </label>
              ) : null}
              {(editForm.isFranchise ||
                (parkLocked && user?.franchiseParkManager === true)) && (
                <div className="space-y-2 rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2">
                  <p className="text-xs font-medium text-amber-950">
                    Franchise park profile
                  </p>
                  <input
                    type="text"
                    value={editForm.franchiseDisplayName}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        franchiseDisplayName: e.target.value,
                      }))
                    }
                    placeholder="Display name override (optional)"
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  />
                  <input
                    type="text"
                    value={editForm.franchiseSupportPhone}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        franchiseSupportPhone: e.target.value,
                      }))
                    }
                    placeholder="Support phone"
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  />
                  <input
                    type="email"
                    value={editForm.franchiseSupportEmail}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        franchiseSupportEmail: e.target.value,
                      }))
                    }
                    placeholder="Support email"
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  />
                  <input
                    type="text"
                    value={editForm.franchiseCode}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        franchiseCode: e.target.value,
                      }))
                    }
                    placeholder="Franchise code (optional)"
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  />
                  <textarea
                    value={editForm.franchiseNotes}
                    onChange={(e) =>
                      setEditForm((s) => ({
                        ...s,
                        franchiseNotes: e.target.value,
                      }))
                    }
                    placeholder="Notes (optional)"
                    rows={2}
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  />
                </div>
              )}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-stone-100 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending || !editForm.name.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c4a030] disabled:opacity-60"
                >
                  {updateMutation.isPending ? <ButtonSpinner /> : null}
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmArchiveId ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="my-auto w-full max-w-sm rounded-lg border border-stone-200 bg-white p-4 shadow-lg"
          >
            <h2 className="text-sm font-semibold text-stone-900">
              Delete this venue?
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              Soft-deletes the venue (archived) and frees your venues quota. It
              disappears from this list immediately. You can restore it later
              via &quot;Show archived&quot; if plan room allows.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchiveId(null)}
                className="rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Keep
              </button>
              <button
                type="button"
                disabled={archiveMutation.isPending}
                onClick={() => archiveMutation.mutate(confirmArchiveId)}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {archiveMutation.isPending ? <ButtonSpinner /> : null}
                {archiveMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
