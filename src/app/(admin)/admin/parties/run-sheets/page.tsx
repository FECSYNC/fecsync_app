import { Suspense } from 'react';
import PartyRunSheetsPrintPage from '@/components/Protected/admin/pages/parties/PartyRunSheetsPrintPage';

export default function AdminPartyRunSheetsRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-500">Loading run sheets…</p>}>
      <PartyRunSheetsPrintPage />
    </Suspense>
  );
}
