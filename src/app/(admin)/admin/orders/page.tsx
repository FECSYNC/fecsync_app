import { Suspense } from 'react';
import OrdersPage from '@/components/Protected/admin/pages/orders/OrdersPage';

function OrdersPageFallback() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded" />
      <div className="h-10 w-full bg-gray-100 rounded" />
      <div className="h-64 w-full bg-gray-100 rounded" />
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<OrdersPageFallback />}>
      <OrdersPage />
    </Suspense>
  );
}
