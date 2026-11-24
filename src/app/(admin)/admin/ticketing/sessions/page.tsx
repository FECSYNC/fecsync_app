import { Suspense } from 'react';
import TicketingSessionsPage from '@/components/Protected/admin/pages/ticketing/TicketingSessionsPage';

function SessionsFallback() {
  return (
    <p className="py-10 text-sm text-stone-500">Loading sessions…</p>
  );
}

export default function AdminTicketingSessionsRoute() {
  return (
    <Suspense fallback={<SessionsFallback />}>
      <TicketingSessionsPage />
    </Suspense>
  );
}
