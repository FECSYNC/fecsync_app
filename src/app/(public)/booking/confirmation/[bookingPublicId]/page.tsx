import { Suspense } from 'react';
import ConfirmationPage from '@/components/Public_C/booking/ConfirmationPage';

export default async function BookingConfirmationRoute({
  params,
}: {
  params: Promise<{ bookingPublicId: string }>;
}) {
  const { bookingPublicId } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading…</p>}>
      <ConfirmationPage bookingPublicId={bookingPublicId} />
    </Suspense>
  );
}
