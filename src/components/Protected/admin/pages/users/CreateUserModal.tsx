'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  expandRoleToPermissions,
  hasAllPermissions,
  grantableCatalogPermissions,
  isPlatformAdminActor,
  isPermission,
  ROLE_PRESET_META,
  P,
  type Permission,
} from '@/lib/auth/permissions';
import { MEMBERSHIP_ROLE_PRESETS } from '@/lib/membershipConstants';
import { useToast } from '@/contexts/toast-context';
import { useCreateAdminUserMutation } from '@/hooks/useMembers';
import { useRoleTemplatesQuery } from '@/hooks/useRoleTemplates';
import { useBillingUsageQuery } from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import { softGateBlockedMessage } from '@/utils/planLimitSoftGate';
import { isStorefrontOrgSession } from '@/services/auth';
import type { MembershipRolePreset } from '@/services/members';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import PermissionGrantList from '@/components/Protected/admin/pages/users/PermissionGrantList';
import { VenueParkAssignmentField } from '@/components/Protected/admin/pages/users/VenueParkAssignmentField';
import { useQuery } from '@tanstack/react-query';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';

const ROLE_OPTIONS: { value: MembershipRolePreset; label: string }[] =
  MEMBERSHIP_ROLE_PRESETS.map((value) => ({
    value,
    label: ROLE_PRESET_META[value]?.label ?? value,
  }));

function assignableRoleOptions(actor: {
  preset?: string | null;
  membershipRole?: string | null;
  permissions?: string[] | null;
} | null) {
  const grantable = grantableCatalogPermissions(actor);
  return ROLE_OPTIONS.filter((opt) => {
    if (opt.value === 'platform_admin' && !isPlatformAdminActor(actor)) {
      return false;
    }
    return hasAllPermissions(grantable, expandRoleToPermissions(opt.value));
  });
}

function overrideBeyondBase(base: Set<string>, selected: string[]) {
  return selected.filter((p) => !base.has(p));
}

