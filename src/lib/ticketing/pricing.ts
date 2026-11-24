/**
 * Pricing helpers for admission products (catalog).
 * Booking tax/total uses `previewBookingTax` (same TaxSettings percent as shop).
 */
import type { PriceBandInput } from "@/lib/ticketing/products";

export function lowestPriceFromBands(
  prices: Array<{ amount: number }>
): number | null {
  if (!prices.length) return null;
  return Math.min(...prices.map((p) => p.amount));
}

function parseOptionalBandDate(
  raw: string | null | undefined,
  label: string
): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label}`);
  }
  return d;
}

export function validatePriceBands(prices: PriceBandInput[]): void {
  if (!prices.length) throw new Error("At least one price band is required");
  const codes = new Set<string>();
  for (const p of prices) {
    if (!p || typeof p !== "object") {
      throw new Error("Each price band must be an object");
    }
    if (!p.code?.trim()) throw new Error("Price band code is required");
    const code = p.code.trim().toLowerCase();
    if (codes.has(code)) {
      throw new Error(`Duplicate price band code "${code}"`);
    }
    codes.add(code);
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Price amount must be greater than 0");
    }
    if (
      p.minAge != null &&
      p.maxAge != null &&
      Number(p.minAge) > Number(p.maxAge)
    ) {
      throw new Error("minAge cannot exceed maxAge");
    }
    const validFrom = parseOptionalBandDate(p.validFrom, "validFrom");
    const validTo = parseOptionalBandDate(p.validTo, "validTo");
    if (validFrom && validTo && validTo < validFrom) {
      throw new Error("validTo cannot be before validFrom");
    }
  }
}

export function lineSubtotal(unitPrice: number, qty: number): number {
  return Math.round(unitPrice * qty * 100) / 100;
}
