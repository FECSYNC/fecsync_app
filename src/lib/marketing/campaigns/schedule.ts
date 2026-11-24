/**
 * Timezone-aware schedule math for newsletter campaigns (pure, no DB).
 */

export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** UTC instant for a wall-clock time in `timeZone` (month is 0-based). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month, day, hour, 0, 0);
  const first = offsetMs(new Date(guess), timeZone);
  let utc = guess - first;
  const second = offsetMs(new Date(utc), timeZone);
  if (second !== first) utc = guess - second;
  return new Date(utc);
}

export function monthlyWindowKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Next monthly send strictly after `after`.
 * Returns the UTC instant and the "YYYY-MM" issue key of that local month.
 */
export function nextMonthlyRun(input: {
  after: Date;
  dayOfMonth: number;
  sendHour: number;
  timezone: string;
}): { runAt: Date; windowKey: string } {
  const day = Math.max(1, Math.min(Math.trunc(input.dayOfMonth), 28));
  const hour = Math.max(0, Math.min(Math.trunc(input.sendHour), 23));
  const local = localParts(input.after, input.timezone);
  let year = local.year;
  let month = local.month;
  for (let i = 0; i < 3; i += 1) {
    const runAt = zonedTimeToUtc(year, month, day, hour, input.timezone);
    if (runAt.getTime() > input.after.getTime()) {
      return { runAt, windowKey: monthlyWindowKey(year, month) };
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  const runAt = zonedTimeToUtc(year, month, day, hour, input.timezone);
  return { runAt, windowKey: monthlyWindowKey(year, month) };
}

/** "November" for the local month of `date` in `timeZone`. */
export function localMonthName(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(date);
}

/** Month name for a "YYYY-MM" issue key (falls back to the current month). */
export function monthNameForWindow(windowKey: string | null, timeZone: string): string {
  const m = windowKey?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return localMonthName(new Date(), timeZone);
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15, 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(date);
}

export function formatEventWhen(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
