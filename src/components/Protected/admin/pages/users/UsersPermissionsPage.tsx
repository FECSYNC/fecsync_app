'use client';

import { useMemo, useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  P,
  ROLE_PRESETS,
  ROLE_PRESET_META,
  expandRoleToPermissions,
  hasAllPermissions,
  grantableCatalogPermissions,
  isPlatformAdminActor,
  isPermission,
  permissionLabel,
  type Permission,
} from '@/lib/auth/permissions';
import { MEMBERSHIP_ROLE_PRESETS } from '@/lib/membershipConstants';
import { useToast } from '@/contexts/toast-context';
import { signInHref } from '@/utils/authRedirect';
import { clearUserQueries } from '@/utils/clearUserQueries';
import {
  useInviteMemberMutation,
  useOrgMembersQuery,
  useRevokeMemberMutation,
  useHardDeleteMemberMutation,
  useUpdateMemberMutation,
  useSetMemberVenueAssignmentsMutation,
} from '@/hooks/useMembers';
import { useBillingUsageQuery } from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import { softGateBlockedMessage } from '@/utils/planLimitSoftGate';
import { isStorefrontOrgSession } from '@/services/auth';
import { useRoleTemplatesQuery } from '@/hooks/useRoleTemplates';
import RoleTemplatesPanel from '@/components/Protected/admin/pages/users/RoleTemplatesPanel';
import UserBlacklistPanel from '@/components/Protected/admin/pages/users/UserBlacklistPanel';
import CreateUserModal from '@/components/Protected/admin/pages/users/CreateUserModal';
import ResetStaffPasswordModal from '@/components/Protected/admin/pages/users/ResetStaffPasswordModal';
import PermissionGrantList from '@/components/Protected/admin/pages/users/PermissionGrantList';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  USERS_PERMISSIONS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import type {
  MembershipRolePreset,
  MembershipStatus,
  OrgMember,
} from '@/services/members';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useQuery } from '@tanstack/react-query';
import {
  ButtonSpinner,
  PageSpinner,
} from '@/components/Protected/admin/components/Spinner';
import { permissionDeniedHref } from '@/hooks/useAdminPermission';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import {
  VenueParkAssignmentField,
} from '@/components/Protected/admin/pages/users/VenueParkAssignmentField';

const ROLE_LABELS: Record<MembershipRolePreset, string> = {
  platform_admin: ROLE_PRESET_META.platform_admin.label,
  ops_manager: ROLE_PRESET_META.ops_manager.label,
  catalog_editor: ROLE_PRESET_META.catalog_editor.label,
  finance: ROLE_PRESET_META.finance.label,
  custom: ROLE_PRESET_META.custom.label,
  tailor: ROLE_PRESET_META.tailor.label,
};

/** Keep in lockstep with `@/lib/membershipConstants`. */
const ROLE_OPTIONS: { value: MembershipRolePreset; label: string }[] =
  MEMBERSHIP_ROLE_PRESETS.map((value) => ({
    value: value as MembershipRolePreset,
    label: ROLE_LABELS[value as MembershipRolePreset] ?? value.replace(/_/g, ' '),
  }));

const STATUS_FILTERS: { value: '' | MembershipStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'revoked', label: 'Revoked' },
];

