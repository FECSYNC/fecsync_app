import type { CartLike } from "@/lib/orderFulfillment";
import { getCartLines } from "@/lib/orderFulfillment";
import type { ParcelDimensions, ParcelSpec, ShippingSettings } from "./types";

export const DEFAULT_PARCEL_WEIGHT_KG = 1.0;

export const DEFAULT_PARCEL_DIMENSIONS: ParcelDimensions = {
  length: 30,
  width: 25,
  height: 5,
};

export function normalizeParcelDimensions(
  value: unknown
): ParcelDimensions {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_PARCEL_DIMENSIONS };
  }
  const raw = value as Record<string, unknown>;
  const length = Number(raw.length);
  const width = Number(raw.width);
  const height = Number(raw.height);
  return {
    length: Number.isFinite(length) && length > 0 ? length : DEFAULT_PARCEL_DIMENSIONS.length,
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_PARCEL_DIMENSIONS.width,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_PARCEL_DIMENSIONS.height,
  };
}

export function normalizeWeightKg(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PARCEL_WEIGHT_KG;
  return n;
}

/**
 * Derive parcel weight/dims from cart + org shipping settings.
 * Uses defaultWeightKg + defaultDimensions; bumps weight by extra line quantity.
 */
export function computeParcelFromCart(
  cart: CartLike,
  settings: Pick<ShippingSettings, "defaultWeightKg" | "defaultDimensions">
): ParcelSpec {
  const lines = getCartLines(cart);
  const qtySum = lines.reduce((sum, line) => {
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    return sum + qty;
  }, 0);
  const extraUnits = Math.max(0, qtySum - 1);
  // ~150g per additional unit beyond the first — sensible for apparel/fabric.
  const weightKg = normalizeWeightKg(
    settings.defaultWeightKg + extraUnits * 0.15
  );
  const dims = normalizeParcelDimensions(settings.defaultDimensions);
  return {
    weightKg,
    length: dims.length,
    width: dims.width,
    height: dims.height,
  };
}
