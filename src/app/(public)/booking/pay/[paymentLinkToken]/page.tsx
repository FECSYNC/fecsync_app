import { Suspense } from 'react';
import PaymentLinkPage from '@/components/Public_C/booking/PaymentLinkPage';

export default async function BookingPayRoute({
  params,
}: {
  params: Promise<{ paymentLinkToken: string }>;
}) {
  const { paymentLinkToken } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading…</p>}>
      <PaymentLinkPage token={paymentLinkToken} />
    </Suspense>
  );
}
