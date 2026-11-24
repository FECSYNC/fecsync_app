/**
 * Thin client for Enterprise HQ APIs.
 * Dashboard UI: HqDashboardPage + HqVenueSwitcher (Step 2–3).
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type { VenueLocationDto } from "@/services/venueLocations";
import type { BillingUsageSnapshot } from "@/services/billing";

export type HqOverviewDto = {
  orgId: string;
  plan: string | null;
  enterpriseHq: true;
  locationScope?: {
    locationId: string | null;
    locationScoped: boolean;
    companyWideView: boolean;
  };
  scopePolicy?: {
    venuesListFiltered: boolean;
    metersCompanyWide: true;
    catalogCompanyWide: true;
    membersCompanyWide: true;
    ordersCompanyWide: true;
    note: string;
  };
  venues: {
    active: number;
    archived: number;
    total: number;
    items: Array<{
      id: string;
      name: string;
      slug: string;
      status: "active" | "archived";
      city: string | null;
      timezone: string | null;
      archivedAt: string | null;
      updatedAt: string;
    }>;
  };
  usage: BillingUsageSnapshot;
  moduleHints: string[];
  modules: Array<{
    id: string;
    status: "enabled" | "not_enabled";
    note: string;
  }>;
};

export type HqLocationContextDto = {
  orgId: string;
  locationId: string | null;
  location: Pick<
    VenueLocationDto,
    "id" | "name" | "slug" | "status"
  > | null;
};

export const hqKeys = {
  all: ["admin", "hq"] as const,
  /**
   * Overview payload is scope-sensitive (venues.items). Key by preference so a
   * switcher update never reuses a stale filtered/unfiltered cache entry.
   */
  overview: (locationId: string | null = null) =>
    [...hqKeys.all, "overview", locationId ?? "all"] as const,
  locationContext: () => [...hqKeys.all, "location-context"] as const,
};

export async function getAdminHqOverview(): Promise<HqOverviewDto> {
  const raw = await api<MaybeWrapped<{ overview: HqOverviewDto }>>(
    "/api/admin/hq/overview",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.overview) throw new Error("Could not load HQ overview");
  return data.overview;
}

export async function getAdminHqLocationContext(): Promise<HqLocationContextDto> {
  const raw = await api<MaybeWrapped<{ context: HqLocationContextDto }>>(
    "/api/admin/hq/location-context",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.context) throw new Error("Could not load HQ location context");
  return data.context;
}

export async function setAdminHqLocationContext(
  locationId: string | null
): Promise<HqLocationContextDto> {
  const raw = await api<MaybeWrapped<{ context: HqLocationContextDto }>>(
    "/api/admin/hq/location-context",
    {
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ locationId }),
    }
  );
  const data = unwrap(raw);
  if (!data?.context) throw new Error("Could not set HQ location context");
  return data.context;
}
