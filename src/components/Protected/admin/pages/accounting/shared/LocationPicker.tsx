"use client";

import { useEffect } from "react";
import { useAccountingLookupsQuery } from "@/hooks/useAccounting";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";

type VenueOpt = { id: string; name: string; archived?: boolean };

export default function LocationPicker({
  value,
  onChange,
  label = "Location",
  allowCompanyWide = true,
  hideArchived = true,
  disabled,
  className = "",
  syncHqPreference = false,
}: {
  value: string;
  onChange: (locationId: string) => void;
  label?: string;
  allowCompanyWide?: boolean;
  hideArchived?: boolean;
  disabled?: boolean;
  className?: string;
  /** When true, seed from HQ/park context and lock if park-locked. */
  syncHqPreference?: boolean;
}) {
  const hq = useHqLocationFilter(value);
  const lookups = useAccountingLookupsQuery(!disabled);
  const venues = (
    ((lookups.data as { venues?: VenueOpt[] } | undefined)?.venues ??
      []) as VenueOpt[]
  ).filter((v) => (hideArchived ? !v.archived : true));

  const effectiveDisabled = disabled || hq.parkLocked;
  const selectValue =
    hq.parkLocked && hq.scopedLocationId
      ? hq.scopedLocationId
      : syncHqPreference && hq.parkLocked
        ? hq.scopedLocationId ?? value
        : value;

  // Park-locked seats must submit a real locationId — seed parent state (select
  // alone showing scopedLocationId is not enough when value stays "").
  useEffect(() => {
    if (!hq.parkLocked || !hq.scopedLocationId) return;
    if (value === hq.scopedLocationId) return;
    onChange(hq.scopedLocationId);
    if (syncHqPreference) hq.setLocationId(hq.scopedLocationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once when scope resolves
  }, [hq.parkLocked, hq.scopedLocationId, value]);

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <select
        value={selectValue}
        disabled={effectiveDisabled || lookups.isLoading}
        onChange={(e) => {
          onChange(e.target.value);
          if (syncHqPreference) hq.setLocationId(e.target.value);
        }}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-gray-50"
      >
        {allowCompanyWide && !hq.parkLocked ? (
          <option value="">Company-wide</option>
        ) : null}
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      {hq.parkLocked ? (
        <p className="mt-1 text-xs text-gray-500">
          Park-locked seat — scoped to {hq.scopedLocationName ?? "assigned park"}.
        </p>
      ) : null}
    </label>
  );
}
