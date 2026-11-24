/**
 * Shared 12-hour (AM/PM) vs 24-hour clock helpers for booking / ticketing.
 * Native datetime-local and time inputs follow the OS locale and cannot honor
 * this setting — use ClockTimeInput / ClockDateTimeInput for pickers.
 */

export const TIME_CLOCK_FORMATS = ["twelve_hour", "twenty_four_hour"] as const;
export type TimeClockFormat = (typeof TIME_CLOCK_FORMATS)[number];
export const DEFAULT_TIME_CLOCK_FORMAT: TimeClockFormat = "twelve_hour";

export function normalizeTimeClockFormat(
  value: unknown
): TimeClockFormat {
  return value === "twenty_four_hour" ? "twenty_four_hour" : "twelve_hour";
}

export function isHour12(format?: string | null): boolean {
  return normalizeTimeClockFormat(format) === "twelve_hour";
}

export function parseClockDate(
  value: Date | string | null | undefined
): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clockTimeOpts(
  timeFormat?: string | null,
  timeZone?: string | null
): Intl.DateTimeFormatOptions {
  const hour12 = isHour12(timeFormat);
  return {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
    ...(timeZone ? { timeZone } : {}),
  };
}

export function formatClockTime(
  value: Date | string | null | undefined,
  timeFormat?: string | null,
  timeZone?: string | null
): string {
  const d = parseClockDate(value);
  if (!d) return "—";
  const opts = clockTimeOpts(timeFormat, timeZone);
  try {
    return d.toLocaleTimeString(undefined, opts);
  } catch {
    const { timeZone: _tz, ...rest } = opts;
    return d.toLocaleTimeString(undefined, rest);
  }
}

export function formatClockDateTime(
  value: Date | string | null | undefined,
  timeFormat?: string | null,
  timeZone?: string | null,
  extra?: Intl.DateTimeFormatOptions
): string {
  const d = parseClockDate(value);
  if (!d) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...clockTimeOpts(timeFormat, timeZone),
    ...extra,
  };
  try {
    return d.toLocaleString(undefined, opts);
  } catch {
    const { timeZone: _tz, ...rest } = opts;
    return d.toLocaleString(undefined, rest);
  }
}

export function formatClockTimeRange(
  start: Date | string | null | undefined,
  end?: Date | string | null,
  timeFormat?: string | null,
  timeZone?: string | null
): string {
  const startText = formatClockDateTime(start, timeFormat, timeZone);
  if (!end) return startText;
  const endDate = parseClockDate(end);
  const startDate = parseClockDate(start);
  if (!endDate || !startDate) return startText;
  const sameDay =
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate();
  const endText = sameDay
    ? formatClockTime(end, timeFormat, timeZone)
    : formatClockDateTime(end, timeFormat, timeZone);
  return `${startText} – ${endText}`;
}

/** Parse `HH:mm` or `HH:mm:ss` (24-hour). */
export function parseHm(
  value: string | null | undefined
): { hours: number; minutes: number } | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hours, minutes };
}

export function formatHm(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function splitDateTimeLocal(value: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  const [date = "", timePart = ""] = value.split("T");
  const parsed = parseHm(timePart);
  return {
    date,
    time: parsed ? formatHm(parsed.hours, parsed.minutes) : timePart.slice(0, 5),
  };
}

export function joinDateTimeLocal(date: string, time: string): string {
  if (!date) return "";
  const parsed = parseHm(time);
  return `${date}T${parsed ? formatHm(parsed.hours, parsed.minutes) : time || "00:00"}`;
}
