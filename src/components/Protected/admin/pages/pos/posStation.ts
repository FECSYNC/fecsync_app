const LOCATION_KEY = "harewa.pos.station.locationId";
const DEVICE_KEY = "harewa.pos.station.deviceId";
const VENUES_CACHE_KEY = "harewa.pos.venues.cache";

export type PosStation = {
  locationId: string;
  deviceId: string;
};

export function getPosStation(): PosStation | null {
  if (typeof window === "undefined") return null;
  const locationId = localStorage.getItem(LOCATION_KEY)?.trim() ?? "";
  const deviceId = localStorage.getItem(DEVICE_KEY)?.trim() ?? "";
  if (!locationId || !deviceId) return null;
  return { locationId, deviceId };
}

/** Park alone — Check-in / Capacity / Tabs do not need a till device. */
export function getPosStationLocationId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LOCATION_KEY)?.trim() ?? "";
}

export function setPosStation(station: Partial<PosStation>) {
  if (typeof window === "undefined") return;
  if (station.locationId != null) {
    const loc = station.locationId.trim();
    if (loc) localStorage.setItem(LOCATION_KEY, loc);
    else localStorage.removeItem(LOCATION_KEY);
  }
  if (station.deviceId != null) {
    const device = station.deviceId.trim();
    // Never persist an empty device id — that made getPosStation() fail while
    // leaving a stale prior device that resumed on the wrong park after reload.
    if (device) localStorage.setItem(DEVICE_KEY, device);
    else localStorage.removeItem(DEVICE_KEY);
  }
}

/** Stale-while-revalidate park names so dropdowns are not empty during slow venue API. */
export function getCachedPosVenues(): Array<{ id: string; name: string }> {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(VENUES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is { id: string; name: string } =>
        Boolean(v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string")
    );
  } catch {
    return [];
  }
}

export function setCachedPosVenues(venues: Array<{ id: string; name: string }>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(VENUES_CACHE_KEY, JSON.stringify(venues.slice(0, 50)));
  } catch {
    /* ignore quota */
  }
}

export function clearPosStationDevice() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DEVICE_KEY);
}

export { LOCATION_KEY, DEVICE_KEY };
