'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { getPublicTicket } from '@/services/publicBooking';
import { TicketCard } from './bookingUi';

export default function TicketViewPage({ ticketToken }: { ticketToken: string }) {
  const searchParams = useSearchParams();
  const bookingHint = searchParams.get('booking') ?? undefined;
  const query = useQuery({
    queryKey: ['public', 'booking', 'ticket', ticketToken, bookingHint ?? ''],
    queryFn: () => getPublicTicket(ticketToken, bookingHint),
    enabled: Boolean(ticketToken),
  });
  const ticket = query.data?.ticket;
  return (
    <main className="mx-auto max-w-sm px-4 py-10">
      {query.isLoading ? <p className="text-sm text-stone-500">Loading ticket…</p> : null}
      {ticket ? (
        <>
          <TicketCard code={ticket.code} status={ticket.status} qrPayload={ticket.qrPayload} />
          <p className="mt-3 text-center text-xs text-stone-500">
            Booking {query.data?.bookingPublicId}
          </p>
        </>
      ) : query.isError ? (
        <p className="text-sm text-red-700">Ticket not found.</p>
      ) : null}
    </main>
  );
}
