export type MeInvoice = {
  id: string;
  number: string;
  kind: string;
  status: string;
  bookingId?: string | null;
  issueDate?: string | null;
  dueAt?: string | null;
  currency: string;
  amount?: string;
  amountPaid?: string;
  amountDue?: string;
  viewToken?: string | null;
  hasViewToken?: boolean;
  lines?: Array<{
    lineNo: number;
    description: string;
    qty: string;
    unitPrice: string;
    taxAmount: string;
    lineTotal: string;
  }>;
  memo?: string | null;
};

export function formatBillingMoney(amount: string | number | undefined, currency = 'USD'): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount ?? 0;
  if (!Number.isFinite(n)) return amount?.toString() ?? '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function invoiceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export const billingCard =
  'rounded-xl border border-stone-200 bg-white p-4 sm:p-5 text-sm text-stone-800';
export const billingBtn =
  'inline-flex items-center justify-center rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-[#c9a430] disabled:opacity-60';
export const billingBtnGhost =
  'inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:border-[#D4AF37] disabled:opacity-60';
export const billingField =
  'rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]';
