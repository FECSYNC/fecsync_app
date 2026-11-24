import {
  calculateTaxBreakdown,
  parseOptionalTaxRate,
  type TaxBreakdown,
  type TaxSettingsLike,
  type TaxableLineInput,
} from '@/utils/tax';
import {
  dedupeCartLines,
  getCartLineSubtotal,
} from '@/utils/cartDisplay';
import type { CartLine } from '@/store/cartStore';

export function cartLinesToTaxableInputs(items: CartLine[]): TaxableLineInput[] {
  return dedupeCartLines(items).map((item) => ({
    subtotal: getCartLineSubtotal(item),
    taxExempt: Boolean(item.taxExempt),
    taxRate: parseOptionalTaxRate(item.taxRate),
  }));
}

export function estimateCartTaxBreakdown(
  items: CartLine[],
  settings: TaxSettingsLike,
  shipping = 0
): TaxBreakdown {
  return calculateTaxBreakdown(
    cartLinesToTaxableInputs(items),
    settings,
    shipping
  );
}
