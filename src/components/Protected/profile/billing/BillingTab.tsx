'use client';

import BillingSummary from './BillingSummary';
import InvoicesList from './InvoicesList';
import PaymentsList from './PaymentsList';
import StatementDownload from './StatementDownload';

export default function BillingTab() {
  return (
    <div className="space-y-6 px-3 py-4 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Billing</h1>
        <p className="mt-1 text-sm text-stone-600">Invoices, payments, and statements from participating venues.</p>
      </div>
      <BillingSummary />
      <InvoicesList />
      <PaymentsList />
      <StatementDownload />
    </div>
  );
}
