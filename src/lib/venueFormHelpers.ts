/**
 * Client helpers for the Venues create/edit form.
 * Slug rules mirror src/lib/venueLocations.ts normalizeVenueSlug.
 */

export function normalizeVenueSlugInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

/** Browser IANA timezone (e.g. America/Chicago). */
export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Full IANA timezone list when the runtime supports it. */
export function listIanaTimezones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") {
      return supported.call(Intl, "timeZone");
    }
  } catch {
    /* fall through */
  }
  const fallback = detectBrowserTimezone();
  return fallback ? [fallback, "UTC"] : ["UTC"];
}

export type DetectedVenuePlace = {
  city: string;
  timezone: string;
  label: string;
  /** gps = device permission; network = IP approx (no GPS permission needed). */
  source: "gps" | "network";
};

export type CitySuggestion = {
  id: string;
  label: string;
  city: string;
  /** Best-effort region/country for disambiguation. */
  detail: string;
  lat: number;
  lon: number;
};

type BigDataCloudReverse = {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
};

type PhotonFeature = {
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    city?: string;
    locality?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    type?: string;
  };
  geometry?: { coordinates?: [number, number] };
};

function pickCityName(parts: {
  city?: string;
  locality?: string;
  town?: string;
  village?: string;
  name?: string;
}): string {
  return (
    parts.city?.trim() ||
    parts.locality?.trim() ||
    parts.town?.trim() ||
    parts.village?.trim() ||
    parts.name?.trim() ||
    ""
  );
}

async function timezoneFromCoordinates(
  lat: number,
  lon: number
): Promise<string> {
  try {
    const url = `https://api.geotimezone.com/public/timezone?latitude=${encodeURIComponent(
      String(lat)
    )}&longitude=${encodeURIComponent(String(lon))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return detectBrowserTimezone();
    const data = (await res.json()) as {
      iana_timezone?: string;
      timezoneId?: string;
    };
    return (
      data.iana_timezone?.trim() ||
      data.timezoneId?.trim() ||
      detectBrowserTimezone()
    );
  } catch {
    return detectBrowserTimezone();
  }
}

async function reverseGeocodeCity(
  lat: number,
  lon: number
): Promise<{ city: string; label: string }> {
  const reverseUrl =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lon))}` +
    `&localityLanguage=en`;
  try {
    const res = await fetch(reverseUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { city: "", label: "" };
    const data = (await res.json()) as BigDataCloudReverse;
    const city = pickCityName({
      city: data.city,
      locality: data.locality,
    });
    const label = [city, data.principalSubdivision, data.countryName]
      .filter(Boolean)
      .join(", ");
    return { city, label: label || city };
  } catch {
    return { city: "", label: "" };
  }
}

/**
 * Approximate place from public IP (no browser location permission).
 * Less precise than GPS — good fallback when permission is denied.
 */
export async function detectVenuePlaceFromNetwork(): Promise<DetectedVenuePlace> {
  const res = await fetch("https://get.geojs.io/v1/ip/geo.json", {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error("Could not estimate location from your network");
  }
  const data = (await res.json()) as {
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
    latitude?: string;
    longitude?: string;
  };

  let city = (data.city || "").trim();
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  if ((!city || city === "N/A") && Number.isFinite(lat) && Number.isFinite(lon)) {
    const reversed = await reverseGeocodeCity(lat, lon);
    city = reversed.city;
  }
  if (!city || city === "N/A") {
    // Still usable — at least timezone from IP or browser.
    const timezone =
      data.timezone?.trim() ||
      (Number.isFinite(lat) && Number.isFinite(lon)
        ? await timezoneFromCoordinates(lat, lon)
        : detectBrowserTimezone());
    if (!timezone) {
      throw new Error(
        "Could not detect city. Search for a city in the list below."
      );
    }
    return {
      city: "",
      timezone,
      label: "Network timezone only",
      source: "network",
    };
  }

  const label = [city, data.region, data.country].filter(Boolean).join(", ");
  let timezone = data.timezone?.trim() || "";
  if (!timezone && Number.isFinite(lat) && Number.isFinite(lon)) {
    timezone = await timezoneFromCoordinates(lat, lon);
  }
  timezone = timezone || detectBrowserTimezone();

  return {
    city,
    timezone,
    label,
    source: "network",
  };
}

async function detectVenuePlaceFromGps(): Promise<DetectedVenuePlace> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("GPS is not available in this browser");
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12_000,
      maximumAge: 60_000,
    });
  });

  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const { city, label } = await reverseGeocodeCity(lat, lon);
  const timezone = await timezoneFromCoordinates(lat, lon);

  if (!city) {
    throw new Error(
      "Could not resolve a city from GPS. Pick a city from the list or type one."
    );
  }

  return {
    city,
    timezone: timezone || detectBrowserTimezone(),
    label: label || city,
    source: "gps",
  };
}

/**
 * Prefer device GPS; if permission is denied / unavailable, fall back to
 * network (IP) estimation so staff can still one-click fill city + timezone.
 */
export async function detectVenuePlaceFromDevice(): Promise<DetectedVenuePlace> {
  try {
    return await detectVenuePlaceFromGps();
  } catch {
    const network = await detectVenuePlaceFromNetwork();
    if (!network.city && network.timezone) {
      // Timezone-only network result — still return it; UI can keep city empty.
      return network;
    }
    if (!network.city) {
      throw new Error(
        "Location permission is off and network lookup found no city. Search for a city below."
      );
    }
    return network;
  }
}

/** Debounced city search via Photon (OpenStreetMap). */
export async function searchCities(
  query: string,
  signal?: AbortSignal
): Promise<CitySuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
    `&limit=8&lang=en&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village&osm_tag=place:municipality`;

  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("City search failed");
  const body = (await res.json()) as { features?: PhotonFeature[] };
  const features = Array.isArray(body.features) ? body.features : [];

  const seen = new Set<string>();
  const out: CitySuggestion[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lon, lat] = coords;
    const city = pickCityName({
      city: p.city,
      locality: p.locality,
      town: p.town,
      village: p.village,
      name: p.name,
    });
    if (!city) continue;
    const detail = [p.state || p.county, p.country].filter(Boolean).join(", ");
    const key = `${city.toLowerCase()}|${detail.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${p.osm_type ?? "n"}-${p.osm_id ?? `${lat},${lon}`}`,
      label: detail ? `${city} — ${detail}` : city,
      city,
      detail,
      lat,
      lon,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export async function timezoneForCitySuggestion(
  suggestion: CitySuggestion
): Promise<string> {
  return timezoneFromCoordinates(suggestion.lat, suggestion.lon);
}
