/**
 * Thin client for park-context APIs (Growth park filter + park-locked seats).
 * Works without Enterprise HQ entitlement. Header: ParkContextSwitcher.
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type ParkContextAssignedLocation = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type ParkContextDto = {
  orgId: string;
  parkLocked: boolean;
  companyWideView: boolean;
  enterpriseHqEnabled: boolean;
  effectiveLocationId: string | null;
  assignedLocations: ParkContextAssignedLocation[];
  hqSelectedLocationId: string | null;
  effectiveLocationName: string | null;
};

export const parkContextKeys = {
  all: ["admin", "park-context"] as const,
  context: () => [...parkContextKeys.all, "current"] as const,
};

export async function getAdminParkContext(): Promise<ParkContextDto> {
  const raw = await api<MaybeWrapped<{ context: ParkContextDto }>>(
    "/api/admin/park-context",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.context) throw new Error("Could not load park context");
  return data.context;
}

export async function setAdminParkContext(
  locationId: string | null
): Promise<ParkContextDto> {
  const raw = await api<MaybeWrapped<{ context: ParkContextDto }>>(
    "/api/admin/park-context",
    {
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ locationId }),
    }
  );
  const data = unwrap(raw);
  if (!data?.context) throw new Error("Could not set park context");
  return data.context;
}
