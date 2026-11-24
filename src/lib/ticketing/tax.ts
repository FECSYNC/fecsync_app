/**
 * Booking tax — same TaxSettings rate semantics as shop (`rate` is percent 0–100).
 */
import { getOrCreateTaxSettings } from "@/lib/taxSettings";
import { normalizeTaxRate } from "@/utils/tax";

export type BookingTaxPreview = {
  enabled: boolean;
  rate: number;
  label: string;
  taxExempt: boolean;
  taxAmount: number;
  total: number;
};

/**
 * Preview tax on a booking subtotal. Honors booking tax-exempt flag.
 * Rate matches shop: percent (e.g. 7.5), applied as rate/100.
 */
export async function previewBookingTax(opts: {
  orgId: string;
  subtotal: number;
  taxExempt?: boolean;
}): Promise<BookingTaxPreview> {
  const settings = await getOrCreateTaxSettings(opts.orgId);
  const enabled = Boolean(settings?.enabled);
  const rate = enabled ? normalizeTaxRate(settings?.rate ?? 0) : 0;
  const label = settings?.label ?? "Tax";
  const taxExempt = Boolean(opts.taxExempt);
  const subtotal = Math.round(Number(opts.subtotal || 0) * 100) / 100;
  const taxAmount =
    !enabled || taxExempt || rate <= 0
      ? 0
      : Math.round(subtotal * (rate / 100) * 100) / 100;
  return {
    enabled,
    rate,
    label,
    taxExempt,
    taxAmount,
    total: Math.round((subtotal + taxAmount) * 100) / 100,
  };
}
