/**
 * Shared tax math for client and server.
 * Prices are tax-exclusive: tax is added at checkout.
 *
 * Resolution order per line:
 * 1. taxExempt → 0%
 * 2. explicit taxRate on product/fabric → that %
 * 3. org TaxSettings when enabled → settings.rate (storefront/default org)
 * 4. otherwise → 0%
 */

export type TaxSettingsLike = {
  enabled: boolean;
  rate: number;
  label?: string;
};

export type TaxableLineInput = {
  /** Pre-tax line total (price × qty) */
  subtotal: number;
  taxExempt?: boolean;
  /** Override %; null/undefined inherits org TaxSettings */
  taxRate?: number | null;
};

export type TaxBreakdown = {
  subtotal: number;
  taxAmount: number;
  shipping: number;
  total: number;
  /** Blended display rate when useful; 0 if no taxable amount */
  effectiveRate: number;
  label: string;
};

export const DEFAULT_TAX_LABEL = 'Tax';

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeTaxRate(rate: unknown): number {
  const n = Number(rate);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Parse cart/API taxRate into number | null (inherit). */
export function parseOptionalTaxRate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return normalizeTaxRate(n);
}

/** Resolve the % applied to a single line. */
export function resolveLineTaxRate(
  line: Pick<TaxableLineInput, 'taxExempt' | 'taxRate'>,
  settings: TaxSettingsLike
): number {
  if (line.taxExempt) return 0;

  if (line.taxRate !== null && line.taxRate !== undefined) {
    const override = Number(line.taxRate);
    if (Number.isFinite(override)) {
      return normalizeTaxRate(override);
    }
  }

  if (!settings.enabled) return 0;
  return normalizeTaxRate(settings.rate);
}

/**
 * Tax is rounded per line (to cents), then summed.
 * Keeps client preview and server charge aligned.
 */
export function calculateTaxBreakdown(
  lines: TaxableLineInput[],
  settings: TaxSettingsLike,
  shipping = 0
): TaxBreakdown {
  let subtotal = 0;
  let taxAmount = 0;
  let taxableBase = 0;

  for (const line of lines) {
    const lineSub = roundMoney(Number(line.subtotal) || 0);
    if (lineSub <= 0) continue;

    subtotal = roundMoney(subtotal + lineSub);
    const rate = resolveLineTaxRate(line, settings);
    if (rate > 0) {
      const lineTax = roundMoney(lineSub * (rate / 100));
      taxAmount = roundMoney(taxAmount + lineTax);
      taxableBase = roundMoney(taxableBase + lineSub);
    }
  }

  const shippingRounded = roundMoney(Math.max(0, Number(shipping) || 0));
  const total = roundMoney(subtotal + taxAmount + shippingRounded);
  const effectiveRate =
    taxableBase > 0 ? roundMoney((taxAmount / taxableBase) * 100) : 0;

  return {
    subtotal,
    taxAmount,
    shipping: shippingRounded,
    total,
    effectiveRate,
    label: settings.label?.trim() || DEFAULT_TAX_LABEL,
  };
}

export function formatTaxRateLabel(rate: number, label = DEFAULT_TAX_LABEL): string {
  const r = normalizeTaxRate(rate);
  if (r <= 0) return label;
  return `${label} (${r}%)`;
}

/** Compact label for admin product/fabric tables. */
export function formatCatalogTaxLabel(item: {
  taxExempt?: boolean | null;
  taxRate?: number | string | null;
}): string {
  if (item.taxExempt) return 'Exempt';
  const rate = parseOptionalTaxRate(item.taxRate);
  if (rate !== null) return `${rate}%`;
  return 'Global';
}

/** Prefer stored order tax/shipping fields; fall back for legacy orders. */
export function getOrderMoneySummary(
  order: {
    amount: number;
    subtotal?: number | null;
    taxAmount?: number | null;
    taxRate?: number | null;
    taxLabel?: string | null;
    shippingFee?: number | null;
  },
  fallbackLineSubtotal?: number
): {
  subtotal: number;
  taxAmount: number;
  shippingFee: number;
  taxRate: number;
  taxLabel: string;
  total: number;
} {
  const total = roundMoney(Number(order.amount) || 0);
  const hasStoredSubtotal =
    order.subtotal !== null &&
    order.subtotal !== undefined &&
    Number.isFinite(Number(order.subtotal));
  const hasStoredTax =
    order.taxAmount !== null &&
    order.taxAmount !== undefined &&
    Number.isFinite(Number(order.taxAmount));
  const hasStoredShipping =
    order.shippingFee !== null &&
    order.shippingFee !== undefined &&
    Number.isFinite(Number(order.shippingFee));

  const subtotal = hasStoredSubtotal
    ? roundMoney(Number(order.subtotal))
    : roundMoney(
        fallbackLineSubtotal !== undefined ? fallbackLineSubtotal : total
      );
  const shippingFee = hasStoredShipping
    ? roundMoney(Math.max(0, Number(order.shippingFee)))
    : 0;
  const taxAmount = hasStoredTax
    ? roundMoney(Number(order.taxAmount))
    : roundMoney(Math.max(0, total - subtotal - shippingFee));

  return {
    subtotal,
    taxAmount,
    shippingFee,
    taxRate: normalizeTaxRate(order.taxRate ?? 0),
    taxLabel: order.taxLabel?.trim() || DEFAULT_TAX_LABEL,
    total,
  };
}

/** Display shipping line: fee, Free (quoted $0), or em dash when shipping was never selected. */
export function formatOrderShippingFeeLabel(
  shippingFee: number,
  hasShippingMethod: boolean,
  formatPrice: (n: number) => string
): string {
  const fee = roundMoney(Math.max(0, Number(shippingFee) || 0));
  if (fee > 0) return formatPrice(fee);
  if (hasShippingMethod) return "Free";
  return "—";
}

/**
 * True when stored components reconcile with order.amount (payment SSOT).
 * Used at create/settle and Phase 2 rate validation.
 */
export function orderMoneyComponentsMatchTotal(
  order: {
    amount: number;
    subtotal?: number | null;
    taxAmount?: number | null;
    shippingFee?: number | null;
  },
  toleranceCents = 1
): boolean {
  const money = getOrderMoneySummary(order);
  const composed = roundMoney(
    money.subtotal + money.taxAmount + money.shippingFee
  );
  const a = Math.round(composed * 100);
  const b = Math.round(money.total * 100);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= toleranceCents;
}
