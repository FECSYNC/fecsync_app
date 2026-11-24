import { Suspense } from 'react';
import TicketingResourcesPage from '@/components/Protected/admin/pages/ticketing/TicketingResourcesPage';
import AdminRouteLoading from '@/components/Protected/admin/components/AdminRouteLoading';

/**
 * Suspense for useSearchParams — avoid nested next/dynamic (stuck Opening…).
 */
export default function AdminTicketingResourcesPage() {
  return (
    <Suspense fallback={<AdminRouteLoading label="Opening resources…" />}>
      <TicketingResourcesPage />
    </Suspense>
  );
}