function displayName(member: OrgMember) {
  const u = member.user;
  if (!u) return member.userId;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.username || u.email || member.userId;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'active':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'invited':
      return 'bg-[#D4AF37]/10 text-[#8a7010] border-[#D4AF37]/30';
    case 'suspended':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'revoked':
      return 'bg-gray-100 text-gray-600 border-gray-200';
    default:
      return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

function overrideBeyondBase(base: Set<string>, selected: string[]): string[] {
  return selected.filter((p) => !base.has(p));
}

function roleDisplay(member: OrgMember) {
  if (member.roleTemplate?.name) {
    return `Template: ${member.roleTemplate.name}`;
  }
  return ROLE_LABELS[member.rolePreset as MembershipRolePreset] ??
    String(member.rolePreset).replace(/_/g, ' ');
}

type SessionGrantActor = {
  preset?: string | null;
  membershipRole?: string | null;
  permissions?: string[] | null;
};

/**
 * Client-safe copy of FRANCHISE_MANAGER_CAPABILITY_PERMISSIONS from
 * `@/lib/franchisePark` (that module imports prisma — do not import here).
 */
const FRANCHISE_MANAGER_CAPABILITY_KEYS = [
  'users:read',
  'users:invite',
  'users:park_assign',
  'users:manage_roles',
  'payouts:read',
  'payouts:manage',
] as const;

/** Presets the actor can assign — Admin role only for platform_admin. */
function assignableRoleOptions(
  actor: SessionGrantActor | null | undefined,
  include?: MembershipRolePreset | string | null,
  opts?: { franchiseManager?: boolean }
): { value: MembershipRolePreset; label: string }[] {
  // Franchise managers: server stamps FRANCHISE_PARK_STAFF_PERMISSIONS for
  // custom invites — do not require the full ops_manager matrix on the actor.
  if (opts?.franchiseManager) {
    const parkOps: { value: MembershipRolePreset; label: string } = {
      value: 'custom',
      label: 'Park operations staff',
    };
    const grantable = grantableCatalogPermissions(actor);
    const heldPresets = ROLE_OPTIONS.filter((opt) => {
      if (opt.value === 'platform_admin' || opt.value === 'custom') return false;
      return hasAllPermissions(grantable, expandRoleToPermissions(opt.value));
    });
    const options = [parkOps, ...heldPresets];
    if (
      include &&
      include !== 'platform_admin' &&
      ROLE_OPTIONS.some((o) => o.value === include) &&
      !options.some((o) => o.value === include)
    ) {
      const current = ROLE_OPTIONS.find((o) => o.value === include);
      if (current) {
        return current.value === 'custom'
          ? options
          : [parkOps, current, ...heldPresets.filter((o) => o.value !== current.value)];
      }
    }
    return options;
  }

  const grantable = grantableCatalogPermissions(actor);
  const options = ROLE_OPTIONS.filter((opt) => {
    if (
      opt.value === 'platform_admin' &&
      !isPlatformAdminActor(actor)
    ) {
      return false;
    }
    return hasAllPermissions(grantable, expandRoleToPermissions(opt.value));
  });
  if (
    include &&
    ROLE_OPTIONS.some((o) => o.value === include) &&
    !options.some((o) => o.value === include)
  ) {
    const current = ROLE_OPTIONS.find((o) => o.value === include);
    if (current) return [current, ...options];
  }
  return options;
}

function defaultAssignableRole(
  options: { value: MembershipRolePreset; label: string }[],
  preferCustom = false
): MembershipRolePreset {
  if (preferCustom) {
    return (
      options.find((o) => o.value === 'custom')?.value ??
      options[0]?.value ??
      'custom'
    );
  }
  return (
    options.find((o) => o.value === 'catalog_editor')?.value ??
    options.find((o) => o.value === 'custom')?.value ??
    options[0]?.value ??
    'custom'
  );
}

/** Step 6.1 invalidates JWT av + refresh JTI — actor editing self must re-login. */
async function endSessionIfSelf(
  targetUserId: string,
  sessionUserId: string | undefined,
  logout: () => Promise<void> | void,
  router: { push: (href: string) => void },
  addToast: (message: string, type: 'success' | 'error' | 'info') => void,
  queryClient: QueryClient
) {
  if (!sessionUserId || sessionUserId !== targetUserId) return false;
  addToast(
    'Your membership changed. Please sign in again to refresh permissions.',
    'info'
  );
  clearUserQueries(queryClient);
  queryClient.removeQueries({ queryKey: ['admin-members'] });
  await logout();
  router.push(signInHref('/admin/users'));
  return true;
}

function EffectivePermsCell({
  permissions,
  overrideCount,
}: {
  permissions: string[];
  overrideCount: number;
}) {
  const preview = permissions.slice(0, 3);
  const remaining = permissions.length - preview.length;

  if (permissions.length === 0) {
    return <span className="text-gray-400 text-xs">None</span>;
  }

  return (
    <div className="space-y-1 max-w-[18rem]">
      <div className="flex flex-wrap gap-1">
        {preview.map((perm) => (
          <span
            key={perm}
            className="inline-flex max-w-full truncate px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] text-gray-700"
            title={`${permissionLabel(perm)} (${perm})`}
          >
            {permissionLabel(perm)}
          </span>
        ))}
        {remaining > 0 && (
          <span
            className="inline-flex px-1.5 py-0.5 rounded border border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[10px] text-[#8a7010]"
            title={permissions.slice(3).map(permissionLabel).join(', ')}
          >
            +{remaining} more
          </span>
        )}
      </div>
      <div className="text-[10px] text-gray-500">
        {permissions.length} effective
        {overrideCount > 0 ? ` · ${overrideCount} override` : ''}
      </div>
    </div>
  );
}

function ActionSpinner({ className = 'text-current' }: { className?: string }) {
  return <ButtonSpinner className={`h-3.5 w-3.5 shrink-0 ${className}`} />;
}

function memberScopeBadge(
  member: OrgMember,
  venueNameById: Map<string, string>
): string {
  const ids = member.assignedLocationIds ?? [];
  const parkLocked =
    member.parkLocked === true ||
    (ids.length > 0 &&
      member.rolePreset !== 'platform_admin' &&
      !(member.companyWideView === true && ids.length === 0));
  if (parkLocked || (ids.length > 0 && member.rolePreset !== 'platform_admin')) {
    const names = ids
      .map((id) => venueNameById.get(id) ?? id.slice(-6))
      .filter(Boolean);
    const parkLabel =
      names.length > 0 ? `Park: ${names.join(', ')}` : 'Park-locked';
    return member.franchiseParkManager === true
      ? `${parkLabel} · Franchise manager`
      : parkLabel;
  }
  if (
    member.companyWideView === true ||
    member.rolePreset === 'platform_admin'
  ) {
    return 'Company-wide';
  }
  return 'Own records';
}

export default function UsersPermissionsPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead = can(P.UsersRead);
  const hasCompanyWideView = user?.companyWideView !== false;
  const canInvite = can(P.UsersInvite) || can(P.UsersManageRoles);
  const canManage = can(P.UsersManageRoles);
  /** Invite/create other members requires CWV (API enforces the same). */
  const actorParkLocked = user?.parkLocked === true;
  const actorFranchiseManager =
    actorParkLocked && user?.franchiseParkManager === true;
  /** Company-wide invite OR franchise park manager park-local invite. */
  const canInviteTeam =
    canInvite &&
    ((hasCompanyWideView && !actorParkLocked) || actorFranchiseManager);
  const canCreateTeam =
    canManage && hasCompanyWideView && !actorParkLocked;
  /** Edit/revoke: company-wide manage_roles, or franchise manager park-local. */
  const canEditParkStaff =
    (canManage && !actorParkLocked) ||
    (actorFranchiseManager && (canManage || canInvite));
  const canHardDelete =
    isPlatformAdminActor(user) && can(P.UsersDelete);
  const canResetPassword =
    can(P.UsersResetPassword) && hasCompanyWideView && !actorParkLocked;
  const canManageBlacklist =
    can(P.UsersBlacklist) && !actorParkLocked;
  const hardDeleteMutation = useHardDeleteMemberMutation();

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const navigating = Boolean(pendingKey) || isPending;

  const isBusy = (key: string) => pendingKey === key;

  const runAction = (key: string, action: () => void) => {
    if (pendingKey) return;
    setPendingKey(key);
    startTransition(() => {
      action();
    });
  };

  const [statusFilter, setStatusFilter] = useState<'' | MembershipStatus>('');
  const [activeTab, setActiveTab] = useState<
    'members' | 'templates' | 'blacklist'
  >('members');
  useEffect(() => {
    if (actorParkLocked && activeTab === 'templates') {
      setActiveTab('members');
    }
  }, [actorParkLocked, activeTab]);
  const { data, isPending: membersPending, isFetching, isError, refetch } = useOrgMembersQuery(
    canRead,
    statusFilter || undefined
  );
  const members = data?.members ?? [];
  const orgId = data?.orgId;

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled:
      canRead &&
      Boolean(user?.orgId) &&
      !isStorefrontOrgSession(user),
    staleTime: 60_000,
  });
  const venueNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of venuesQuery.data ?? []) {
      map.set(v.id, v.name);
    }
    return map;
  }, [venuesQuery.data]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [viewMember, setViewMember] = useState<OrgMember | null>(null);
  const [resetPasswordMember, setResetPasswordMember] =
    useState<OrgMember | null>(null);

  useEffect(() => {
    if (pendingKey?.startsWith('filter:') && !isFetching) {
      setPendingKey(null);
    }
  }, [isFetching, pendingKey]);

  useEffect(() => {
    if (pendingKey === 'create-user' && createUserOpen) setPendingKey(null);
    if (pendingKey === 'invite-member' && inviteOpen) setPendingKey(null);
  }, [createUserOpen, inviteOpen, pendingKey]);

  useEffect(() => {
    if (!pendingKey?.startsWith('tab:')) return;
    const tab = pendingKey.slice(4);
    if (activeTab !== tab) return;
    const timer = window.setTimeout(() => setPendingKey(null), 320);
    return () => window.clearTimeout(timer);
  }, [activeTab, pendingKey]);

  useEffect(() => {
    if (pendingKey?.startsWith('view:') && viewMember) setPendingKey(null);
    if (pendingKey?.startsWith('edit:') && editMember) setPendingKey(null);
    if (pendingKey?.startsWith('reset-pw:') && resetPasswordMember) {
      setPendingKey(null);
    }
  }, [viewMember, editMember, resetPasswordMember, pendingKey]);

  useEffect(() => {
    if (!pendingKey) return;
    const safety = window.setTimeout(() => setPendingKey(null), 8000);
    return () => window.clearTimeout(safety);
  }, [pendingKey]);

  const handleHardDelete = async (member: OrgMember) => {
    if (!canHardDelete) {
      addToast('You need users:delete (and Admin role) to permanently delete accounts', 'error');
      return;
    }
    if (user?.id && user.id === member.userId) {
      addToast(
        'You cannot permanently delete your own account from here',
        'error'
      );
      return;
    }
    const name = displayName(member);
    if (
      !window.confirm(
        `Permanently delete "${name}"?\n\nThis removes their account from the database and blacklists their email/phone so they cannot sign up or sign in again until you remove them from the blacklist.`
      )
    ) {
      return;
    }
    if (
      !window.confirm(
        'This cannot be undone. Delete this user account permanently?'
      )
    ) {
      return;
    }
    const deleteKey = `delete:${member._id}`;
    if (pendingKey) return;
    setPendingKey(deleteKey);
    try {
      await hardDeleteMutation.mutateAsync(member._id);
      if (editMember?._id === member._id) setEditMember(null);
      if (viewMember?._id === member._id) setViewMember(null);
      addToast(
        'User deleted and blacklisted. They cannot recreate this account until removed from the blacklist.',
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to delete user account',
        'error'
      );
    } finally {
      setPendingKey((current) => (current === deleteKey ? null : current));
    }
  };

  // Step 6.3 — align with AdminLayout: missing users:read → /403 (not in-page copy).
  useEffect(() => {
    if (!canRead) {
      router.replace(
        permissionDeniedHref('/admin/users', P.UsersRead, { user })
      );
    }
  }, [canRead, router, user]);

  if (!canRead) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Users &amp; permissions{' '}
            <span className="text-lg font-normal text-gray-500">
              ({members.length})
            </span>
          </h1>
          <p className="text-gray-600 mt-1">
            Manage organization memberships, role presets, custom role
            templates, and permission overrides. Open the guide if you are
            doing this for the first time.
          </p>
          {orgId ? (
            <p className="text-xs text-gray-400 mt-1 font-mono truncate" title={orgId}>
              Org {orgId}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canCreateTeam && (
            <button
              type="button"
              disabled={navigating && !isBusy('create-user')}
              aria-busy={isBusy('create-user')}
              onClick={() =>
                runAction('create-user', () => setCreateUserOpen(true))
              }
              className="border border-[#D4AF37]/50 text-[#8a7010] px-4 py-2 rounded-lg hover:bg-[#D4AF37]/10 transition-colors text-sm font-medium inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-80"
            >
              {isBusy('create-user') ? (
                <ActionSpinner className="text-[#8a7010]" />
              ) : null}
              CREATE USER
            </button>
          )}
          {canInviteTeam && (
            <button
              type="button"
              disabled={navigating && !isBusy('invite-member')}
              aria-busy={isBusy('invite-member')}
              onClick={() =>
                runAction('invite-member', () => setInviteOpen(true))
              }
              className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors inline-flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-80"
            >
              {isBusy('invite-member') ? (
                <ActionSpinner className="text-white" />
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <span>INVITE MEMBER</span>
            </button>
          )}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Users & permissions"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={USERS_PERMISSIONS_GUIDE_STEPS}
      />

      <div className="flex gap-2 border-b border-gray-100">
        <button
          type="button"
          disabled={navigating && !isBusy('tab:members')}
          aria-busy={isBusy('tab:members')}
          onClick={() => {
            if (activeTab === 'members') return;
            runAction('tab:members', () => setActiveTab('members'));
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 disabled:cursor-wait ${
            activeTab === 'members'
              ? 'border-[#D4AF37] text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Members
          {isBusy('tab:members') ? (
            <ActionSpinner className="text-[#D4AF37]" />
          ) : null}
        </button>
        {/* Role templates CRUD is company-wide HQ — park-locked / franchise managers
            still pick templates on Invite via GET, but cannot open the CRUD panel. */}
        {!actorParkLocked && (
          <button
            type="button"
            disabled={navigating && !isBusy('tab:templates')}
            aria-busy={isBusy('tab:templates')}
            onClick={() => {
              if (activeTab === 'templates') return;
              runAction('tab:templates', () => setActiveTab('templates'));
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 disabled:cursor-wait ${
              activeTab === 'templates'
                ? 'border-[#D4AF37] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Role templates
            {isBusy('tab:templates') ? (
              <ActionSpinner className="text-[#D4AF37]" />
            ) : null}
          </button>
        )}
        {canManageBlacklist && (
          <button
            type="button"
            disabled={navigating && !isBusy('tab:blacklist')}
            aria-busy={isBusy('tab:blacklist')}
            onClick={() => {
              if (activeTab === 'blacklist') return;
              runAction('tab:blacklist', () => setActiveTab('blacklist'));
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 disabled:cursor-wait ${
              activeTab === 'blacklist'
                ? 'border-[#D4AF37] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Blacklist
            {isBusy('tab:blacklist') ? (
              <ActionSpinner className="text-[#D4AF37]" />
            ) : null}
          </button>
        )}
      </div>

      {activeTab === 'templates' && !actorParkLocked ? (
        <RoleTemplatesPanel />
      ) : activeTab === 'blacklist' && canManageBlacklist ? (
        <UserBlacklistPanel canManage={canManageBlacklist} />
      ) : (
        <>
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((opt) => {
          const filterKey = `filter:${opt.value || 'all'}`;
          const busy = isBusy(filterKey);
          return (
          <button
            key={opt.value || 'all'}
            type="button"
            disabled={navigating && !busy}
            aria-busy={busy}
            onClick={() => {
              if (statusFilter === opt.value) return;
              runAction(filterKey, () => setStatusFilter(opt.value));
            }}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors inline-flex items-center gap-1.5 disabled:cursor-wait ${
              statusFilter === opt.value
                ? 'bg-[#D4AF37]/20 border-[#D4AF37]/40 text-gray-900 font-medium'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            } ${busy ? 'opacity-90' : ''}`}
          >
            {opt.label}
            {busy ? <ActionSpinner className="text-[#D4AF37]" /> : null}
          </button>
          );
        })}
      </div>

      {membersPending && members.length === 0 ? (
        <PageSpinner className="h-64" />
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>Could not load members. Please try again.</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="text-[#D4AF37] font-medium hover:underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                  <th className="px-4 py-3 font-medium">Last login</th>
                  <th className="px-4 py-3 font-medium">Last logout</th>
                  <th className="px-4 py-3 font-medium">Updated by</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Permissions</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-10 text-center text-gray-500"
                    >
                      No members found for this filter.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr
                      key={member._id}
                      className="border-b border-gray-50 hover:bg-gray-50/60"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {displayName(member)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {member.user?.email ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-800">
                        {roleDisplay(member)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs border capitalize ${statusBadgeClass(
                            String(member.status)
                          )}`}
                        >
                          {member.status}
                        </span>
                        {member.status === 'invited' && member.inviteExpiresAt ? (
                          <span className="text-[10px] text-stone-500">
                            exp{' '}
                            {new Date(member.inviteExpiresAt).toLocaleDateString(
                              undefined,
                              { month: 'short', day: 'numeric' }
                            )}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        <span
                          className={`inline-flex max-w-[14rem] truncate px-2 py-0.5 rounded-full text-xs border ${
                            (member.assignedLocationIds?.length ?? 0) > 0 &&
                            member.rolePreset !== 'platform_admin'
                              ? 'border-amber-200 bg-amber-50 text-amber-900'
                              : member.companyWideView === true ||
                                  member.rolePreset === 'platform_admin'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                : 'border-gray-200 bg-gray-50 text-gray-700'
                          }`}
                          title={memberScopeBadge(member, venueNameById)}
                        >
                          {memberScopeBadge(member, venueNameById)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {formatAuditDate(member.user?.lastLoginAt, 'datetime')}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {formatAuditDate(member.user?.lastLogoutAt, 'datetime')}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {formatAuditName(member.updatedByName)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatAuditDate(member.updatedAt, 'datetime')}
                      </td>
                      <td className="px-4 py-3">
                        <EffectivePermsCell
                          permissions={member.permissions ?? []}
                          overrideCount={
                            member.permissionsOverride?.length ?? 0
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={
                              navigating && !isBusy(`view:${member._id}`)
                            }
                            aria-busy={isBusy(`view:${member._id}`)}
                            onClick={() =>
                              runAction(`view:${member._id}`, () =>
                                setViewMember(member)
                              )
                            }
                            className="px-2.5 py-1 rounded-lg text-xs border border-gray-200 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1 disabled:cursor-wait"
                          >
                            View
                            {isBusy(`view:${member._id}`) ? (
                              <ActionSpinner className="text-gray-500" />
                            ) : null}
                          </button>
                          {canEditParkStaff &&
                            member.status !== 'revoked' && (
                            <button
                              type="button"
                              disabled={
                                navigating && !isBusy(`edit:${member._id}`)
                              }
                              aria-busy={isBusy(`edit:${member._id}`)}
                              onClick={() =>
                                runAction(`edit:${member._id}`, () =>
                                  setEditMember(member)
                                )
                              }
                              className="px-2.5 py-1 rounded-lg text-xs border border-[#D4AF37]/40 text-[#8a7010] hover:bg-[#D4AF37]/10 inline-flex items-center gap-1 disabled:cursor-wait"
                            >
                              Edit
                              {isBusy(`edit:${member._id}`) ? (
                                <ActionSpinner className="text-[#8a7010]" />
                              ) : null}
                            </button>
                          )}
                          {canResetPassword &&
                            user?.id !== member.userId &&
                            member.status !== 'revoked' && (
                              <button
                                type="button"
                                disabled={
                                  navigating &&
                                  !isBusy(`reset-pw:${member._id}`)
                                }
                                aria-busy={isBusy(`reset-pw:${member._id}`)}
                                onClick={() =>
                                  runAction(`reset-pw:${member._id}`, () =>
                                    setResetPasswordMember(member)
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg text-xs border border-stone-300 text-stone-700 hover:bg-stone-50 inline-flex items-center gap-1 disabled:cursor-wait"
                              >
                                Reset password
                                {isBusy(`reset-pw:${member._id}`) ? (
                                  <ActionSpinner className="text-stone-500" />
                                ) : null}
                              </button>
                            )}
                          {canHardDelete && user?.id !== member.userId && (
                            <button
                              type="button"
                              onClick={() => void handleHardDelete(member)}
                              disabled={
                                hardDeleteMutation.isPending ||
                                isBusy(`delete:${member._id}`) ||
                                (navigating &&
                                  !isBusy(`delete:${member._id}`))
                              }
                              aria-busy={isBusy(`delete:${member._id}`)}
                              className="px-2.5 py-1 rounded-lg text-xs border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1"
                            >
                              Delete
                              {isBusy(`delete:${member._id}`) ? (
                                <ActionSpinner className="text-red-600" />
                              ) : null}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}

      {createUserOpen && canCreateTeam && (
        <CreateUserModal onClose={() => setCreateUserOpen(false)} />
      )}
      {resetPasswordMember && canResetPassword && (
        <ResetStaffPasswordModal
          member={resetPasswordMember}
          onClose={() => setResetPasswordMember(null)}
        />
      )}
      {inviteOpen && canInviteTeam && (
        <InviteMemberModal
          canManage={canManage}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {editMember && canEditParkStaff && (
        <EditMemberModal
          member={editMember}
          canHardDelete={canHardDelete && !actorParkLocked}
          onHardDelete={() => void handleHardDelete(editMember)}
          hardDeletePending={hardDeleteMutation.isPending}
          onClose={() => setEditMember(null)}
        />
      )}
      {viewMember && (
        <ViewMemberModal
          member={viewMember}
          venueNameById={venueNameById}
          onClose={() => setViewMember(null)}
          onEdit={
            canEditParkStaff && viewMember.status !== 'revoked'
              ? () => {
                  setEditMember(viewMember);
                  setViewMember(null);
                }
              : undefined
          }
          onResetPassword={
            canResetPassword &&
            user?.id !== viewMember.userId &&
            viewMember.status !== 'revoked'
              ? () => {
                  setResetPasswordMember(viewMember);
                  setViewMember(null);
                }
              : undefined
          }
          onHardDelete={
            canHardDelete && user?.id !== viewMember.userId
              ? () => void handleHardDelete(viewMember)
              : undefined
          }
          hardDeletePending={hardDeleteMutation.isPending}
        />
      )}
    </div>
  );
}

function InviteMemberModal({
  canManage,
  onClose,
}: {
  canManage: boolean;
  onClose: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const { addToast } = useToast();
  const inviteMutation = useInviteMemberMutation();
  const venueAssignMutation = useSetMemberVenueAssignmentsMutation();
  const logout = useAuthStore((s) => s.logout);
  const sessionUserId = user?.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const canLoadUsage =
    !isStorefrontOrgSession(user) &&
    (can(P.SettingsManage) ||
      can(P.AnalyticsRead) ||
      can(P.UsersInvite) ||
      can(P.UsersManageRoles));
  const usageQuery = useBillingUsageQuery(canLoadUsage);
  const membersMeter = usageMeterFor(usageQuery.data, 'members');
  const tailorSeatsMeter = usageMeterFor(usageQuery.data, 'tailorSeats');
  const usageReady = !canLoadUsage || Boolean(usageQuery.data);
  const membersAtLimit =
    canLoadUsage &&
    (!usageReady ||
      !membersMeter ||
      (!membersMeter.unlimited && (membersMeter.remaining ?? 0) <= 0));

  const actorFranchiseManager =
    user?.parkLocked === true && user?.franchiseParkManager === true;

  // `can` identity is stable in the store — depend on `user` so hydrate refreshes options.
  const roleOptions = useMemo(
    () =>
      assignableRoleOptions(user, null, {
        franchiseManager: actorFranchiseManager,
      }),
    [can, user, actorFranchiseManager]
  );
  const { data: templatesData } = useRoleTemplatesQuery(true);
  const assignableTemplates = useMemo(
    () => {
      // Franchise invites use server-stamped park staff pack for custom —
      // templates stay company-wide assignable only when actor holds them.
      if (actorFranchiseManager) return [];
      const grantable = grantableCatalogPermissions(user);
      return (templatesData?.templates ?? []).filter((t) =>
        hasAllPermissions(
          grantable,
          t.permissions.filter((p): p is Permission => isPermission(p))
        )
      );
    },
    [templatesData, user, actorFranchiseManager]
  );
  const [email, setEmail] = useState('');
  const [assignmentMode, setAssignmentMode] = useState<'preset' | 'template'>(
    'preset'
  );
  const [rolePreset, setRolePreset] = useState<MembershipRolePreset>(() =>
    defaultAssignableRole(
      assignableRoleOptions(user, null, {
        franchiseManager:
          user?.parkLocked === true && user?.franchiseParkManager === true,
      }),
      user?.parkLocked === true && user?.franchiseParkManager === true
    )
  );
  const [roleTemplateId, setRoleTemplateId] = useState('');
  const [activateNow, setActivateNow] = useState(false);
  const [companyWideView, setCompanyWideView] = useState(false);
  const [assignedLocationIds, setAssignedLocationIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overrideSelected, setOverrideSelected] = useState<string[]>([]);

  const actorCanGrantCwv =
    user?.preset === 'platform_admin' ||
    user?.membershipRole === 'platform_admin' ||
    user?.companyWideView !== false;
  /** Align with PUT venue-assignments — FPM needs users:park_assign (ensure pack). */
  const actorCanAssignParks =
    (canManage &&
      can(P.UsersParkAssign) &&
      actorCanGrantCwv &&
      user?.parkLocked !== true) ||
    (actorFranchiseManager && can(P.UsersParkAssign));

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: actorCanAssignParks && !isStorefrontOrgSession(user),
    staleTime: 60_000,
  });

  // Franchise managers: default invite parks to their assigned set.
  useEffect(() => {
    if (!actorFranchiseManager) return;
    const ids = user?.assignedLocationIds ?? [];
    if (ids.length > 0) setAssignedLocationIds(ids);
  }, [actorFranchiseManager, user?.assignedLocationIds]);

  const grantable = useMemo(
    () => grantableCatalogPermissions(user),
    [can, user]
  );

  const basePerms = useMemo(() => {
    if (assignmentMode === 'template') {
      const t = assignableTemplates.find((x) => x._id === roleTemplateId);
      return new Set(t?.permissions ?? []);
    }
    return new Set<string>(expandRoleToPermissions(rolePreset));
  }, [assignmentMode, rolePreset, roleTemplateId, assignableTemplates]);

  useEffect(() => {
    if (assignmentMode === 'preset' && !roleOptions.some((o) => o.value === rolePreset)) {
      setRolePreset(
        defaultAssignableRole(roleOptions, actorFranchiseManager)
      );
    }
  }, [roleOptions, rolePreset, assignmentMode, actorFranchiseManager]);

  useEffect(() => {
    if (actorFranchiseManager && assignmentMode === 'template') {
      setAssignmentMode('preset');
      return;
    }
    if (assignmentMode === 'template' && !roleTemplateId && assignableTemplates[0]) {
      setRoleTemplateId(assignableTemplates[0]._id);
    }
  }, [
    assignmentMode,
    roleTemplateId,
    assignableTemplates,
    actorFranchiseManager,
  ]);

  useEffect(() => {
    setOverrideSelected((prev) => overrideBeyondBase(basePerms, prev));
  }, [basePerms]);

  useEffect(() => {
    if (assignmentMode === 'preset' && rolePreset === 'platform_admin') {
      setCompanyWideView(true);
    } else if (!actorCanGrantCwv) {
      setCompanyWideView(false);
    }
  }, [assignmentMode, rolePreset, actorCanGrantCwv]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage && !can(P.UsersInvite)) {
      addToast('You do not have permission to invite members', 'error');
      return;
    }
    if (membersAtLimit) {
      addToast(
        softGateBlockedMessage(usageQuery.data, 'members', {
          atLimit: true,
          usageReady: usageReady && Boolean(membersMeter),
        }) ?? 'Could not verify plan capacity',
        'error'
      );
      return;
    }
    if (
      assignmentMode === 'preset' &&
      rolePreset === 'tailor' &&
      canLoadUsage &&
      (!usageReady ||
        !tailorSeatsMeter ||
        (!tailorSeatsMeter.unlimited &&
          (tailorSeatsMeter.remaining ?? 0) <= 0))
    ) {
      addToast(
        softGateBlockedMessage(usageQuery.data, 'tailorSeats', {
          atLimit: true,
          usageReady: usageReady && Boolean(tailorSeatsMeter),
        }) ?? 'Could not verify plan capacity',
        'error'
      );
      return;
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      addToast('Email is required', 'error');
      return;
    }
    if (assignmentMode === 'preset' && roleOptions.length === 0) {
      addToast('You cannot assign any role presets with your permissions', 'error');
      return;
    }
    if (assignmentMode === 'template' && !roleTemplateId) {
      addToast('Select a role template', 'error');
      return;
    }
    try {
      const status =
        canManage && activateNow ? ('active' as const) : ('invited' as const);
      const permissionsOverride = canManage
        ? overrideBeyondBase(basePerms, overrideSelected)
        : undefined;
      const held = grantableCatalogPermissions(user);
      // Check raw grants (do not filter through held first — that made the check a no-op).
      // Franchise park staff pack is server-stamped — skip matrix check for FPM custom.
      const franchiseStaffInvite =
        actorFranchiseManager &&
        assignmentMode === 'preset' &&
        rolePreset === 'custom';
      const effective: Permission[] = [
        ...Array.from(basePerms).filter((p): p is Permission => isPermission(p)),
        ...((permissionsOverride ?? []).filter((p): p is Permission =>
          isPermission(p)
        )),
      ];
      if (!franchiseStaffInvite && !hasAllPermissions(held, effective)) {
        addToast('Cannot grant permissions beyond your own', 'error');
        return;
      }
      if (actorFranchiseManager) {
        if (
          assignmentMode === 'preset' &&
          rolePreset === 'platform_admin'
        ) {
          addToast(
            'Franchise park managers cannot invite platform admins',
            'error'
          );
          return;
        }
        if (assignedLocationIds.length === 0) {
          addToast(
            'Assign at least one franchise park for the invite',
            'error'
          );
          return;
        }
      }
      const member = await inviteMutation.mutateAsync({
        email: trimmed,
        rolePreset: assignmentMode === 'template' ? 'custom' : rolePreset,
        // Manage-roles: explicit null clears sticky template when using a preset.
        ...(assignmentMode === 'template'
          ? { roleTemplateId }
          : canManage && !actorFranchiseManager
            ? { roleTemplateId: null }
            : {}),
        status: actorFranchiseManager ? 'invited' : status,
        // Invite-only must omit CWV so re-invite cannot demote an existing member.
        // Manage-roles sends an explicit value (checkbox / platform_admin).
        // Franchise managers always force park-locked seats (server also enforces).
        ...(actorFranchiseManager
          ? {
              companyWideView: false,
              locationIds: assignedLocationIds,
            }
          : canManage
            ? {
                companyWideView:
                  assignmentMode === 'preset' && rolePreset === 'platform_admin'
                    ? true
                    : companyWideView === true && actorCanGrantCwv,
              }
            : {}),
        ...(permissionsOverride &&
        permissionsOverride.length > 0 &&
        !actorFranchiseManager
          ? { permissionsOverride }
          : {}),
      });
      let parkAssignWarning: string | null = null;
      if (
        !actorFranchiseManager &&
        actorCanAssignParks &&
        !(assignmentMode === 'preset' && rolePreset === 'platform_admin')
      ) {
        try {
          await venueAssignMutation.mutateAsync({
            membershipId: member._id,
            locationIds: assignedLocationIds,
          });
        } catch (parkErr) {
          parkAssignWarning =
            parkErr instanceof Error
              ? parkErr.message
              : 'Park assignment failed';
        }
      }
      if (
        await endSessionIfSelf(
          member.userId,
          sessionUserId,
          logout,
          router,
          addToast,
          queryClient
        )
      ) {
        return;
      }
      if (parkAssignWarning) {
        addToast(
          `Member saved, but park assignment failed: ${parkAssignWarning}`,
          'error'
        );
      } else {
        addToast(
          status === 'invited'
            ? 'Invitation created. An email was sent if mail is configured.'
            : 'Member assigned successfully.',
          'success'
        );
      }
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Invite failed', 'error');
    }
  };

  return (
    <ModalShell title="Invite member" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {membersMeter ? (
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {usageQuery.data?.billingEntitled === false
              ? softGateBlockedMessage(usageQuery.data, 'members', {
                  atLimit: true,
                })
              : membersMeter.unlimited
                ? `Team seats: ${membersMeter.used} used (unlimited on ${usageQuery.data?.planResolved ?? 'plan'})`
                : `Team seats: ${membersMeter.used}/${membersMeter.limit} used · ${membersMeter.remaining ?? 0} remaining`}
            {usageQuery.data?.billingEntitled !== false &&
            assignmentMode === 'preset' &&
            rolePreset === 'tailor' &&
            tailorSeatsMeter &&
            !tailorSeatsMeter.unlimited
              ? ` · Tailor seats: ${tailorSeatsMeter.used}/${tailorSeatsMeter.limit}`
              : null}
          </p>
        ) : null}
        <p className="text-xs text-stone-500">
          Pending invitations expire after about 14 days (configurable). Expired
          invites free the seat — resend from Users if needed.
        </p>
        {actorFranchiseManager ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Franchise park invite: the new seat stays park-locked to your
            franchise parks only. Company-wide view and platform admin are not
            available.
          </p>
        ) : null}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
            placeholder="user@example.com"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            The user must already have an account on this platform.
          </p>
        </div>

        <RoleAssignmentFields
          assignmentMode={assignmentMode}
          onAssignmentModeChange={setAssignmentMode}
          rolePreset={rolePreset}
          onRolePresetChange={setRolePreset}
          roleOptions={roleOptions}
          roleTemplateId={roleTemplateId}
          onRoleTemplateIdChange={setRoleTemplateId}
          assignableTemplates={assignableTemplates}
          hideTemplates={actorFranchiseManager}
        />

        {canManage && !actorFranchiseManager && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={activateNow}
              onChange={(e) => setActivateNow(e.target.checked)}
              className="rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
            />
            Activate immediately (otherwise invite pending)
          </label>
        )}

        {canManage && !actorFranchiseManager && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              checked={
                assignmentMode === 'preset' && rolePreset === 'platform_admin'
                  ? true
                  : companyWideView
              }
              disabled={
                (assignmentMode === 'preset' &&
                  rolePreset === 'platform_admin') ||
                !actorCanGrantCwv
              }
              onChange={(e) => setCompanyWideView(e.target.checked)}
            />
            <span>
              <span className="font-medium">Company-wide view</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                See all organization records for assigned features. Unchecked:
                only their own records. Admins always have company-wide view.
              </span>
            </span>
          </label>
        )}

        {actorCanAssignParks &&
          !(assignmentMode === 'preset' && rolePreset === 'platform_admin') && (
            <VenueParkAssignmentField
              venues={venuesQuery.data ?? []}
              selectedIds={assignedLocationIds}
              onChange={setAssignedLocationIds}
              franchiseScoped={actorFranchiseManager}
              disabled={
                inviteMutation.isPending || venueAssignMutation.isPending
              }
              loading={venuesQuery.isLoading}
            />
          )}

        {canManage && !actorFranchiseManager && (
          <AdvancedOverrides
            open={showAdvanced}
            onToggle={() => setShowAdvanced((v) => !v)}
            grantable={grantable}
            basePerms={basePerms}
            selected={overrideSelected}
            onChange={setOverrideSelected}
          />
        )}

        <ModalActions
          onCancel={onClose}
          submitting={
            inviteMutation.isPending || venueAssignMutation.isPending
          }
          submitLabel="Send invite"
          disabled={
            membersAtLimit ||
            (assignmentMode === 'preset' &&
              rolePreset === 'tailor' &&
              canLoadUsage &&
              (!usageReady ||
                !tailorSeatsMeter ||
                (!tailorSeatsMeter.unlimited &&
                  (tailorSeatsMeter.remaining ?? 0) <= 0))) ||
            (assignmentMode === 'preset'
              ? roleOptions.length === 0
              : assignableTemplates.length === 0)
          }
        />
      </form>
    </ModalShell>
  );
}

function EditMemberModal({
  member,
  onClose,
  canHardDelete,
  onHardDelete,
  hardDeletePending,
}: {
  member: OrgMember;
  onClose: () => void;
  canHardDelete: boolean;
  onHardDelete: () => void;
  hardDeletePending: boolean;
}) {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const { addToast } = useToast();
  const updateMutation = useUpdateMemberMutation();
  const venueAssignMutation = useSetMemberVenueAssignmentsMutation();
  const revokeMutation = useRevokeMemberMutation();
  const logout = useAuthStore((s) => s.logout);
  const sessionUserId = user?.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const canLoadUsage =
    !isStorefrontOrgSession(user) &&
    (can(P.SettingsManage) ||
      can(P.AnalyticsRead) ||
      can(P.UsersInvite) ||
      can(P.UsersManageRoles));
  const usageQuery = useBillingUsageQuery(canLoadUsage);
  const membersMeter = usageMeterFor(usageQuery.data, 'members');
  const tailorSeatsMeter = usageMeterFor(usageQuery.data, 'tailorSeats');
  const usageReady = !canLoadUsage || Boolean(usageQuery.data);

  const initialPreset = (
    ROLE_OPTIONS.some((o) => o.value === member.rolePreset)
      ? member.rolePreset
      : 'custom'
  ) as MembershipRolePreset;

  const actorFranchiseManager =
    user?.parkLocked === true && user?.franchiseParkManager === true;
  /** Invite-only FPM: status/revoke only — hide role + park editors. */
  const franchiseInviteOnly =
    actorFranchiseManager && !can(P.UsersManageRoles);

  const roleOptions = useMemo(
    () =>
      assignableRoleOptions(user, initialPreset, {
        franchiseManager: actorFranchiseManager,
      }),
    [can, user, initialPreset, actorFranchiseManager]
  );
  const { data: templatesData } = useRoleTemplatesQuery(true);
  const assignableTemplates = useMemo(
    () => {
      if (actorFranchiseManager) return [];
      const grantable = grantableCatalogPermissions(user);
      return (templatesData?.templates ?? []).filter((t) =>
        hasAllPermissions(
          grantable,
          t.permissions.filter((p): p is Permission => isPermission(p))
        )
      );
    },
    [templatesData, user, actorFranchiseManager]
  );

  const initialTemplateId = member.roleTemplateId ?? '';
  const [assignmentMode, setAssignmentMode] = useState<'preset' | 'template'>(
    initialTemplateId && !actorFranchiseManager ? 'template' : 'preset'
  );
  const [rolePreset, setRolePreset] =
    useState<MembershipRolePreset>(initialPreset);
  const [roleTemplateId, setRoleTemplateId] = useState(initialTemplateId);
  const [status, setStatus] = useState<MembershipStatus>(
    (['active', 'invited', 'suspended', 'revoked'].includes(
      String(member.status)
    )
      ? member.status
      : 'active') as MembershipStatus
  );
  const [showAdvanced, setShowAdvanced] = useState(
    (member.permissionsOverride?.length ?? 0) > 0
  );
  const [overrideSelected, setOverrideSelected] = useState<string[]>(
    member.permissionsOverride ?? []
  );
  const [companyWideView, setCompanyWideView] = useState(
    member.rolePreset === 'platform_admin' || member.companyWideView === true
  );
  const [assignedLocationIds, setAssignedLocationIds] = useState<string[]>(
    () => member.assignedLocationIds ?? []
  );
  const [franchiseParkManager, setFranchiseParkManager] = useState(
    member.franchiseParkManager === true
  );

  const actorCanGrantCwv =
    user?.preset === 'platform_admin' ||
    user?.membershipRole === 'platform_admin' ||
    user?.companyWideView !== false;
  const actorCanAssignParks =
    !franchiseInviteOnly &&
    ((can(P.UsersManageRoles) &&
      can(P.UsersParkAssign) &&
      actorCanGrantCwv &&
      user?.parkLocked !== true) ||
      (actorFranchiseManager && can(P.UsersParkAssign)));
  const actorCanGrantFranchiseManager =
    can(P.UsersManageRoles) &&
    actorCanGrantCwv &&
    user?.parkLocked !== true;

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: actorCanAssignParks && !isStorefrontOrgSession(user),
    staleTime: 60_000,
  });

  const grantable = useMemo(
    () => grantableCatalogPermissions(user),
    [can, user]
  );

  const basePerms = useMemo(() => {
    if (assignmentMode === 'template') {
      const t = assignableTemplates.find((x) => x._id === roleTemplateId);
      return new Set(t?.permissions ?? member.roleTemplate?.permissions ?? []);
    }
    return new Set<string>(expandRoleToPermissions(rolePreset));
  }, [
    assignmentMode,
    rolePreset,
    roleTemplateId,
    assignableTemplates,
    member.roleTemplate?.permissions,
  ]);

  useEffect(() => {
    setOverrideSelected((prev) => overrideBeyondBase(basePerms, prev));
  }, [basePerms]);

  useEffect(() => {
    if (assignmentMode === 'preset' && rolePreset === 'platform_admin') {
      setCompanyWideView(true);
    } else if (!actorCanGrantCwv) {
      setCompanyWideView(false);
    }
  }, [assignmentMode, rolePreset, actorCanGrantCwv]);

  const wasLive =
    member.status === 'active' || member.status === 'invited';
  const editLiveStatus =
    assignmentMode === 'preset' &&
    rolePreset === 'tailor' &&
    status === 'invited'
      ? 'active'
      : status;
  const willBeLive =
    editLiveStatus === 'active' || editLiveStatus === 'invited';
  const membersBlockedOnReactivate =
    willBeLive &&
    !wasLive &&
    canLoadUsage &&
    (!usageReady ||
      !membersMeter ||
      (!membersMeter.unlimited && (membersMeter.remaining ?? 0) <= 0));
  const nextEditRole =
    assignmentMode === 'template' ? 'custom' : rolePreset;
  const alreadyOccupiesTailorSeat = Boolean(
    usageQuery.data?.tailorSeatOccupantUserIds?.includes(member.userId)
  );
  const tailorSeatsBlockedOnPromote =
    willBeLive &&
    nextEditRole === 'tailor' &&
    !(wasLive && member.rolePreset === 'tailor') &&
    !alreadyOccupiesTailorSeat &&
    canLoadUsage &&
    (!usageReady ||
      !tailorSeatsMeter ||
      (!tailorSeatsMeter.unlimited &&
        (tailorSeatsMeter.remaining ?? 0) <= 0));
  const planBlocksSave =
    membersBlockedOnReactivate || tailorSeatsBlockedOnPromote;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const mayEdit =
      can(P.UsersManageRoles) ||
      (actorFranchiseManager &&
        (can(P.UsersInvite) || can(P.UsersManageRoles)));
    if (!mayEdit) {
      addToast('You do not have permission to edit memberships', 'error');
      return;
    }
    // Franchise invite-only: status / soft-revoke only (server enforces too).
    if (actorFranchiseManager && !can(P.UsersManageRoles)) {
      try {
        await updateMutation.mutateAsync({
          id: member._id,
          status,
        });
        addToast('Membership updated', 'success');
        onClose();
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Update failed', 'error');
      }
      return;
    }
    // Mirror PATCH /api/admin/members/[id] plan asserts (live = active|invited).
    if (membersBlockedOnReactivate) {
      addToast(
        softGateBlockedMessage(usageQuery.data, 'members', {
          atLimit: true,
          usageReady: usageReady && Boolean(membersMeter),
        }) ?? 'Could not verify plan capacity',
        'error'
      );
      return;
    }
    if (tailorSeatsBlockedOnPromote) {
      addToast(
        softGateBlockedMessage(usageQuery.data, 'tailorSeats', {
          atLimit: true,
          usageReady: usageReady && Boolean(tailorSeatsMeter),
        }) ?? 'Could not verify plan capacity',
        'error'
      );
      return;
    }
    try {
      const permissionsOverride = overrideBeyondBase(basePerms, overrideSelected);
      const held = grantableCatalogPermissions(user);
      const nextPreset =
        assignmentMode === 'template' ? ('custom' as const) : rolePreset;
      const templateChanging =
        assignmentMode === 'template'
          ? roleTemplateId !== initialTemplateId
          : initialTemplateId !== '';
      const roleOrOverrideChanging =
        nextPreset !== initialPreset ||
        templateChanging ||
        JSON.stringify([...permissionsOverride].sort()) !==
          JSON.stringify([...(member.permissionsOverride ?? [])].sort());
      if (status === 'active' || roleOrOverrideChanging) {
        const effective: Permission[] = [
          ...Array.from(basePerms).filter((p): p is Permission =>
            isPermission(p)
          ),
          ...permissionsOverride.filter((p): p is Permission => isPermission(p)),
        ];
        if (!hasAllPermissions(held, effective)) {
          addToast('Cannot grant permissions beyond your own', 'error');
          return;
        }
      }
      const nextCwv = actorFranchiseManager
        ? false
        : nextPreset === 'platform_admin'
          ? true
          : companyWideView === true && actorCanGrantCwv;
      if (
        actorCanGrantFranchiseManager &&
        franchiseParkManager &&
        (nextPreset === 'platform_admin' || assignedLocationIds.length === 0)
      ) {
        addToast(
          'Franchise park managers must be park-locked and cannot be platform admins',
          'error'
        );
        return;
      }
      const prevParkIds = [...(member.assignedLocationIds ?? [])].sort();
      const nextParkIds = [...assignedLocationIds].sort();
      const parksChanged =
        prevParkIds.length !== nextParkIds.length ||
        prevParkIds.some((id, i) => id !== nextParkIds[i]);
      const nextFranchiseParkManager =
        actorCanGrantFranchiseManager &&
        nextPreset !== 'platform_admin' &&
        franchiseParkManager;
      // Assign parks before granting franchiseParkManager — PATCH validates
      // existing assignments and rejects an empty park-lock on grant.
      let parkAssignWarning: string | null = null;
      if (
        actorCanAssignParks &&
        nextPreset !== 'platform_admin' &&
        parksChanged
      ) {
        try {
          await venueAssignMutation.mutateAsync({
            membershipId: member._id,
            locationIds: assignedLocationIds,
          });
        } catch (parkErr) {
          parkAssignWarning =
            parkErr instanceof Error
              ? parkErr.message
              : 'Park assignment failed';
        }
      }
      if (parkAssignWarning && nextFranchiseParkManager && prevParkIds.length === 0) {
        addToast(
          `Park assignment failed — franchise manager not granted: ${parkAssignWarning}`,
          'error'
        );
        return;
      }

      await updateMutation.mutateAsync({
        id: member._id,
        // Franchise managers: server stamps custom + park staff pack (ignore UI preset).
        rolePreset: actorFranchiseManager ? 'custom' : nextPreset,
        ...(actorFranchiseManager
          ? { roleTemplateId: null }
          : assignmentMode === 'template'
            ? { roleTemplateId }
            : { roleTemplateId: null }),
        status,
        ...(actorFranchiseManager
          ? { permissionsOverride: [], companyWideView: false }
          : {
              permissionsOverride,
              companyWideView: nextCwv,
            }),
        ...(actorCanGrantFranchiseManager
          ? {
              franchiseParkManager:
                nextPreset === 'platform_admin' ? false : franchiseParkManager,
            }
          : {}),
      });
      if (
        await endSessionIfSelf(
          member.userId,
          sessionUserId,
          logout,
          router,
          addToast,
          queryClient
        )
      ) {
        return;
      }
      if (parkAssignWarning) {
        addToast(
          `Membership updated, but park assignment failed: ${parkAssignWarning}`,
          'error'
        );
      } else {
        addToast('Membership updated', 'success');
      }
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleRevoke = async () => {
    const mayRevoke =
      can(P.UsersManageRoles) ||
      (actorFranchiseManager &&
        (can(P.UsersInvite) || can(P.UsersManageRoles)));
    if (!mayRevoke) {
      addToast('You do not have permission to revoke memberships', 'error');
      return;
    }
    if (!window.confirm(`Revoke membership for ${displayName(member)}?`)) {
      return;
    }
    try {
      // Franchise managers: soft-revoke via PATCH (DELETE stays company-wide HQ).
      if (actorFranchiseManager) {
        await updateMutation.mutateAsync({
          id: member._id,
          status: 'revoked',
        });
      } else {
        await revokeMutation.mutateAsync(member._id);
      }
      if (
        await endSessionIfSelf(
          member.userId,
          sessionUserId,
          logout,
          router,
          addToast,
          queryClient
        )
      ) {
        return;
      }
      addToast('Membership revoked', 'success');
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Revoke failed', 'error');
    }
  };

  return (
    <ModalShell title="Edit membership" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
          <div className="font-medium text-gray-900">{displayName(member)}</div>
          <div className="text-gray-500">{member.user?.email}</div>
        </div>
        {actorFranchiseManager ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Franchise park staff edit: keep this seat park-locked inside your
            parks. Company-wide view and platform admin are not available.
            {franchiseInviteOnly
              ? ' With invite-only permission you can change status only.'
              : ''}
          </p>
        ) : null}

        {membersMeter && !franchiseInviteOnly ? (
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {usageQuery.data?.billingEntitled === false
              ? softGateBlockedMessage(usageQuery.data, 'members', {
                  atLimit: true,
                })
              : membersMeter.unlimited
                ? `Team seats: ${membersMeter.used} used (unlimited on ${usageQuery.data?.planResolved ?? 'plan'})`
                : `Team seats: ${membersMeter.used}/${membersMeter.limit} used · ${membersMeter.remaining ?? 0} remaining`}
            {usageQuery.data?.billingEntitled !== false &&
            assignmentMode === 'preset' &&
            rolePreset === 'tailor' &&
            tailorSeatsMeter &&
            !tailorSeatsMeter.unlimited
              ? ` · Tailor seats: ${tailorSeatsMeter.used}/${tailorSeatsMeter.limit}`
              : null}
          </p>
        ) : null}

        {!franchiseInviteOnly ? (
          <RoleAssignmentFields
            assignmentMode={assignmentMode}
            onAssignmentModeChange={setAssignmentMode}
            rolePreset={rolePreset}
            onRolePresetChange={setRolePreset}
            roleOptions={roleOptions}
            roleTemplateId={roleTemplateId}
            onRoleTemplateIdChange={setRoleTemplateId}
            assignableTemplates={assignableTemplates}
            hideTemplates={actorFranchiseManager}
          />
        ) : (
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            Role: {roleDisplay(member)}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MembershipStatus)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
          >
            <option value="active">Active</option>
            <option
              value="invited"
              disabled={member.status === 'active'}
              title={
                member.status === 'active'
                  ? 'Cannot move an active member to invited. Suspend or revoke instead.'
                  : undefined
              }
            >
              Invited
            </option>
            <option value="suspended">Suspended</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>

        {!actorFranchiseManager && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              checked={
                assignmentMode === 'preset' && rolePreset === 'platform_admin'
                  ? true
                  : companyWideView
              }
              disabled={
                (assignmentMode === 'preset' &&
                  rolePreset === 'platform_admin') ||
                !actorCanGrantCwv
              }
              onChange={(e) => setCompanyWideView(e.target.checked)}
            />
            <span>
              <span className="font-medium">Company-wide view</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                See all organization records for assigned features. Unchecked:
                only their own records. Admins always have company-wide view.
              </span>
            </span>
          </label>
        )}

        {actorCanGrantFranchiseManager &&
          !(assignmentMode === 'preset' && rolePreset === 'platform_admin') && (
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                checked={franchiseParkManager}
                disabled={assignedLocationIds.length === 0}
                onChange={(e) => {
                  const on = e.target.checked;
                  setFranchiseParkManager(on);
                  if (on) {
                    // Mirror FRANCHISE_MANAGER_CAPABILITY_PERMISSIONS (server also ensures).
                    setOverrideSelected((prev) => {
                      const next = new Set(prev);
                      for (const key of FRANCHISE_MANAGER_CAPABILITY_KEYS) {
                        next.add(key);
                      }
                      return Array.from(next);
                    });
                  }
                }}
              />
              <span>
                <span className="font-medium">Franchise park manager</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Park-locked seat may invite and manage staff only inside their
                  assigned franchise parks. Also receives park staff invite +
                  park Payouts (Connect) permissions for those parks. Not a
                  second company — SaaS billing stays company-wide. Requires at
                  least one park assignment.
                </span>
              </span>
            </label>
          )}

        {actorCanAssignParks &&
          !(assignmentMode === 'preset' && rolePreset === 'platform_admin') && (
            <VenueParkAssignmentField
              venues={venuesQuery.data ?? []}
              selectedIds={assignedLocationIds}
              onChange={setAssignedLocationIds}
              franchiseScoped={actorFranchiseManager}
              disabled={
                updateMutation.isPending || venueAssignMutation.isPending
              }
              loading={venuesQuery.isLoading}
            />
          )}

        {can(P.UsersManageRoles) && !actorFranchiseManager && (
          <AdvancedOverrides
            open={showAdvanced}
            onToggle={() => setShowAdvanced((v) => !v)}
            grantable={grantable}
            basePerms={basePerms}
            selected={overrideSelected}
            onChange={setOverrideSelected}
          />
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={() => void handleRevoke()}
              disabled={
                revokeMutation.isPending ||
                updateMutation.isPending ||
                venueAssignMutation.isPending ||
                hardDeletePending ||
                member.status === 'revoked'
              }
              className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke membership'}
            </button>
            {canHardDelete && (
              <button
                type="button"
                onClick={onHardDelete}
                disabled={
                  hardDeletePending ||
                  revokeMutation.isPending ||
                  updateMutation.isPending ||
                  venueAssignMutation.isPending
                }
                className="text-sm font-medium text-red-700 hover:text-red-800 disabled:opacity-50"
              >
                {hardDeletePending
                  ? 'Deleting account…'
                  : 'Delete account permanently'}
              </button>
            )}
          </div>
          <ModalActions
            onCancel={onClose}
            submitting={
              updateMutation.isPending || venueAssignMutation.isPending
            }
            submitLabel="Save changes"
            disabled={planBlocksSave}
          />
        </div>
      </form>
    </ModalShell>
  );
}

function ViewMemberModal({
  member,
  venueNameById,
  onClose,
  onEdit,
  onResetPassword,
  onHardDelete,
  hardDeletePending,
}: {
  member: OrgMember;
  venueNameById: Map<string, string>;
  onClose: () => void;
  onEdit?: () => void;
  onResetPassword?: () => void;
  onHardDelete?: () => void;
  hardDeletePending?: boolean;
}) {
  return (
    <ModalShell title="Member details" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <div className="text-xs text-gray-500">Name</div>
          <div className="font-medium text-gray-900">{displayName(member)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Email</div>
          <div className="text-gray-800">{member.user?.email ?? '—'}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-gray-500">Role</div>
            <div className="capitalize text-gray-800">{roleDisplay(member)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Status</div>
            <div className="capitalize text-gray-800">{member.status}</div>
            {member.status === 'invited' && member.inviteExpiresAt ? (
              <div className="text-xs text-stone-500 mt-0.5">
                Invite expires{' '}
                {new Date(member.inviteExpiresAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Company-wide view</div>
          <div className="text-gray-800">
            {member.companyWideView === true ||
            member.rolePreset === 'platform_admin'
              ? 'Yes'
              : 'No (own records only)'}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Park scope</div>
          <div className="text-gray-800">
            {memberScopeBadge(member, venueNameById)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-gray-500">Last login</div>
            <div className="text-gray-800">
              {formatAuditDate(member.user?.lastLoginAt, 'datetime')}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Last logout</div>
            <div className="text-gray-800">
              {formatAuditDate(member.user?.lastLogoutAt, 'datetime')}
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Last login IP</div>
          <div className="text-gray-800 font-mono text-xs">
            {member.user?.lastLoginIp?.trim() || '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Membership updated by</div>
          <div className="text-gray-800">
            {formatAuditName(member.updatedByName)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-gray-500">Membership created</div>
            <div className="text-gray-800">
              {formatAuditDate(member.createdAt, 'datetime')}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Membership updated</div>
            <div className="text-gray-800">
              {formatAuditDate(member.updatedAt, 'datetime')}
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">
            Effective permissions ({member.permissions?.length ?? 0})
          </div>
          <div className="rounded-lg border border-gray-100 bg-white p-2">
            <PermissionGrantList
              permissions={member.permissions ?? []}
              emptyMessage="None"
              maxHeightClass="max-h-40"
            />
          </div>
        </div>
        {(member.permissionsOverride?.length ?? 0) > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-1">Overrides</div>
            <div className="rounded-lg border border-gray-100 bg-white p-2">
              <PermissionGrantList
                permissions={member.permissionsOverride}
                maxHeightClass="max-h-32"
              />
            </div>
          </div>
        )}
        {member.invitedBy && (
          <div>
            <div className="text-xs text-gray-500">Invited by</div>
            <div className="font-mono text-xs text-gray-700">{member.invitedBy}</div>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {onHardDelete && (
            <button
              type="button"
              onClick={onHardDelete}
              disabled={hardDeletePending}
              className="px-4 py-2 rounded-lg border border-red-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {hardDeletePending ? 'Deleting…' : 'Delete account'}
            </button>
          )}
          {onResetPassword && (
            <button
              type="button"
              onClick={onResetPassword}
              className="px-4 py-2 rounded-lg border border-stone-300 text-sm text-stone-700 hover:bg-stone-50"
            >
              Reset password
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] text-white text-sm hover:bg-[#D4AF37]/90"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function RoleAssignmentFields({
  assignmentMode,
  onAssignmentModeChange,
  rolePreset,
  onRolePresetChange,
  roleOptions,
  roleTemplateId,
  onRoleTemplateIdChange,
  assignableTemplates,
  hideTemplates = false,
}: {
  assignmentMode: 'preset' | 'template';
  onAssignmentModeChange: (mode: 'preset' | 'template') => void;
  rolePreset: MembershipRolePreset;
  onRolePresetChange: (v: MembershipRolePreset) => void;
  roleOptions: { value: MembershipRolePreset; label: string }[];
  roleTemplateId: string;
  onRoleTemplateIdChange: (id: string) => void;
  assignableTemplates: { _id: string; name: string; permissions: string[] }[];
  /** Franchise managers: preset-only (server stamps park staff pack). */
  hideTemplates?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Role assignment
      </label>
      {!hideTemplates ? (
        <div className="flex gap-4 text-sm mb-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={assignmentMode === 'preset'}
              onChange={() => onAssignmentModeChange('preset')}
            />
            Built-in preset
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={assignmentMode === 'template'}
              onChange={() => onAssignmentModeChange('template')}
            />
            Role template
          </label>
        </div>
      ) : null}
      {hideTemplates || assignmentMode === 'preset' ? (
        <RoleSelect
          value={rolePreset}
          onChange={onRolePresetChange}
          options={roleOptions}
        />
      ) : assignableTemplates.length === 0 ? (
        <p className="text-xs text-amber-700">
          No assignable templates. Create one under Role templates first.
        </p>
      ) : (
        <select
          value={roleTemplateId}
          onChange={(e) => onRoleTemplateIdChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
        >
          {assignableTemplates.map((t) => (
            <option key={t._id} value={t._id}>
              {t.name} ({t.permissions.length} perms)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  options = ROLE_OPTIONS,
}: {
  value: MembershipRolePreset;
  onChange: (v: MembershipRolePreset) => void;
  options?: { value: MembershipRolePreset; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Role preset
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MembershipRolePreset)}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
        disabled={options.length === 0}
      >
        {options.length === 0 ? (
          <option value={value}>No assignable roles</option>
        ) : (
          options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} ({ROLE_PRESETS[opt.value].length} perms)
            </option>
          ))
        )}
      </select>
      <p className="text-xs text-gray-500 mt-1">
        {ROLE_PRESET_META[value]?.summary ??
          'Only roles you are allowed to assign are listed. The Admin role is reserved for platform admins.'}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">
        Only roles you are allowed to assign are listed. The Admin role is
        reserved for platform admins.
      </p>
    </div>
  );
}

function AdvancedOverrides({
  open,
  onToggle,
  grantable,
  basePerms,
  selected,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  grantable: readonly string[];
  basePerms: Set<string>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (perm: string) => {
    if (basePerms.has(perm)) return;
    onChange(
      selected.includes(perm)
        ? selected.filter((p) => p !== perm)
        : [...selected, perm]
    );
  };

  return (
    <div className="rounded-xl border border-gray-100">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800"
      >
        <span>Advanced permission overrides</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3 py-3">
          <p className="text-xs text-gray-500 mb-2">
            Select the actions this role is allowed to perform. Grouped by
            feature / menu.
          </p>
          <PermissionGrantList
            permissions={grantable}
            selected={selected}
            locked={basePerms}
            onToggle={(perm) => toggle(perm)}
            emptyMessage="No grantable permissions."
          />
        </div>
      )}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-gray-100 shadow-xl p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  submitting,
  submitLabel,
  disabled = false,
}: {
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting || disabled}
        className="px-4 py-2 rounded-lg bg-[#D4AF37] text-white text-sm hover:bg-[#D4AF37]/90 disabled:opacity-50 inline-flex items-center gap-2"
      >
        {submitting && <ButtonSpinner />}
        {submitLabel}
      </button>
    </div>
  );
}
