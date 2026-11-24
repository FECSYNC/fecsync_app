'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useToast } from '@/contexts/toast-context';
import {
  usePayPublicAccountingInvoiceMutation,
  usePublicAccountingInvoiceQuery,
} from '@/hooks/usePublicAccounting';
import { ApiError } from '@/utils/api';
import { billingBtn, billingBtnGhost, billingCard, formatBillingMoney, invoiceStatusLabel } from '@/components/Protected/profile/billing/billingUi';

type PublicInvoice = {
  number: string;
  status: string;
  issueDate?: string | null;
  dueAt?: string | null;
  currency: string;
  customerName?: string | null;
  subtotal: string;
  taxTotal: string;
  amount: string;
  amountPaid: string;
  amountDue: string;
  payable?: boolean;
  memo?: string | null;
  lines?: Array<{
    lineNo: number;
    description: string;
    qty: string;
    unitPrice: string;
    taxAmount: string;
    lineTotal: string;
  }>;
  branding?: {
    orgName?: string;
    logoUrl?: string | null;
    brandPrimary?: string | null;
    footer?: string | null;
  };
};

export default function PublicInvoicePage({ token }: { token: string }) {
  const { addToast } = useToast();
  const search = useSearchParams();
  const q = usePublicAccountingInvoiceQuery(token);
  const payM = usePayPublicAccountingInvoiceMutation();

  const raw = q.data as { invoice?: PublicInvoice } | undefined;
  const inv = raw?.invoice;
  const paidBanner = search.get('paid') === '1';

  useEffect(() => {
    if (paidBanner) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh once after Stripe return
  }, [paidBanner, token]);

  const invalid = q.isError && q.error instanceof ApiError;

  async function onPay() {
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

  if (q.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-stone-50 px-4">
        <p className="text-sm text-stone-500">Loading invoice…</p>
      </div>
    );
  }

  if (invalid || !inv) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-stone-900">Invoice not found</h1>
        <p className="mt-2 text-sm text-stone-600">This link is invalid or has been removed.</p>
        <p className="mt-4">
          <a href="/home" className="text-sm font-medium text-[#D4AF37] hover:underline">
            Return to store
          </a>
        </p>
      </div>
    );
  }

  const brand = inv.branding?.brandPrimary ?? '#D4AF37';
  const paidQuery = search.get('paid') === '1';
  const cancelledQuery = search.get('cancelled') === '1';
  const voided = inv.status === 'void' || inv.status === 'cancelled';
  const paid = inv.status === 'paid' || Number(inv.amountDue) <= 0;

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10 print:bg-white">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-start gap-4">
          {inv.branding?.logoUrl ? (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-white">
              <Image src={inv.branding.logoUrl} alt="" fill className="object-contain p-1" unoptimized />
            </div>
          ) : null}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: brand }}>
              {inv.branding?.orgName ?? 'Invoice'}
            </p>
            <h1 className="text-2xl font-semibold text-stone-900">{inv.number}</h1>
            <p className="text-sm text-stone-600 capitalize">{invoiceStatusLabel(inv.status)}</p>
          </div>
        </header>

        {paidQuery ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 print:hidden">
            Thank you — your payment is being confirmed.
          </p>
        ) : null}
        {cancelledQuery ? (
          <p className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 print:hidden">
            Checkout was cancelled. You can pay when ready.
          </p>
        ) : null}

        <div className={billingCard}>
          {inv.customerName ? <p className="text-sm text-stone-700">Bill to {inv.customerName}</p> : null}
          {inv.dueAt ? (
            <p className="text-sm text-stone-600">Due {new Date(inv.dueAt).toLocaleDateString()}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-stone-100 pt-4">
            <div>
              <p className="text-xs uppercase text-stone-500">Amount due</p>
              <p className="text-2xl font-semibold">{formatBillingMoney(inv.amountDue, inv.currency)}</p>
            </div>
            <div className="text-right text-sm text-stone-600">
              <p>Subtotal {formatBillingMoney(inv.subtotal, inv.currency)}</p>
              <p>Tax {formatBillingMoney(inv.taxTotal, inv.currency)}</p>
              <p>Total {formatBillingMoney(inv.amount, inv.currency)}</p>
            </div>
          </div>

          {inv.lines?.length ? (
            <table className="mt-4 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2">Item</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Line total</th>
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

          {voided ? (
            <p className="mt-4 text-sm text-stone-600">This invoice is closed and cannot be paid online.</p>
          ) : null}
          {paid && !voided ? (
            <p className="mt-4 text-sm text-emerald-800">This invoice is paid in full. Thank you.</p>
          ) : null}
          {inv.memo ? <p className="mt-4 text-xs text-stone-500">{inv.memo}</p> : null}
          {inv.branding?.footer ? (
            <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">{inv.branding.footer}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 print:hidden">
          {inv.payable && !voided && !paid ? (
            <button type="button" className={billingBtn} disabled={payM.isPending} onClick={() => void onPay()}>
              {payM.isPending ? 'Opening…' : 'Pay now'}
            </button>
          ) : null}
          <button type="button" className={billingBtnGhost} onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
