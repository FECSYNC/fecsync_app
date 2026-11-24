'use client';

/**
 * Enterprise HQ location scope control (Membership.hqSelectedLocationId).
 * Visible only when canMutatePath('/admin/hq') — settings:manage + entitled
 * company (not Demo/storefront). null = All locations (company-wide).
 * Archived selection is cleared server-side on GET; this UI only lists active venues.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAdminCan } from '@/hooks/useAdminPermission';
import {
  getAdminHqLocationContext,
  setAdminHqLocationContext,
  hqKeys,
} from '@/services/hq';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useAuthStore } from '@/store/authStore';
import { broadcastHqLocationContextChange } from '@/utils/hqLocationContextSync';
import { invalidateTicketingQueries } from '@/utils/invalidateTicketingQueries';
import { invalidateMembershipsQueries } from '@/utils/invalidateMembershipsQueries';
import { invalidateWaiversQueries } from '@/utils/invalidateWaiversQueries';
import { invalidateMarketingQueries } from '@/utils/invalidateMarketingQueries';

export default function HqVenueSwitcher() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { canMutatePath } = useAdminCan();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  // Align with API assertEnterpriseHqEnabled + settings:manage + Demo lock.
  const enabled = canMutatePath('/admin/hq');
  /** One reconcile pass per missing locationId — avoids invalidate storms. */
  const missingReconcileRef = useRef<string | null>(null);

  const contextQuery = useQuery({
    queryKey: hqKeys.locationContext(),
    queryFn: getAdminHqLocationContext,
    enabled,
    staleTime: 30_000,
  });

  // Unscoped list — must stay complete so staff can switch parks / All.
  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list("all"),
    queryFn: () => listAdminVenueLocations({ scope: "all" }),
    enabled,
    staleTime: 30_000,
  });

  const setMutation = useMutation({
    mutationFn: (locationId: string | null) =>
      setAdminHqLocationContext(locationId),
    onSuccess: (ctx) => {
      missingReconcileRef.current = null;
      void queryClient.setQueryData(hqKeys.locationContext(), ctx);
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      // Venue list applies actorLocationScope — refresh when scope changes.
      void queryClient.invalidateQueries({
        queryKey: venueLocationKeys.all,
      });
      // Park-scoped booking/ticketing/memberships lists omit HQ id from some keys — refresh.
      invalidateTicketingQueries(queryClient);
      invalidateMembershipsQueries(queryClient);
      invalidateWaiversQueries(queryClient);
      invalidateMarketingQueries(queryClient);
      void useAuthStore.getState().silentRefresh({ force: true });
      if (orgId) {
        broadcastHqLocationContextChange({
          orgId,
          locationId: ctx.locationId,
        });
      }
    },
    onError: (err: Error) => {
      addToast(err.message || 'Could not update location scope', 'error');
      // If force-clear already marked this id, keep the marker to avoid a
      // invalidate → clear → fail retry storm (e.g. soft-hold 403).
      const mark = missingReconcileRef.current;
      if (!(typeof mark === 'string' && mark.startsWith('cleared:'))) {
        missingReconcileRef.current = null;
      }
      void queryClient.invalidateQueries({
        queryKey: hqKeys.locationContext(),
      });
    },
  });

  const activeVenues = (venuesQuery.data ?? []).filter(
    (v) => v.status === 'active'
  );
  const activeVenueIdsKey = activeVenues.map((v) => v.id).sort().join(',');
  const locationId = contextQuery.data?.locationId ?? null;

  // When the selected park is gone from the active list (archived / healed on
  // another tab), always re-GET location-context so Membership and RQ agree.
  // Do not trust a stale context.location.status === 'active' alone.
  // If one reconcile still leaves a ghost pref, force All locations (PUT null).
  useEffect(() => {
    if (!enabled) return;
    if (!locationId) {
      missingReconcileRef.current = null;
      return;
    }
    if (
      venuesQuery.isLoading ||
      venuesQuery.isFetching ||
      contextQuery.isLoading ||
      contextQuery.isFetching ||
      setMutation.isPending
    ) {
      return;
    }
    if (!venuesQuery.isSuccess || !contextQuery.isSuccess) return;

    const activeIds = activeVenueIdsKey
      ? activeVenueIdsKey.split(',')
      : [];
    if (activeIds.includes(locationId)) {
      missingReconcileRef.current = null;
      return;
    }

    if (missingReconcileRef.current === locationId) {
      // Invalidate already ran; pointer still missing from active list — clear.
      missingReconcileRef.current = `cleared:${locationId}`;
      setMutation.mutate(null);
      return;
    }
    if (missingReconcileRef.current === `cleared:${locationId}`) return;

    missingReconcileRef.current = locationId;

    void queryClient.invalidateQueries({
      queryKey: hqKeys.locationContext(),
    });
    void queryClient.invalidateQueries({ queryKey: hqKeys.all });
    void queryClient.invalidateQueries({
      queryKey: venueLocationKeys.all,
    });
    invalidateTicketingQueries(queryClient);
  }, [
    enabled,
    venuesQuery.isLoading,
    venuesQuery.isFetching,
    venuesQuery.isSuccess,
    venuesQuery.data,
    contextQuery.isLoading,
    contextQuery.isFetching,
    contextQuery.isSuccess,
    setMutation.isPending,
    setMutation,
    locationId,
    activeVenueIdsKey,
    queryClient,
  ]);

  if (!enabled) return null;

  const loadError =
    (contextQuery.error instanceof Error && contextQuery.error.message) ||
    (venuesQuery.error instanceof Error && venuesQuery.error.message) ||
    null;

  const activeIds = activeVenueIdsKey ? activeVenueIdsKey.split(',') : [];
  const value =
    locationId && activeIds.includes(locationId) ? locationId : '';
  const loading = contextQuery.isLoading || venuesQuery.isLoading;

  return (
    <div className="flex min-w-0 max-w-[12rem] flex-1 flex-col gap-0.5 sm:max-w-[18rem]">
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          htmlFor="hq-venue-switcher"
          className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-stone-500 sm:inline"
        >
          Scope
        </label>
        <select
          id="hq-venue-switcher"
          value={value}
          disabled={loading || setMutation.isPending || Boolean(loadError)}
          onChange={(e) => {
            const next = e.target.value.trim();
            const nextId = next ? next : null;
            const prevId = contextQuery.data?.locationId ?? null;
            if (nextId === prevId) return;
            setMutation.mutate(nextId);
          }}
          className="min-w-0 flex-1 truncate rounded-md border border-stone-300 bg-stone-50 px-2 py-1.5 text-xs font-medium text-stone-800 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60"
          aria-label="HQ location scope"
          aria-invalid={Boolean(loadError)}
          title={
            loadError
              ? loadError
              : contextQuery.data?.location
                ? `Scoped to ${contextQuery.data.location.name}`
                : 'All locations (company-wide)'
          }
        >
          <option value="">All locations</option>
          {activeVenues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      {loadError ? (
        <p className="truncate text-[10px] text-red-700" title={loadError}>
          Scope unavailable
        </p>
      ) : null}
    </div>
  );
}
