import { Suspense } from 'react';
import TicketViewPage from '@/components/Public_C/booking/TicketViewPage';

export default async function BookingTicketRoute({
  params,
}: {
  params: Promise<{ ticketToken: string }>;
}) {
  const { ticketToken } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading…</p>}>
      <TicketViewPage ticketToken={ticketToken} />
    </Suspense>
  );
}
