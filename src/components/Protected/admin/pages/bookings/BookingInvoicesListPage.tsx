'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useToast } from '@/contexts/toast-context';
import {
  adminInvoiceKeys,
  cancelAdminBookingInvoice,
  listAdminBookingInvoices,
  sendAdminBookingInvoice,
  type AdminBookingInvoiceDto,
} from '@/services/adminBookingInvoices';
import { btnSecondaryClass, formatMoney } from '../ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BOOKING_INVOICES_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

function downloadInvoice(inv: AdminBookingInvoiceDto) {
  const body = [
    `Invoice ${inv.number}`,
    `Status: ${inv.status}`,
    `Amount: ${inv.amount} ${inv.currency}`,
    `Due: ${inv.dueAt ?? '—'}`,
    `Sent: ${inv.sentAt ?? '—'}`,
    `Booking: ${inv.bookingId ?? '—'}`,
  ].join('\n');
  const blob = new Blob([body], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${inv.number}.txt`;
  a.click();
}

export default function BookingInvoicesListPage() {
  const can = useAuthStore((s) => s.can);
  const canSend = can(P.BookingInvoicesSend);
  const canManage = can(P.BookingInvoicesManage);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [guideOpen, setGuideOpen] = useState(false);

  const invoicesKey = adminInvoiceKeys.list();
  const listQuery = useQuery({
    queryKey: invoicesKey,
    queryFn: () => listAdminBookingInvoices(),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(invoicesKey),
    placeholderData: (previous) => previous,
  });
  const [showCancelled, setShowCancelled] = useState(false);
  const invoices = useMemo(() => {
    const all = listQuery.data ?? [];
    if (showCancelled) return all;
    return all.filter((inv) => inv.status !== 'cancelled');
  }, [listQuery.data, showCancelled]);

  const sendMut = useMutation({
    mutationFn: (id: string) => sendAdminBookingInvoice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminInvoiceKeys.all });
      addToast('Invoice sent', 'success');
    },
    onError: (err: Error) => addToast(err.message || 'Send failed', 'error'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelAdminBookingInvoice(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: adminInvoiceKeys.all });
      qc.setQueriesData<AdminBookingInvoiceDto[]>(
        { queryKey: adminInvoiceKeys.all },
        (old) => {
          if (!Array.isArray(old)) return old;
          if (showCancelled) {
            return old.map((inv) =>
              inv.id === id ? { ...inv, status: 'cancelled' } : inv
            );
          }
          return old.filter((inv) => inv.id !== id);
        }
      );
      addToast('Cancelling invoice…', 'info');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminInvoiceKeys.all });
      addToast('Invoice cancelled — removed from list', 'success');
    },
    onError: (err: Error) => {
      void qc.invalidateQueries({ queryKey: adminInvoiceKeys.all });
      addToast(err.message || 'Cancel failed', 'error');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            Booking invoices
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Invoices created from bookings. Open the guide if you are doing this
            for the first time.
          </p>
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            Show cancelled
          </label>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Booking invoices"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BOOKING_INVOICES_GUIDE_STEPS}
      />

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Number</th>
              <th className="px-4 py-3 font-semibold">Booking</th>
              <th className="px-4 py-3 font-semibold">Company/guest</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Total</th>
              <th className="px-4 py-3 font-semibold">Due</th>
              <th className="px-4 py-3 font-semibold">Sent</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {listQuery.isPending && invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : listQuery.isError ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-red-600">
                  {(listQuery.error as Error)?.message || 'Failed to load invoices'}
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-stone-500">
                  No invoices yet. Open a booking and choose Create invoice.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 font-medium text-stone-900">{inv.number}</td>
                  <td className="px-4 py-3">
                    {inv.bookingId ? (
                      <Link href={`/admin/bookings/${inv.bookingId}`} className="text-[#D4AF37]">
                        Open
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {inv.accountId ? 'Company' : 'Guest'}
                  </td>
                  <td className="px-4 py-3">{inv.status}</td>
                  <td className="px-4 py-3">{formatMoney(inv.amount, inv.currency)}</td>
                  <td className="px-4 py-3 text-stone-600">
                    {inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {inv.sentAt ? new Date(inv.sentAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/admin/booking-invoices/${inv.id}`}
                        className="text-sm font-medium text-[#D4AF37]"
                      >
                        View
                      </Link>
                      {canSend && inv.status === 'draft' ? (
                        <button
                          type="button"
                          className={btnSecondaryClass}
                          onClick={() => sendMut.mutate(inv.id)}
                        >
                          Send
                        </button>
                      ) : null}
                      {canManage && (inv.status === 'draft' || inv.status === 'sent') ? (
                        <button
                          type="button"
                          className={btnSecondaryClass}
                          onClick={() => {
                            if (!window.confirm('Cancel this invoice?')) return;
                            cancelMut.mutate(inv.id);
                          }}
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={btnSecondaryClass}
                        onClick={() => downloadInvoice(inv)}
                      >
                        Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
