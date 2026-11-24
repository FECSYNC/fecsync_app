/**
 * Flexible cycle helpers for MembershipPlan intervalCount + intervalUnit.
 */
import type { MembershipIntervalUnit } from "@prisma/client";

export function addMembershipCycle(
  from: Date,
  intervalCount: number,
  intervalUnit: MembershipIntervalUnit
): Date {
  const d = new Date(from.getTime());
  const n = Math.max(1, Math.floor(intervalCount));
  switch (intervalUnit) {
    case "day":
      d.setUTCDate(d.getUTCDate() + n);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + n * 7);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + n);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + n);
      break;
    default:
      d.setUTCMonth(d.getUTCMonth() + n);
  }
  return d;
}

/** Approximate period length in ms (for proration). */
export function cycleLengthMs(
  intervalCount: number,
  intervalUnit: MembershipIntervalUnit
): number {
  const n = Math.max(1, Math.floor(intervalCount));
  const day = 86_400_000;
  switch (intervalUnit) {
    case "day":
      return n * day;
    case "week":
      return n * 7 * day;
    case "month":
      return n * 30 * day;
    case "year":
      return n * 365 * day;
    default:
      return n * 30 * day;
  }
}

export function stripeIntervalFromUnit(
  unit: MembershipIntervalUnit
): "day" | "week" | "month" | "year" {
  return unit;
}
