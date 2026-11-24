import { Suspense } from 'react';
import MagicPortalPage from '@/components/Public_C/booking/MagicPortalPage';

export default async function BookingMagicRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading…</p>}>
      <MagicPortalPage token={token} />
    </Suspense>
  );
}
