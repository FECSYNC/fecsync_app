'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  inviteOrgMember,
  listOrgMembers,
  revokeOrgMember,
  hardDeleteOrgMember,
  updateOrgMember,
  createAdminUser,
  setMemberVenueAssignments,
  type MembershipRolePreset,
  type MembershipStatus,
  type OrgMember,
} from '@/services/members';
import { userBlacklistKeys } from '@/hooks/useUserBlacklist';
import { invalidateBillingUsageQueries } from '@/hooks/useBilling';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { parkContextKeys } from '@/services/parkContext';
import { hqKeys } from '@/services/hq';
import { venueLocationKeys } from '@/services/venueLocations';
import { invalidateTicketingQueries } from '@/utils/invalidateTicketingQueries';
import { invalidateMembershipsQueries } from '@/utils/invalidateMembershipsQueries';
import { invalidateWaiversQueries } from '@/utils/invalidateWaiversQueries';

export const memberKeys = {
  all: (orgId: string | null | undefined) =>
    ['admin-members', orgId ?? 'none'] as const,
  list: (orgId: string | null | undefined, status?: string) =>
    [...memberKeys.all(orgId), 'list', status ?? 'all'] as const,
};

export function useOrgMembersQuery(
  enabled: boolean = true,
  status?: MembershipStatus
) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const key = memberKeys.list(orgId, status);
  return useQuery({
    queryKey: key,
    queryFn: () => listOrgMembers(status ? { status } : undefined),
    enabled: enabled && Boolean(orgId),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

export function useInviteMemberMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: inviteOrgMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      invalidateBillingUsageQueries(queryClient);
      // Invite/promote-as-tailor may create/update TailorProfile.
      void queryClient.invalidateQueries({ queryKey: ['tailors'] });
      // Franchise roster / session flags refresh without full reload.
      void useAuthStore.getState().silentRefresh({ force: true });
    },
  });
}

export function useUpdateMemberMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      rolePreset?: MembershipRolePreset;
      roleTemplateId?: string | null;
      status?: MembershipStatus;
      permissionsOverride?: string[];
      companyWideView?: boolean;
      franchiseParkManager?: boolean;
    }) => updateOrgMember(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      invalidateBillingUsageQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tailors'] });
      // Franchise manager grant/revoke changes session park authority.
      void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({ queryKey: venueLocationKeys.all });
      void useAuthStore.getState().silentRefresh({ force: true });
    },
  });
}

export function useRevokeMemberMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: (id: string) => revokeOrgMember(id),
    onSuccess: (member: OrgMember) => {
      queryClient.setQueriesData<{ members: OrgMember[]; orgId: string }>(
        { queryKey: memberKeys.all(orgId) },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            members: old.members.map((row) =>
              row._id === member._id ? member : row
            ),
          };
        }
      );
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      invalidateBillingUsageQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tailors'] });
    },
  });
}

export function useHardDeleteMemberMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: (id: string) => hardDeleteOrgMember(id),
    onSuccess: (result) => {
      queryClient.setQueriesData<{ members: OrgMember[]; orgId: string }>(
        { queryKey: memberKeys.all(orgId) },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            members: old.members.filter(
              (row) =>
                row._id !== result.membershipId &&
                row.userId !== result.userId
            ),
          };
        }
      );
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      // Hard delete auto-blacklists email/phone — keep Blacklist tab in sync.
      void queryClient.invalidateQueries({ queryKey: userBlacklistKeys.all });
      invalidateBillingUsageQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tailors'] });
    },
  });
}

export function useCreateAdminUserMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      invalidateBillingUsageQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tailors'] });
    },
  });
}

export function useSetMemberVenueAssignmentsMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  return useMutation({
    mutationFn: ({
      membershipId,
      locationIds,
    }: {
      membershipId: string;
      locationIds: string[];
    }) => setMemberVenueAssignments(membershipId, locationIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      // Assignment change alters parkLocked / assigned set for the target seat —
      // keep park-context + HQ preference caches from serving pre-assign scope.
      void queryClient.invalidateQueries({
        queryKey: parkContextKeys.all,
      });
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({
        queryKey: venueLocationKeys.all,
      });
      invalidateTicketingQueries(queryClient);
      invalidateMembershipsQueries(queryClient);
      invalidateWaiversQueries(queryClient);
      // Actor session may still be valid while target seats are invalidated server-side.
      void useAuthStore.getState().silentRefresh({ force: true });
    },
  });
}
