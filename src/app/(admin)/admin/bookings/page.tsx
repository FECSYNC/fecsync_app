import { Suspense } from 'react';
import BookingsListShellPage from '@/components/Protected/admin/pages/bookings/BookingsListShellPage';

export default function AdminBookingsRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-500">Loading bookings…</p>}>
      <BookingsListShellPage />
    </Suspense>
  );
}
