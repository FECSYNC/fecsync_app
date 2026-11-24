'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useToast } from '@/contexts/toast-context';
import { useMeAccountingInvoiceQuery } from '@/hooks/useMeAccounting';
import { usePayPublicAccountingInvoiceMutation } from '@/hooks/usePublicAccounting';
import { ApiError } from '@/utils/api';
import {
  billingBtn,
  billingBtnGhost,
  billingCard,
  formatBillingMoney,
  invoiceStatusLabel,
  type MeInvoice,
} from './billingUi';
import { parseMoneyInput } from '@/lib/accounting/money';

export default function ProfileInvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { addToast } = useToast();
  const search = useSearchParams();
  const q = useMeAccountingInvoiceQuery(invoiceId);
  const payM = usePayPublicAccountingInvoiceMutation();

  const inv = useMemo(() => {
    const raw = q.data as { invoice?: MeInvoice } | undefined;
    return raw?.invoice;
  }, [q.data]);

  const paidBanner = search.get('paid') === '1';
  const cancelledBanner = search.get('cancelled') === '1';

  useEffect(() => {
    if (paidBanner) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh once after Stripe return
  }, [paidBanner, invoiceId]);

  const notFound = q.isError && q.error instanceof ApiError && q.error.status === 404;

  async function onPay() {
    const token = inv?.viewToken;
    if (!token) {
      addToast('This invoice is not available for online payment', 'error');
      return;
    }
    try {
      const res = (await payM.mutateAsync({ token })) as {
        checkoutUrl?: string;
        payPath?: string;
        url?: string;
      };
      const next = res.checkoutUrl ?? res.url;
      if (next) {
        window.location.assign(next);
        return;
      }
      if (res.payPath) {
        window.location.assign(res.payPath);
        return;
      }
      addToast('Payment could not be started', 'error');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Payment failed', 'error');
    }
  }

  function onPrint() {
    window.print();
  }

  if (q.isLoading) {
    return <p className="px-6 py-10 text-sm text-stone-500">Loading invoice…</p>;
  }

  if (notFound || !inv) {
    return (
      <div className="space-y-2 px-6 py-10">
        <h1 className="text-xl font-semibold">Invoice not found</h1>
        <Link href="/profile?tab=billing" className="text-sm text-[#D4AF37]">
          Back to billing
        </Link>
      </div>
    );
  }

  const due = parseMoneyInput(inv.amountDue ?? '0');
  const payable = ['sent', 'overdue'].includes(inv.status) && due.greaterThan(0) && inv.viewToken;
  const closed = ['void', 'cancelled', 'paid'].includes(inv.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 print:max-w-none">
      <div className="print:hidden">
        <Link href="/profile?tab=billing" className="text-sm text-stone-500 hover:text-[#D4AF37]">
          ← Billing
        </Link>
      </div>
      {paidBanner ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 print:hidden">
          Thank you — payment is processing or complete.
        </p>
      ) : null}
      {cancelledBanner ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 print:hidden">
          Payment was cancelled. You can try again when ready.
        </p>
      ) : null}

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-stone-900">Invoice {inv.number}</h1>
        <p className="text-sm text-stone-600 capitalize">{invoiceStatusLabel(inv.status)}</p>
        {inv.dueAt ? (
          <p className="text-sm text-stone-600">Due {new Date(inv.dueAt).toLocaleDateString()}</p>
        ) : null}
      </header>

      <div className={`${billingCard} space-y-3 print:border-stone-300`}>
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-stone-500">Amount due</p>
            <p className="text-2xl font-semibold">{formatBillingMoney(inv.amountDue, inv.currency)}</p>
          </div>
          <div className="text-right text-sm text-stone-600">
            <p>Total {formatBillingMoney(inv.amount, inv.currency)}</p>
            <p>Paid {formatBillingMoney(inv.amountPaid, inv.currency)}</p>
          </div>
        </div>

        {inv.lines?.length ? (
          <table className="mt-4 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.lineNo} className="border-b border-stone-100">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">{formatBillingMoney(l.lineTotal, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {closed && inv.status === 'void' ? (
          <p className="text-sm text-stone-600">This invoice has been voided and is no longer payable.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        {payable ? (
          <button type="button" className={billingBtn} disabled={payM.isPending} onClick={() => void onPay()}>
            {payM.isPending ? 'Opening…' : 'Pay now'}
          </button>
        ) : null}
        <button type="button" className={billingBtnGhost} onClick={onPrint}>
          Print / PDF
        </button>
      </div>
    </div>
  );
}
