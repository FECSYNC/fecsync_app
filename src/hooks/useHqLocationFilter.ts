/**
 * Keep local venue filter state synchronized with HQ preference OR park-context.
 * Enterprise HQ: uses /api/admin/hq/location-context when entitled.
 * Growth / park-locked: uses /api/admin/park-context (no Enterprise required).
 * When a park is selected → stamp that locationId.
 * When company-wide returns to All → clear sticky park.
 *
 * Consumers may read `scopedLocationName` (normalized) — do not assume HQ DTO shape
 * when the active query is park-context.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { getAdminHqLocationContext, hqKeys } from "@/services/hq";
import {
  getAdminParkContext,
  parkContextKeys,
} from "@/services/parkContext";
import { sessionIsDemoPlan } from "@/lib/demoPlanLock";

export function useHqLocationFilter(initialLocationId = "") {
  const user = useAuthStore((s) => s.user);
  const [locationId, setLocationId] = useState(initialLocationId);

  const enterpriseHq = user?.enterpriseHqEnabled === true;
  const parkLocked = user?.parkLocked === true;
  const useParkApi =
    Boolean(user?.orgId) &&
    !sessionIsDemoPlan(user) &&
    (parkLocked || !enterpriseHq);

  const hqQuery = useQuery({
    queryKey: hqKeys.locationContext(),
    queryFn: getAdminHqLocationContext,
    enabled: enterpriseHq && !parkLocked,
    staleTime: 30_000,
  });

  const parkQuery = useQuery({
    queryKey: parkContextKeys.context(),
    queryFn: getAdminParkContext,
    enabled: useParkApi,
    staleTime: 30_000,
  });

  const activeIsPark = parkLocked || useParkApi;

  const scopedLocationId = useMemo(() => {
    if (activeIsPark) {
      return (
        parkQuery.data?.effectiveLocationId ??
        (parkLocked ? user?.assignedLocationIds?.[0] ?? null : null)
      );
    }
    return hqQuery.data?.locationId ?? null;
  }, [
    activeIsPark,
    parkQuery.data?.effectiveLocationId,
    parkLocked,
    user?.assignedLocationIds,
    hqQuery.data?.locationId,
  ]);

  const scopedLocationName = useMemo(() => {
    if (activeIsPark) {
      return parkQuery.data?.effectiveLocationName ?? null;
    }
    return hqQuery.data?.location?.name ?? null;
  }, [
    activeIsPark,
    parkQuery.data?.effectiveLocationName,
    hqQuery.data?.location?.name,
  ]);

  const companyWideAll =
    enterpriseHq &&
    !parkLocked &&
    hqQuery.isSuccess &&
    !hqQuery.data?.locationId;

  const parkAll =
    useParkApi &&
    !parkLocked &&
    parkQuery.isSuccess &&
    !parkQuery.data?.effectiveLocationId;

  useEffect(() => {
    if (scopedLocationId) {
      setLocationId(scopedLocationId);
    } else if (companyWideAll || parkAll) {
      setLocationId("");
    }
  }, [scopedLocationId, companyWideAll, parkAll]);

  return {
    locationId,
    setLocationId,
    scopedLocationId,
    scopedLocationName,
    /** Active context query — HQ DTO or park DTO depending on seat. Prefer scoped* fields. */
    hqQuery: activeIsPark ? parkQuery : hqQuery,
    locationScoped: Boolean(scopedLocationId),
    parkLocked,
  };
}
