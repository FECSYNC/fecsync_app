import { Suspense } from 'react';
import PartyDetailPage from '@/components/Protected/admin/pages/parties/PartyDetailPage';

export default function AdminPartyDetailRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-500">Loading party…</p>}>
      <PartyDetailPage />
    </Suspense>
  );
}
