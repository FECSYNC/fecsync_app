import MembershipPlansPage from '@/components/Protected/admin/pages/memberships/MembershipPlansPage';

/**
 * Direct import — AdminInstantHost / nested dynamic cleared Opening too early and
 * revealed the previous leaf while this route was still compiling.
 * loading.tsx + AdminPendingLink Opening chrome cover the compile wait.
 */
export default function AdminMembershipPlansRoute() {
  return <MembershipPlansPage />;
}
