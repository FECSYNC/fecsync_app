'use client';

import InvoicesList from './InvoicesList';
import StatementDownload from './StatementDownload';
import { billingCard } from './billingUi';

export default function ProfileBookingBilling({ bookingId }: { bookingId: string }) {
  return (
    <section className="space-y-4">
      <div className={billingCard}>
        <h2 className="font-semibold text-stone-900">Billing documents</h2>
        <p className="mt-1 text-xs text-stone-500">
          Your balance due on the booking summary above is the amount still owed for this visit.
        </p>
      </div>
      <InvoicesList bookingId={bookingId} />
      <StatementDownload compact />
    </section>
  );
}
