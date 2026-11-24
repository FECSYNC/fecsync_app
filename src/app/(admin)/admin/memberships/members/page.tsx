import { Suspense } from 'react';
import MembershipMembersPage from '@/components/Protected/admin/pages/memberships/MembershipMembersPage';

/**
 * Direct import — see memberships/plans/page.tsx (Opening must not clear early).
 * Suspense: page reads ?create=1 via useSearchParams.
 */
export default function AdminMembershipMembersRoute() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-stone-500">Loading members…</div>
      }
    >
      <MembershipMembersPage />
    </Suspense>
  );
}
