/**
 * Optional park stamp for food/fashion Product create/edit.
 * Park-locked actors only see assigned venues; company-wide may leave shared (null).
 */
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from "@/services/venueLocations";
import { adminListQueryDefaults } from "@/lib/adminListCache";
import { withAdminListSnapshot } from "@/lib/adminListSnapshot";
import { isStorefrontOrgSession } from "@/services/auth";
import { P } from "@/lib/auth/permissions";

type Props = {
  value: string;
  onChange: (venueLocationId: string) => void;
  disabled?: boolean;
  /** When true, empty option = company-shared (CWV only). */
  allowShared?: boolean;
};

export default function ProductVenueField({
  value,
  onChange,
  disabled,
  allowShared = true,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const parkLocked = user?.parkLocked === true;
  const canLoad =
    Boolean(user?.orgId) &&
    !isStorefrontOrgSession(user) &&
    (can(P.SettingsManage) || can(P.VenuesRead) || can(P.ProductsWrite) || can(P.ProductsRead));

  const venuesKey = venueLocationKeys.list("all");
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: "all" }),
    enabled: canLoad,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
  });

  const options = useMemo(() => {
    const rows = (venuesQuery.data ?? []).filter((v) => v.status === "active");
    if (!parkLocked) return rows;
    const assigned = new Set(user?.assignedLocationIds ?? []);
    return rows.filter((v) => assigned.has(v.id));
  }, [venuesQuery.data, parkLocked, user?.assignedLocationIds]);

  const showShared = allowShared && !parkLocked;

  return (
    <div>
      <label className="mb-3 block text-base font-medium text-gray-700">
        Park / venue
      </label>
      <select
        name="venueLocationId"
        value={value}
        disabled={disabled || venuesQuery.isLoading}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
      >
        {showShared ? (
          <option value="">Company-shared (all parks)</option>
        ) : (
          <option value="">Select a park…</option>
        )}
        {options.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-gray-500">
        {parkLocked
          ? "Park-locked seats must stamp an assigned park."
          : "Leave company-shared for catalog visible only to company-wide staff; park admins only see stamped parks."}
      </p>
    </div>
  );
}
