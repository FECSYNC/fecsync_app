import { Suspense } from 'react';
import PartiesListPage from '@/components/Protected/admin/pages/parties/PartiesListPage';
import PartiesListSkeleton from '@/components/Protected/admin/pages/parties/PartiesListSkeleton';

/**
 * Direct import — nested next/dynamic left users stuck on Opening….
 * Soft sidebar clicks use AdminPendingLink (plain Link) + loading.tsx.
 */
export default function AdminPartiesRoute() {
  return (
    <Suspense fallback={<PartiesListSkeleton />}>
      <PartiesListPage />
    </Suspense>
  );
}
