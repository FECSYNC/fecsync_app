'use client';

import { useMeAccountingSummaryQuery } from '@/hooks/useMeAccounting';
import { billingCard, formatBillingMoney } from './billingUi';

export default function BillingSummary() {
  const q = useMeAccountingSummaryQuery();
  const data = q.data as
    | {
        balanceDue?: string;
        invoiceCount?: number;
        orgs?: Array<{ orgId: string; balanceDue: string; currency: string; invoiceCount: number }>;
      }
    | undefined;

  if (q.isLoading) {
    return <p className="text-sm text-stone-500">Loading billing summary…</p>;
  }
  if (q.isError) {
    return (
      <div className={billingCard}>
        <p className="text-sm text-red-700">Could not load your billing summary.</p>
      </div>
    );
  }

  const balance = data?.balanceDue ?? '0.00';
  const count = data?.invoiceCount ?? 0;
  const orgs = data?.orgs ?? [];
  const primaryCurrency = orgs[0]?.currency ?? 'USD';

  return (
    <div className={`${billingCard} space-y-3`}>
      <h2 className="text-base font-semibold text-stone-900">Outstanding balance</h2>
      <p className="text-2xl font-semibold text-stone-900">{formatBillingMoney(balance, primaryCurrency)}</p>
      <p className="text-stone-600">
        {count} invoice{count === 1 ? '' : 's'} on file across {orgs.length || 'your'} venue
        {orgs.length === 1 ? '' : 's'}.
      </p>
      {orgs.length > 1 ? (
        <ul className="divide-y divide-stone-100 border-t border-stone-100 pt-2">
          {orgs.map((o) => (
            <li key={o.orgId} className="flex justify-between py-2 text-stone-700">
              <span className="text-stone-500">Venue</span>
              <span>
                {formatBillingMoney(o.balanceDue, o.currency)} · {o.invoiceCount} inv.
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
