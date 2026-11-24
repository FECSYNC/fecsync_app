'use client';

import Link from 'next/link';
import { useMeAccountingInvoicesQuery } from '@/hooks/useMeAccounting';
import { billingCard, formatBillingMoney, invoiceStatusLabel, type MeInvoice } from './billingUi';

export default function InvoicesList({ bookingId }: { bookingId?: string }) {
  const q = useMeAccountingInvoicesQuery({});
  const raw = q.data as { items?: MeInvoice[] } | undefined;
  const items = (raw?.items ?? []).filter((inv) => !bookingId || inv.bookingId === bookingId);

  if (q.isLoading) return <p className="text-sm text-stone-500">Loading invoices…</p>;

  if (q.isError) {
    return (
      <div className={billingCard}>
        <p className="text-sm text-red-700">Could not load invoices.</p>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className={billingCard}>
        <p className="text-stone-600">{bookingId ? 'No invoice for this booking yet.' : 'No invoices yet.'}</p>
      </div>
    );
  }

  return (
    <div className={billingCard}>
      <h2 className="mb-3 text-base font-semibold text-stone-900">{bookingId ? 'Invoice' : 'Invoices'}</h2>
      <ul className="divide-y divide-stone-100">
        {items.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
            <div>
              <Link href={`/profile/invoices/${inv.id}`} className="font-medium text-stone-900 hover:text-[#D4AF37]">
                {inv.number}
              </Link>
              <p className="text-xs text-stone-500">
                {invoiceStatusLabel(inv.status)}
                {inv.dueAt ? ` · due ${new Date(inv.dueAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">{formatBillingMoney(inv.amountDue ?? inv.amount, inv.currency)}</p>
              {inv.amountPaid && Number(inv.amountPaid) > 0 ? (
                <p className="text-xs text-stone-500">Paid {formatBillingMoney(inv.amountPaid, inv.currency)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
