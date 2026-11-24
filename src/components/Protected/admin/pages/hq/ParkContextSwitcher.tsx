'use client';

/**
 * Park context switcher — Growth multi-venue filter + park-locked seats.
 * Does NOT claim Enterprise HQ rollup. Park-locked: assigned parks only (no All).
 * Enterprise entitled non-locked seats keep HqVenueSwitcher instead.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import {
  useParkContextQuery,
  useSetParkContextMutation,
} from '@/hooks/useParkContext';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useAuthStore } from '@/store/authStore';
import { parkContextKeys } from '@/services/parkContext';
import { useQueryClient } from '@tanstack/react-query';

export default function ParkContextSwitcher() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const sessionParkLocked = user?.parkLocked === true;
  const missingReconcileRef = useRef<string | null>(null);

  const contextQuery = useParkContextQuery(true);
  const parkLocked =
    contextQuery.data?.parkLocked === true || sessionParkLocked;
  const companyWideView =
    contextQuery.data?.companyWideView === true ||
    user?.companyWideView !== false;

  // Unscoped list for CWV multi-venue filter; park-locked uses assignedLocations.
  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: Boolean(user?.orgId) && !parkLocked && companyWideView,
    staleTime: 30_000,
  });

  const setMutation = useSetParkContextMutation();

  const assignedVenues = useMemo(
    () =>
      (contextQuery.data?.assignedLocations ?? []).filter(
        (v) => v.status === 'active'
      ),
    [contextQuery.data?.assignedLocations]
  );

  const activeVenues = useMemo(() => {
    if (parkLocked) return assignedVenues;
    return (venuesQuery.data ?? []).filter((v) => v.status === 'active');
  }, [parkLocked, assignedVenues, venuesQuery.data]);

  const activeVenueIdsKey = activeVenues.map((v) => v.id).sort().join(',');
  const locationId =
    contextQuery.data?.effectiveLocationId ??
    contextQuery.data?.hqSelectedLocationId ??
    null;

  useEffect(() => {
    if (!contextQuery.isSuccess) return;
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

    const activeIds = activeVenueIdsKey ? activeVenueIdsKey.split(',') : [];
    if (activeIds.length === 0) return;
    if (activeIds.includes(locationId)) {
      missingReconcileRef.current = null;
      return;
    }

    if (parkLocked) {
      // Heal to first assigned park — never All.
      const fallback = activeIds[0] ?? null;
      if (fallback && missingReconcileRef.current !== `cleared:${locationId}`) {
        missingReconcileRef.current = `cleared:${locationId}`;
        setMutation.mutate(fallback, {
          onError: (err: Error) => {
            addToast(err.message || 'Could not update park scope', 'error');
            missingReconcileRef.current = null;
          },
        });
      }
      return;
    }

    if (missingReconcileRef.current === locationId) {
      missingReconcileRef.current = `cleared:${locationId}`;
      setMutation.mutate(null);
      return;
    }
    if (missingReconcileRef.current === `cleared:${locationId}`) return;

    missingReconcileRef.current = locationId;
    void queryClient.invalidateQueries({
      queryKey: parkContextKeys.context(),
    });
  }, [
    parkLocked,
    venuesQuery.isLoading,
    venuesQuery.isFetching,
    contextQuery.isLoading,
    contextQuery.isFetching,
    contextQuery.isSuccess,
    setMutation.isPending,
    setMutation,
    locationId,
    activeVenueIdsKey,
    queryClient,
    addToast,
  ]);

  const loadError =
    (contextQuery.error instanceof Error && contextQuery.error.message) ||
    (!parkLocked &&
      venuesQuery.error instanceof Error &&
      venuesQuery.error.message) ||
    null;

  const showSwitcher =
    parkLocked ||
    (companyWideView && activeVenues.length > 1) ||
    Boolean(locationId && contextQuery.data?.effectiveLocationName);

  if (!showSwitcher && !contextQuery.isLoading) return null;

  const activeIds = activeVenueIdsKey ? activeVenueIdsKey.split(',') : [];
  const value =
    locationId && activeIds.includes(locationId) ? locationId : '';
  const loading =
    contextQuery.isLoading || (!parkLocked && venuesQuery.isLoading);
  const indicatorName =
    contextQuery.data?.effectiveLocationName ??
    activeVenues.find((v) => v.id === locationId)?.name ??
    null;

  // Single assigned park — indicator only (no false "All").
  if (parkLocked && activeVenues.length <= 1) {
    const name =
      indicatorName || activeVenues[0]?.name || 'Assigned park';
    return (
      <div className="flex min-w-0 max-w-[14rem] flex-1 flex-col gap-0.5 sm:max-w-[18rem]">
        <p
          className="truncate rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs font-medium text-stone-800"
          title={`Managing: ${name}`}
        >
          <span className="text-stone-500">Managing:</span> {name}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 max-w-[12rem] flex-1 flex-col gap-0.5 sm:max-w-[18rem]">
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          htmlFor="park-context-switcher"
          className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-stone-500 sm:inline"
        >
          {parkLocked ? 'Park' : 'Filter'}
        </label>
        <select
          id="park-context-switcher"
          value={value}
          disabled={loading || setMutation.isPending || Boolean(loadError)}
          onChange={(e) => {
            const next = e.target.value.trim();
            const nextId = next ? next : null;
            if (parkLocked && !nextId) return;
            const prevId = locationId;
            if (nextId === prevId) return;
            setMutation.mutate(nextId, {
              onError: (err: Error) => {
                addToast(err.message || 'Could not update park scope', 'error');
              },
            });
          }}
          className="min-w-0 flex-1 truncate rounded-md border border-stone-300 bg-stone-50 px-2 py-1.5 text-xs font-medium text-stone-800 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60"
          aria-label={parkLocked ? 'Park assignment scope' : 'Park filter'}
          aria-invalid={Boolean(loadError)}
          title={
            loadError
              ? loadError
              : parkLocked
                ? indicatorName
                  ? `Managing: ${indicatorName}`
                  : 'Assigned parks only'
                : indicatorName
                  ? `Filtered to ${indicatorName}`
                  : 'All parks (filter — not HQ rollup)'
          }
        >
          {!parkLocked ? <option value="">All parks</option> : null}
          {activeVenues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      {indicatorName && parkLocked ? (
        <p className="truncate text-[10px] text-stone-500" title={indicatorName}>
          Managing: {indicatorName}
        </p>
      ) : null}
      {loadError ? (
        <p className="truncate text-[10px] text-red-700" title={loadError}>
          Park scope unavailable
        </p>
      ) : null}
    </div>
  );
}
