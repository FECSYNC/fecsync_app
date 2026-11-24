'use client';

import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getPublicConfirmation } from '@/services/publicBooking';
import GuestBookingPanel from './GuestBookingPanel';
import PartyConfirmationDetails from './party/PartyConfirmationDetails';

export default function ConfirmationPage({
  bookingPublicId,
}: {
  bookingPublicId: string;
}) {
  const sp = useSearchParams();
  const viewToken = sp.get('viewToken') || '';
  const query = useQuery({
    queryKey: ['public', 'booking', 'confirmation', bookingPublicId, viewToken],
    queryFn: () => getPublicConfirmation(bookingPublicId, viewToken),
    enabled: Boolean(bookingPublicId && viewToken),
  });

  if (!viewToken) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-2xl font-semibold">Confirmation</h1>
        <p className="mt-2 text-sm text-stone-600">
          Open the link from your confirmation email to view this booking.
        </p>
      </main>
    );
  }
  if (query.isLoading) {
    return <main className="mx-auto max-w-lg px-4 py-10 text-sm text-stone-500">Loading…</main>;
  }
  if (!query.data) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-2xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-red-700">
          {(query.error as Error)?.message || 'This confirmation link is invalid.'}
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <PartyConfirmationDetails bookingPublicId={bookingPublicId} viewToken={viewToken} />
      <GuestBookingPanel
        booking={query.data}
        viewToken={viewToken}
        showPay={query.data.amountDue > 0}
      />
    </main>
  );
}
