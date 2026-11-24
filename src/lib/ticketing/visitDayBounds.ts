/**
 * Interpret YYYY-MM-DD visit filters as calendar days in a venue IANA timezone.
 * Multi-park (no location TZ): UTC midnight bounds so server locale never shifts the window.
 */
import moment from "moment-timezone";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function resolveVisitTimezone(iana: string | null | undefined): string {
  if (typeof iana === "string" && iana.length > 0 && moment.tz.zone(iana)) {
    return iana;
  }
  return "UTC";
}

function parseYmdInZone(ymd: string, timezone?: string | null): moment.Moment | null {
  const day = ymd.trim();
  if (!YMD.test(day)) return null;
  const zone = resolveVisitTimezone(timezone);
  // Format + zone (avoid boolean-strict overload ambiguity in moment-timezone types).
  const m = moment.tz(day, "YYYY-MM-DD", zone);
  if (!m.isValid()) return null;
  return m.startOf("day");
}

/** Start of calendar day (inclusive) in the given timezone. */
export function visitDayStart(ymd: string, timezone?: string | null): Date | null {
  const m = parseYmdInZone(ymd, timezone);
  return m ? m.toDate() : null;
}

/** Exclusive end = start of next calendar day in the given timezone. */
export function visitDayEndExclusive(
  ymd: string,
  timezone?: string | null
): Date | null {
  const m = parseYmdInZone(ymd, timezone);
  if (!m) return null;
  return m.clone().add(1, "day").startOf("day").toDate();
}
