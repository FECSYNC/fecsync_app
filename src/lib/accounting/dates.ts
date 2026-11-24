/**
 * Accounting calendar helpers in the org accounting timezone (IANA, DST safe).
 */
import moment from "moment-timezone";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function resolveTz(tz: string | null | undefined): string {
  return typeof tz === "string" && tz && moment.tz.zone(tz) ? tz : "UTC";
}

export function isValidTimezone(tz: string): boolean {
  return Boolean(moment.tz.zone(tz));
}

/** Start of a local calendar day as a UTC instant. */
export function localDayStart(ymd: string, tz: string): Date {
  if (!YMD.test(ymd)) throw new Error(`Invalid date: ${ymd}`);
  const m = moment.tz(ymd, "YYYY-MM-DD", resolveTz(tz));
  if (!m.isValid()) throw new Error(`Invalid date: ${ymd}`);
  return m.startOf("day").toDate();
}

/** Last millisecond of a local calendar day. */
export function localDayEnd(ymd: string, tz: string): Date {
  return new Date(
    moment.tz(ymd, "YYYY-MM-DD", resolveTz(tz)).add(1, "day").startOf("day").valueOf() - 1
  );
}

export function toLocalYmd(date: Date, tz: string): string {
  return moment(date).tz(resolveTz(tz)).format("YYYY-MM-DD");
}

/** Start of month `month` (1-12) of `year` in tz. */
export function localMonthStart(year: number, month: number, tz: string): Date {
  return moment
    .tz({ year, month: month - 1, day: 1 }, resolveTz(tz))
    .startOf("day")
    .toDate();
}

export function addLocalDays(date: Date, days: number, tz: string): Date {
  return moment(date).tz(resolveTz(tz)).add(days, "days").toDate();
}

export function parseYmdOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().slice(0, 10);
  return YMD.test(v) ? v : null;
}

/**
 * Parse a client date (YYYY-MM-DD → local day start, or ISO instant).
 */
export function parseDateInput(raw: unknown, tz: string, field = "date"): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${field} is required`);
  const v = raw.trim();
  if (YMD.test(v)) return localDayStart(v, tz);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is invalid`);
  return d;
}

export function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}
