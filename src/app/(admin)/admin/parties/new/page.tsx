import { Suspense } from 'react';
import PartyCreateWizard from '@/components/Protected/admin/pages/parties/PartyCreateWizard';

export default function AdminPartyNewRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-500">Loading…</p>}>
      <PartyCreateWizard />
    </Suspense>
  );
}
