import BookingAccountsPage from '@/components/Protected/admin/pages/bookingAccounts/BookingAccountsPage';

/**
 * Direct import — nested next/dynamic left soft-nav stuck on "Opening companies…".
 * Route loading.tsx + AdminPendingLink (plain Link) cover compile wait.
 */
export default function AdminBookingAccountsRoute() {
  return <BookingAccountsPage />;
}
