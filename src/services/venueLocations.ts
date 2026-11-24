import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type VenueLocationDto = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: string;
  archivedAt?: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string | null;
  publicBookingEnabled?: boolean;
  isFranchise?: boolean;
  franchiseDisplayName?: string | null;
  franchiseSupportPhone?: string | null;
  franchiseSupportEmail?: string | null;
  franchiseCode?: string | null;
  franchiseNotes?: string | null;
  /** Organization.slug for public `/book/{orgSlug}/{venueSlug}`. */
  orgSlug?: string | null;
  createdAt: string;
  updatedAt: string;
};

const BASE = "/api/admin/venue-locations";

export type VenueListScope = "hq" | "all";

export const venueLocationKeys = {
  all: ["admin", "venue-locations"] as const,
  /**
   * Venues console list. When scope is `hq`, key by locationId so switcher
   * updates never reuse a stale filtered/unfiltered cache entry.
   */
  list: (scope: VenueListScope = "hq", locationId: string | null = null) =>
    scope === "all"
      ? ([...venueLocationKeys.all, "list", "all"] as const)
      : ([
          ...venueLocationKeys.all,
          "list",
          "hq",
          locationId ?? "all",
        ] as const),
  detail: (id: string) => [...venueLocationKeys.all, "detail", id] as const,
};

export async function listAdminVenueLocations(
  options?: { scope?: VenueListScope }
): Promise<VenueLocationDto[]> {
  const scope = options?.scope ?? "hq";
  const qs = scope === "all" ? "?scope=all" : "";
  const raw = await api<MaybeWrapped<{ venues?: VenueLocationDto[] }>>(
    `${BASE}${qs}`,
    {
      method: "GET",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.venues) ? data.venues : [];
}

export async function getAdminVenueLocation(
  id: string
): Promise<VenueLocationDto> {
  const raw = await api<MaybeWrapped<{ venue: VenueLocationDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.venue) throw new Error("Could not load venue");
  return data.venue;
}

export async function createAdminVenueLocation(payload: {
  name: string;
  slug?: string;
  city?: string | null;
  timezone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  isFranchise?: boolean;
  franchiseDisplayName?: string | null;
  franchiseSupportPhone?: string | null;
  franchiseSupportEmail?: string | null;
  franchiseCode?: string | null;
  franchiseNotes?: string | null;
}): Promise<VenueLocationDto> {
  const raw = await api<MaybeWrapped<{ venue: VenueLocationDto }>>(BASE, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = unwrap(raw);
  if (!data?.venue) throw new Error("Could not create venue");
  return data.venue;
}

export async function updateAdminVenueLocation(
  id: string,
  payload: {
    name?: string;
    slug?: string;
    city?: string | null;
    timezone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
    publicBookingEnabled?: boolean;
    isFranchise?: boolean;
    franchiseDisplayName?: string | null;
    franchiseSupportPhone?: string | null;
    franchiseSupportEmail?: string | null;
    franchiseCode?: string | null;
    franchiseNotes?: string | null;
  }
): Promise<VenueLocationDto> {
  const raw = await api<MaybeWrapped<{ venue: VenueLocationDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.venue) throw new Error("Could not update venue");
  return data.venue;
}

export async function archiveAdminVenueLocation(
  id: string
): Promise<VenueLocationDto> {
  const raw = await api<MaybeWrapped<{ venue: VenueLocationDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.venue) throw new Error("Could not archive venue");
  return data.venue;
}

export async function reactivateAdminVenueLocation(
  id: string
): Promise<VenueLocationDto> {
  const raw = await api<MaybeWrapped<{ venue: VenueLocationDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ action: "reactivate" }),
    }
  );
  const data = unwrap(raw);
  if (!data?.venue) throw new Error("Could not reactivate venue");
  return data.venue;
}
