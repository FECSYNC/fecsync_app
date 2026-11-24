/**
 * Waiver expiry math. Venue timezone applies to visit and calendar_year.
 * `days` is signedAt + N × 24h (deterministic). `never` has no expiresAt.
 */

export type WaiverExpiryRuleName =
  | "never"
  | "days"
  | "calendar_year"
  | "visit"
  | "until_date";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** UTC instant whose wall clock in `timeZone` matches the given parts. */
export function zonedTimeToUtc(
  parts: ZonedParts,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const asIfUtc = new Date(utcGuess);
  const got = zonedParts(asIfUtc, timeZone);
  const gotUtc = Date.UTC(
    got.year,
    got.month - 1,
    got.day,
    got.hour,
    got.minute,
    got.second
  );
  const offset = gotUtc - utcGuess;
  return new Date(utcGuess - offset);
}

export function isSameVenueDay(
  a: Date,
  b: Date,
  timeZone: string
): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

export function endOfVenueDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 23, minute: 59, second: 59 },
    timeZone
  );
}

export function endOfVenueYear(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
    timeZone
  );
}

export function computeWaiverExpiresAt(input: {
  rule: WaiverExpiryRuleName;
  signedAt: Date;
  expiryDays?: number | null;
  untilDate?: Date | null;
  timeZone: string;
}): Date | null {
  const tz = input.timeZone || "UTC";
  switch (input.rule) {
    case "never":
      return null;
    case "days": {
      const days = input.expiryDays ?? 0;
      if (!Number.isFinite(days) || days < 1) {
        throw new Error("expiryDays is required when the expiry rule is days");
      }
      return new Date(input.signedAt.getTime() + days * 86_400_000);
    }
    case "calendar_year":
      return endOfVenueYear(input.signedAt, tz);
    case "visit":
      return endOfVenueDay(input.signedAt, tz);
    case "until_date":
      return input.untilDate ?? null;
    default:
      return null;
  }
}

export function isSignedWaiverCurrentlyValid(input: {
  rule: WaiverExpiryRuleName;
  signedAt: Date;
  expiresAt: Date | null;
  now: Date;
  timeZone: string;
}): boolean {
  if (input.rule === "visit") {
    if (input.expiresAt) return input.now.getTime() <= input.expiresAt.getTime();
    return isSameVenueDay(input.signedAt, input.now, input.timeZone || "UTC");
  }
  if (input.rule === "never") return true;
  if (!input.expiresAt) return input.rule !== "until_date";
  return input.now.getTime() <= input.expiresAt.getTime();
}
