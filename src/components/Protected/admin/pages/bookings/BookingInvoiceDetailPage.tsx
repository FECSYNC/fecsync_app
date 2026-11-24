'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import {
  adminInvoiceKeys,
  cancelAdminBookingInvoice,
  getAdminBookingInvoice,
  patchAdminBookingInvoice,
  sendAdminBookingInvoice,
} from '@/services/adminBookingInvoices';
import { adminBookingKeys } from '@/services/adminBookings';
import {
  btnDangerClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  formatMoney,
} from '../ticketing/ticketingUi';
import { AccountingEntriesPanel } from '../accounting/shared';

export default function BookingInvoiceDetailPage() {
  const params = useParams();
  const invoiceId = String(params?.invoiceId ?? '');
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canSend = can(P.BookingInvoicesSend);
  const canManage = can(P.BookingInvoicesManage);

  const query = useQuery({
    queryKey: adminInvoiceKeys.detail(invoiceId),
    queryFn: () => getAdminBookingInvoice(invoiceId),
    enabled: Boolean(invoiceId),
  });

  const invoice = query.data;
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');

  const syncRelated = () => {
    void qc.invalidateQueries({ queryKey: adminInvoiceKeys.all });
    void qc.invalidateQueries({ queryKey: adminBookingKeys.all });
  };

  const sendMutation = useMutation({
    mutationFn: () => sendAdminBookingInvoice(invoiceId),
    onSuccess: (data) => {
      qc.setQueryData(adminInvoiceKeys.detail(invoiceId), data);
      syncRelated();
      addToast('Invoice sent', 'success');
    },
    onError: (err: Error) => addToast(err.message || 'Send failed', 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelAdminBookingInvoice(invoiceId),
    onSuccess: (data) => {
      qc.setQueryData(adminInvoiceKeys.detail(invoiceId), data);
      syncRelated();
      addToast('Invoice cancelled', 'success');
    },
    onError: (err: Error) => addToast(err.message || 'Cancel failed', 'error'),
  });

  const patchMutation = useMutation({
    mutationFn: () =>
      patchAdminBookingInvoice(invoiceId, {
        dueAt: dueAt || null,
      }),
    onSuccess: (data) => {
      qc.setQueryData(adminInvoiceKeys.detail(invoiceId), data);
      syncRelated();
      addToast('Invoice updated', 'success');
    },
    onError: (err: Error) => addToast(err.message || 'Update failed', 'error'),
  });

  function downloadInvoice() {
    if (!invoice) return;
    const body = [
      `Invoice ${invoice.number}`,
      `Status: ${invoice.status}`,
      `Amount: ${invoice.amount} ${invoice.currency}`,
      `Due: ${invoice.dueAt ?? '—'}`,
      `Sent: ${invoice.sentAt ?? '—'}`,
      `Booking: ${invoice.bookingId ?? '—'}`,
      notes ? `Notes: ${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const blob = new Blob([body], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${invoice.number}.txt`;
    a.click();
  }

  if (query.isLoading) {
    return <p className="text-sm text-stone-500">Loading invoice…</p>;
  }
  if (!invoice) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">
          {(query.error as Error)?.message || 'Invoice not found'}
        </p>
        <Link href="/admin/booking-invoices" className="text-sm text-[#D4AF37]">
          Back to invoices
        </Link>
      </div>
    );
  }

  const canAct = invoice.status === 'draft' || invoice.status === 'sent';
  const dueDefault =
    dueAt ||
    (invoice.dueAt ? new Date(invoice.dueAt).toISOString().slice(0, 10) : '');

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/booking-invoices"
          className="text-sm text-stone-500 hover:text-[#D4AF37]"
        >
          ← Invoices
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">
          {invoice.number}
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          {invoice.status} · {formatMoney(invoice.amount, invoice.currency)}
        </p>
      </div>
      <dl className="grid max-w-lg gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-stone-500">Due</dt>
          <dd>{invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Sent</dt>
          <dd>
            {invoice.sentAt ? new Date(invoice.sentAt).toLocaleString() : '—'}
          </dd>
        </div>
        {invoice.bookingId ? (
          <div className="flex justify-between">
            <dt className="text-stone-500">Booking</dt>
            <dd>
              <Link
                href={`/admin/bookings/${invoice.bookingId}`}
                className="text-[#D4AF37]"
              >
                Open booking
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      {canManage && canAct ? (
        <div className="max-w-lg space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <label className="block text-sm">
            Due date
            <input
              type="date"
              className={`${fieldClass} mt-1`}
              value={dueDefault}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Staff notes (download only)
            <textarea
              className={`${fieldClass} mt-1`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={patchMutation.isPending}
            onClick={() => patchMutation.mutate()}
          >
            Save due date
          </button>
        </div>
      ) : null}

      <AccountingEntriesPanel
        sourceType={invoice.bookingId ? "booking" : "manual_invoice"}
        sourceId={invoice.bookingId ?? invoiceId}
        currency={invoice.currency}
        className="mt-4"
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondaryClass} onClick={downloadInvoice}>
          Download
        </button>
        {canAct ? (
          <>
            {canSend && invoice.status === 'draft' ? (
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                Send
              </button>
            ) : null}
            {canManage ? (
              <button
                type="button"
                className={btnDangerClass}
                disabled={cancelMutation.isPending}
                onClick={() => {
                  if (!window.confirm('Cancel this invoice?')) return;
                  cancelMutation.mutate();
                }}
              >
                Cancel invoice
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
