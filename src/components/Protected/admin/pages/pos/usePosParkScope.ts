/**
 * Shared park scope for POS admin pages — follows header HQ / park-context
 * preference via useHqLocationFilter and keeps local station memory in sync.
 */
"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from "@/services/venueLocations";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { useAuthStore } from "@/store/authStore";
import { parkContextKeys } from "@/services/parkContext";
import { hqKeys } from "@/services/hq";
import {
  HQ_LOCATION_CONTEXT_SYNC_KEY,
  parseHqLocationContextSync,
} from "@/utils/hqLocationContextSync";
import {
  getPosStationLocationId,
  setPosStation,
} from "./posStation";

export function usePosParkScope() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const { scopedLocationId, parkLocked } = useHqLocationFilter();
  const [locationId, setLocationIdState] = useState(() => {
    return getPosStationLocationId();
  });

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list("all"),
    queryFn: () => listAdminVenueLocations({ scope: "all" }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const venues = (venuesQuery.data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
  }));

  useEffect(() => {
    if (!venues.length) return;
    const saved = getPosStationLocationId();
    const preferred =
      (scopedLocationId && venues.some((v) => v.id === scopedLocationId)
        ? scopedLocationId
        : null) ||
      (locationId && venues.some((v) => v.id === locationId)
        ? locationId
        : null) ||
      (saved && venues.some((v) => v.id === saved) ? saved : null) ||
      venues[0]?.id ||
      "";
    if (preferred && preferred !== locationId) {
      setLocationIdState(preferred);
      setPosStation({ locationId: preferred });
    }
  }, [venues, scopedLocationId, locationId]);

  useEffect(() => {
    const bump = () => {
      void queryClient.invalidateQueries({ queryKey: venueLocationKeys.all });
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== HQ_LOCATION_CONTEXT_SYNC_KEY || !event.newValue) return;
      const payload = parseHqLocationContextSync(event.newValue);
      if (!payload || (orgId && payload.orgId !== orgId)) return;
      bump();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [queryClient, orgId]);

  function setLocationId(next: string) {
    if (!next) return;
    if (parkLocked && scopedLocationId && next !== scopedLocationId) {
      // Fail closed — park-locked seats stay on effective assigned park.
      return;
    }
    if (venues.length && !venues.some((v) => v.id === next)) return;
    setLocationIdState(next);
    setPosStation({ locationId: next });
  }

  return {
    locationId,
    setLocationId,
    venues,
    parkLocked,
    scopedLocationId,
    venuesLoading: venuesQuery.isPending || venuesQuery.isLoading,
  };
}
