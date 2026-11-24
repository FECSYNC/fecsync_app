/**
 * Decimal-only money helpers for the ledger. JS floats are converted once at
 * the boundary (shop Order, TaxSettings.rate) and never used for arithmetic.
 *
 * Browser-safe: import Decimal from the Prisma *browser* runtime only — never
 * `@prisma/client/runtime/library` (that pulls `node:module` into Turbopack
 * client chunks and stalls AdminLayout).
 */
import { Decimal } from "@prisma/client/runtime/index-browser";

export type Dec = Decimal;
export { Decimal };

export const ZERO: Dec = new Decimal(0);

export function D(value: Dec | string | number | null | undefined): Dec {
  if (value == null || value === "") return ZERO;
  // Accept browser Decimal and Prisma library Decimal (cross-runtime).
  if (value instanceof Decimal || Decimal.isDecimal(value)) return value as Dec;
  if (typeof value === "number") return fromFloatBoundary(value);
  const trimmed = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${trimmed}`);
  }
  return new Decimal(trimmed);
}

/** Float sources (shop Order, TaxSettings) — converted via the shortest round-trip string. */
export function fromFloatBoundary(value: number, dp = 4): Dec {
  if (!Number.isFinite(value)) return ZERO;
  return new Decimal(value.toString()).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Int minor units (cents) → major units. */
export function fromMinor(minor: number | null | undefined): Dec {
  if (minor == null || !Number.isFinite(minor)) return ZERO;
  return new Decimal(Math.trunc(minor)).div(100);
}

/** Major units → int minor (cents). Stripe / Connect boundary only. */
export function toMinor(value: Dec | string | number | null | undefined): number {
  return round2(D(value)).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function round2(value: Dec): Dec {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function add(...values: Array<Dec | string | number | null | undefined>): Dec {
  return values.reduce<Dec>((acc, v) => acc.add(D(v)), ZERO);
}

export function sub(a: Dec | string | number, b: Dec | string | number): Dec {
  return D(a).sub(D(b));
}

export function mul(a: Dec | string | number, b: Dec | string | number): Dec {
  return D(a).mul(D(b));
}

export function neg(a: Dec | string | number): Dec {
  return D(a).neg();
}

export function isZero(a: Dec | string | number | null | undefined): boolean {
  return round2(D(a)).isZero();
}

export function sumDecimals(values: Array<Dec | string | number | null | undefined>): Dec {
  return add(...values);
}

export function maxDec(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

export function minDec(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}

/**
 * Split `total` across `weights` so the parts (2dp) always sum exactly to
 * total (largest-remainder). Zero/negative weight sum splits evenly.
 */
export function allocateProportionally(total: Dec, weights: Dec[]): Dec[] {
  if (weights.length === 0) return [];
  const t = round2(total);
  const cents = t.mul(100).toNumber();
  const sign = cents < 0 ? -1 : 1;
  const absCents = Math.abs(Math.round(cents));
  const w = weights.map((x) => D(x).abs());
  const wSum = w.reduce((a, b) => a.add(b), ZERO);
  const raw = w.map((x) =>
    wSum.isZero() ? new Decimal(absCents).div(weights.length) : x.mul(absCents).div(wSum)
  );
  const floors = raw.map((r) => r.floor());
  let remainder = absCents - floors.reduce((a, b) => a + b.toNumber(), 0);
  const order = raw
    .map((r, i) => ({ i, frac: r.sub(r.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac));
  const out = floors.map((f) => f.toNumber());
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k]!.i] += 1;
  }
  return out.map((c) => new Decimal(c * sign).div(100));
}

export function toApiString(value: Dec | string | number | null | undefined): string {
  return round2(D(value)).toFixed(2);
}

export function toApiStringOrNull(value: Dec | null | undefined): string | null {
  return value == null ? null : toApiString(value);
}

/** Foreign → base. Caller posts any line-sum remainder to the rounding account. */
export function toFx(amount: Dec, rate: Dec | string | number): Dec {
  return round2(D(amount).mul(D(rate)));
}

/** Parse a client money string (no floats). */
export function parseMoneyInput(raw: unknown, field = "amount"): Dec {
  if (raw == null || raw === "") return ZERO;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new Error(`${field} is invalid`);
    return round2(fromFloatBoundary(raw, 2));
  }
  const s = String(raw).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) throw new Error(`${field} is invalid`);
  return new Decimal(s);
}
