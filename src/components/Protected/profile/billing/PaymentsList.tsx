'use client';

import { useMeAccountingInvoicesQuery } from '@/hooks/useMeAccounting';
import { billingCard, formatBillingMoney, invoiceStatusLabel, type MeInvoice } from './billingUi';
import { parseMoneyInput } from '@/lib/accounting/money';

export default function PaymentsList() {
  const q = useMeAccountingInvoicesQuery({});
  const raw = q.data as { items?: MeInvoice[] } | undefined;
  const paid =
    raw?.items?.filter((inv) =>
      parseMoneyInput(inv.amountPaid ?? '0').greaterThan(0)
    ) ?? [];

  if (q.isLoading) return <p className="text-sm text-stone-500">Loading payments…</p>;

  if (q.isError) {
    return (
      <div className={billingCard}>
        <p className="text-sm text-red-700">Could not load payment history.</p>
      </div>
    );
  }

  if (!paid.length) {
    return (
      <div className={billingCard}>
        <p className="text-stone-600">No recorded payments on your invoices yet.</p>
      </div>
    );
  }

  return (
    <div className={billingCard}>
      <h2 className="mb-3 text-base font-semibold text-stone-900">Payments</h2>
      <ul className="divide-y divide-stone-100">
        {paid.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="font-medium text-stone-900">{inv.number}</p>
              <p className="text-xs text-stone-500">
                {invoiceStatusLabel(inv.status)}
                {inv.issueDate ? ` · ${new Date(inv.issueDate).toLocaleDateString()}` : ''}
              </p>
            </div>
            <p className="font-medium text-emerald-800">{formatBillingMoney(inv.amountPaid, inv.currency)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
