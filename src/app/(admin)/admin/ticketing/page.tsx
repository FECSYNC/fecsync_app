import { Suspense } from 'react';
import TicketingProductsPage from '@/components/Protected/admin/pages/ticketing/TicketingProductsPage';

function ProductsFallback() {
  return <p className="p-6 text-sm text-stone-500">Loading products…</p>;
}

export default function AdminTicketingRoute() {
  return (
    <Suspense fallback={<ProductsFallback />}>
      <TicketingProductsPage />
    </Suspense>
  );
}