export default function CreateUserModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const { addToast } = useToast();
  const createMutation = useCreateAdminUserMutation();
  const { data: templatesData, isLoading: templatesLoading } =
    useRoleTemplatesQuery(true);
  const templates = templatesData?.templates ?? [];

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

  const grantable = useMemo(
    () => grantableCatalogPermissions(user),
    [user]
  );

  const actorCanGrantCwv =
    user?.preset === 'platform_admin' ||
    user?.membershipRole === 'platform_admin' ||
    user?.companyWideView !== false;

  const roleOptions = useMemo(() => assignableRoleOptions(user), [user]);
  const assignableTemplates = useMemo(
    () =>
      templates.filter((t) =>
        hasAllPermissions(
          grantable,
          t.permissions.filter((p): p is Permission => isPermission(p))
        )
      ),
    [templates, grantable]
  );

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [assignmentMode, setAssignmentMode] = useState<'preset' | 'template'>(
    'preset'
  );
  const [rolePreset, setRolePreset] = useState<MembershipRolePreset>(
    roleOptions.find((o) => o.value === 'catalog_editor')?.value ??
      roleOptions[0]?.value ??
      'custom'
  );
  const [roleTemplateId, setRoleTemplateId] = useState('');
  const [activateNow, setActivateNow] = useState(true);
  // Opt-in: company-wide must be explicitly checked (Admin role still forces on).
  const [companyWideView, setCompanyWideView] = useState(false);
  const [overrideSelected, setOverrideSelected] = useState<string[]>([]);
  const [assignedLocationIds, setAssignedLocationIds] = useState<string[]>([]);

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled:
      actorCanGrantCwv &&
      user?.parkLocked !== true &&
      Boolean(user?.orgId) &&
      !isStorefrontOrgSession(user),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (assignmentMode === 'preset' && rolePreset === 'platform_admin') {
      setCompanyWideView(true);
    } else if (!actorCanGrantCwv) {
      setCompanyWideView(false);
    }
  }, [assignmentMode, rolePreset, actorCanGrantCwv]);

  useEffect(() => {
    if (assignmentMode === 'preset' && !roleOptions.some((o) => o.value === rolePreset)) {
      setRolePreset(roleOptions[0]?.value ?? 'custom');
    }
  }, [assignmentMode, roleOptions, rolePreset]);

  useEffect(() => {
    if (assignmentMode === 'template' && !roleTemplateId && assignableTemplates[0]) {
      setRoleTemplateId(assignableTemplates[0]._id);
    }
  }, [assignmentMode, roleTemplateId, assignableTemplates]);

  const basePerms = useMemo(() => {
    if (assignmentMode === 'template') {
      const t = assignableTemplates.find((x) => x._id === roleTemplateId);
      return new Set(t?.permissions ?? []);
    }
    return new Set<string>(expandRoleToPermissions(rolePreset));
  }, [assignmentMode, rolePreset, roleTemplateId, assignableTemplates]);

  const tailorSeatsAtLimit =
    assignmentMode === 'preset' &&
    rolePreset === 'tailor' &&
    canLoadUsage &&
    (!usageReady ||
      !tailorSeatsMeter ||
      (!tailorSeatsMeter.unlimited &&
        (tailorSeatsMeter.remaining ?? 0) <= 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || password.length < 8) {
      addToast('Name, email, and password (8+ chars) are required', 'error');
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
    if (tailorSeatsAtLimit) {
      addToast(
        softGateBlockedMessage(usageQuery.data, 'tailorSeats', {
          atLimit: true,
          usageReady: usageReady && Boolean(tailorSeatsMeter),
        }) ?? 'Could not verify plan capacity',
        'error'
      );
      return;
    }
    if (assignmentMode === 'template' && !roleTemplateId) {
      addToast('Select a role template', 'error');
      return;
    }
    const permissionsOverride = overrideBeyondBase(basePerms, overrideSelected);
    const held = grantable;
    const safeOverride = permissionsOverride.filter((p): p is Permission =>
      held.includes(p as Permission)
    );
    // Mirror API assertAssignableGrantsExtended: template ∪ override (or preset ∪ override).
    const effectiveGrant = [
      ...(assignmentMode === 'template'
        ? [...basePerms].filter((p): p is Permission => isPermission(p))
        : expandRoleToPermissions(rolePreset)),
      ...safeOverride,
    ];
    if (!hasAllPermissions(held, effectiveGrant)) {
      addToast('Cannot grant permissions beyond your own', 'error');
      return;
    }
    const nextCwv =
      assignmentMode === 'preset' && rolePreset === 'platform_admin'
        ? true
        : companyWideView === true && actorCanGrantCwv;
    const isPlatformAdmin =
      assignmentMode === 'preset' && rolePreset === 'platform_admin';
    try {
      const result = await createMutation.mutateAsync({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        rolePreset: assignmentMode === 'template' ? 'custom' : rolePreset,
        roleTemplateId:
          assignmentMode === 'template' ? roleTemplateId : null,
        ...(safeOverride.length > 0 ? { permissionsOverride: safeOverride } : {}),
        companyWideView: nextCwv,
        status: activateNow ? 'active' : 'invited',
        ...(!isPlatformAdmin && assignedLocationIds.length > 0
          ? { locationIds: assignedLocationIds }
          : {}),
      });
      if (result.parkAssignError) {
        addToast(
          `User created, but park assignment failed: ${result.parkAssignError}`,
          'error'
        );
      } else {
        addToast('User created', 'success');
      }
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Create failed', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-gray-100 shadow-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create user</h2>
        {!isPlatformAdminActor(user) && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
            Only an Admin can assign the Admin role or the full Admin permission set.
          </p>
        )}
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
          {!activateNow ? (
            <p className="text-xs text-stone-500">
              Leaving as invited: the seat expires after about 14 days if unused.
            </p>
          ) : null}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full name
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Temporary password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              minLength={8}
              required
            />
          </div>

          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setAssignmentMode('preset')}
              className={`px-3 py-1.5 rounded-lg border ${
                assignmentMode === 'preset'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                  : 'border-gray-200'
              }`}
            >
              Role preset
            </button>
            <button
              type="button"
              onClick={() => setAssignmentMode('template')}
              className={`px-3 py-1.5 rounded-lg border ${
                assignmentMode === 'template'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              Role template
            </button>
          </div>
          {assignmentMode === 'template' && templatesLoading ? (
            <p className="text-xs text-gray-500">Loading role templates…</p>
          ) : assignmentMode === 'template' &&
            !templatesLoading &&
            assignableTemplates.length === 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {templates.length === 0
                ? 'No role templates yet. Open the Role templates tab and click New template first, then return here.'
                : 'None of your role templates can be assigned with your current permissions. Create a simpler template or ask an Admin.'}
            </p>
          ) : null}

          {assignmentMode === 'preset' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <select
                value={rolePreset}
                onChange={(e) =>
                  setRolePreset(e.target.value as MembershipRolePreset)
                }
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {roleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({expandRoleToPermissions(opt.value).length} perms)
                  </option>
                ))}
              </select>
            </div>
          ) : assignableTemplates.length === 0 ? (
            <p className="text-xs text-amber-700">
              Select a template above once one is available.
            </p>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template
              </label>
              <select
                value={roleTemplateId}
                onChange={(e) => setRoleTemplateId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {assignableTemplates.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name} ({t.permissions.length} perms)
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={activateNow}
              onChange={(e) => setActivateNow(e.target.checked)}
            />
            Activate immediately
          </label>

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5"
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
                See all organization records for the features this user can
                access. Unchecked: only their own records (orders they placed,
                products they created, chats they replied to, etc.). Admins
                always have company-wide view.
              </span>
            </span>
          </label>

          {actorCanGrantCwv &&
          user?.parkLocked !== true &&
          !(assignmentMode === 'preset' && rolePreset === 'platform_admin') ? (
            <VenueParkAssignmentField
              venues={venuesQuery.data ?? []}
              selectedIds={assignedLocationIds}
              onChange={setAssignedLocationIds}
              loading={venuesQuery.isLoading}
            />
          ) : null}

          <div className="rounded-xl border border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-500 mb-2">
              Select the actions this user is allowed to perform
              ({grantable.length} available)
            </p>
            <PermissionGrantList
              permissions={grantable}
              selected={overrideSelected}
              locked={basePerms}
              onToggle={(perm) => {
                setOverrideSelected((prev) =>
                  prev.includes(perm)
                    ? prev.filter((p) => p !== perm)
                    : [...prev, perm]
                );
              }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                createMutation.isPending ||
                membersAtLimit ||
                tailorSeatsAtLimit ||
                roleOptions.length === 0 ||
                (assignmentMode === 'template' &&
                  (templatesLoading || assignableTemplates.length === 0))
              }
              className="px-4 py-2 text-sm rounded-lg bg-[#D4AF37] text-white disabled:opacity-60 inline-flex items-center gap-2"
            >
              {createMutation.isPending && <ButtonSpinner />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
