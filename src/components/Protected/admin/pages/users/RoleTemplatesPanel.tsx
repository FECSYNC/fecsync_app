'use client';

import { useMemo, useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  P,
  hasAllPermissions,
  grantableCatalogPermissions,
  isPlatformAdminActor,
  isPermission,
  permissionFeature,
  type Permission,
} from '@/lib/auth/permissions';
import { isAdminUiHiddenPermissionFeature } from '@/lib/adminUiHidden';
import { useToast } from '@/contexts/toast-context';
import {
  useCreateRoleTemplateMutation,
  useDeleteRoleTemplateMutation,
  useRoleTemplatesQuery,
  useUpdateRoleTemplateMutation,
  type RoleTemplate,
} from '@/hooks/useRoleTemplates';
import {
  ButtonSpinner,
  PageSpinner,
} from '@/components/Protected/admin/components/Spinner';
import PermissionGrantList from '@/components/Protected/admin/pages/users/PermissionGrantList';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import { signInHref } from '@/utils/authRedirect';
import { clearUserQueries } from '@/utils/clearUserQueries';
import { useBillingUsageQuery } from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import { isStorefrontOrgSession } from '@/services/auth';
import {
  BILLING_REQUIRED_MESSAGE,
  softGateBlockedMessage,
  softGateInlineHint,
} from '@/utils/planLimitSoftGate';

function ActionSpinner({ className = 'text-current' }: { className?: string }) {
  return <ButtonSpinner className={`h-3.5 w-3.5 shrink-0 ${className}`} />;
}

export default function RoleTemplatesPanel() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canRead = can(P.UsersRead);
  // Park-locked seats: APIs assertNotParkLockedCompanyHq — hide mutate UI.
  const canManage =
    can(P.UsersManageRoles) && user?.parkLocked !== true;
  const { data, isLoading, isError, refetch } = useRoleTemplatesQuery(canRead);
  const templates = data?.templates ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<RoleTemplate | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const navigating = Boolean(pendingKey) || isPending;
  const { addToast } = useToast();

  const canLoadUsage =
    canManage && !isStorefrontOrgSession(user);
  const usageQuery = useBillingUsageQuery(canLoadUsage);
  const roleTemplatesMeter = usageMeterFor(usageQuery.data, 'roleTemplates');
  const usageReady =
    !canLoadUsage || Boolean(usageQuery.data) || usageQuery.isError;
  const roleTemplatesAtLimit =
    canLoadUsage &&
    !usageQuery.isError &&
    (!usageReady ||
      !roleTemplatesMeter ||
      (!roleTemplatesMeter.unlimited &&
        (roleTemplatesMeter.remaining ?? 0) <= 0));
  const createBlockedHint = softGateInlineHint(
    usageQuery.data,
    'roleTemplates',
    Boolean(roleTemplatesAtLimit),
    {
      zeroCap:
        Boolean(roleTemplatesMeter) &&
        !roleTemplatesMeter?.unlimited &&
        roleTemplatesMeter?.limit === 0,
    }
  );

  const isBusy = (key: string) => pendingKey === key;

  const runAction = (key: string, action: () => void) => {
    if (pendingKey) return;
    setPendingKey(key);
    startTransition(() => {
      action();
    });
  };

  useEffect(() => {
    if (pendingKey === 'new-template' && createOpen) setPendingKey(null);
    if (pendingKey?.startsWith('edit:') && editTemplate) setPendingKey(null);
  }, [createOpen, editTemplate, pendingKey]);

  useEffect(() => {
    if (!pendingKey) return;
    const safety = window.setTimeout(() => setPendingKey(null), 8000);
    return () => window.clearTimeout(safety);
  }, [pendingKey]);

  if (isLoading && templates.length === 0) return <PageSpinner className="h-48" />;

  if (isError && templates.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
        <span>Could not load role templates.</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-[#D4AF37] font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          Reusable permission bundles for staff. Assign a template when inviting
          or creating members (role preset must be Custom). Company-wide view is
          set per member on invite/edit — not on the template itself.
          {createBlockedHint ? (
            <span className="mt-1 block text-amber-800">{createBlockedHint}</span>
          ) : roleTemplatesMeter ? (
            <span className="mt-1 block text-xs text-stone-500">
              {roleTemplatesMeter.unlimited
                ? `Role templates: ${roleTemplatesMeter.used} · unlimited`
                : `Role templates: ${roleTemplatesMeter.used}/${roleTemplatesMeter.limit} · ${roleTemplatesMeter.remaining ?? 0} remaining`}
            </span>
          ) : null}
        </p>
        {canManage && (
          <button
            type="button"
            disabled={
              roleTemplatesAtLimit ||
              (navigating && !isBusy('new-template'))
            }
            aria-busy={isBusy('new-template')}
            onClick={() => {
              if (roleTemplatesAtLimit) {
                addToast(
                  softGateBlockedMessage(usageQuery.data, 'roleTemplates', {
                    atLimit: true,
                    usageReady: usageReady && Boolean(roleTemplatesMeter),
                    zeroCap:
                      Boolean(roleTemplatesMeter) &&
                      !roleTemplatesMeter?.unlimited &&
                      roleTemplatesMeter?.limit === 0,
                  }) ?? 'Could not verify plan capacity',
                  'error'
                );
                return;
              }
              runAction('new-template', () => setCreateOpen(true));
            }}
            className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 text-sm inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy('new-template') ? (
              <ActionSpinner className="text-white" />
            ) : null}
            New template
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
                <th className="px-4 py-3 font-medium">Created by</th>
                <th className="px-4 py-3 font-medium">Updated by</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    No role templates yet.
                    {canManage ? ' Create one to reuse across members.' : ''}
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr
                    key={template._id}
                    className="border-b border-gray-50 hover:bg-gray-50/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{template.name}</div>
                      {template.description ? (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {template.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-600">
                        {template.permissions.length} permission
                        {template.permissions.length === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                      {formatAuditName(template.createdByName)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                      {formatAuditName(template.updatedByName)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatAuditDate(template.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatAuditDate(template.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage ? (
                        <button
                          type="button"
                          disabled={
                            navigating && !isBusy(`edit:${template._id}`)
                          }
                          aria-busy={isBusy(`edit:${template._id}`)}
                          onClick={() =>
                            runAction(`edit:${template._id}`, () =>
                              setEditTemplate(template)
                            )
                          }
                          className="px-2.5 py-1 rounded-lg text-xs border border-[#D4AF37]/40 text-[#8a7010] hover:bg-[#D4AF37]/10 inline-flex items-center gap-1 disabled:cursor-wait"
                        >
                          Edit
                          {isBusy(`edit:${template._id}`) ? (
                            <ActionSpinner className="text-[#8a7010]" />
                          ) : null}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <RoleTemplateModal
          onClose={() => setCreateOpen(false)}
          createBlocked={roleTemplatesAtLimit}
          createBlockedHint={createBlockedHint}
        />
      )}
      {editTemplate && (
        <RoleTemplateModal
          template={editTemplate}
          onClose={() => setEditTemplate(null)}
        />
      )}
    </div>
  );
}

function RoleTemplateModal({
  template,
  onClose,
  createBlocked = false,
  createBlockedHint = null,
}: {
  template?: RoleTemplate;
  onClose: () => void;
  createBlocked?: boolean;
  createBlockedHint?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { addToast } = useToast();
  const createMutation = useCreateRoleTemplateMutation();
  const updateMutation = useUpdateRoleTemplateMutation();
  const deleteMutation = useDeleteRoleTemplateMutation();
  const isEdit = Boolean(template);

  const grantable = useMemo(
    () => grantableCatalogPermissions(user),
    [user]
  );

  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [selected, setSelected] = useState<string[]>(template?.permissions ?? []);

  const toggle = (perm: string) => {
    setSelected((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit && createBlocked) {
      addToast(
        createBlockedHint ?? BILLING_REQUIRED_MESSAGE,
        'error'
      );
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      addToast('Name is required', 'error');
      return;
    }
    const held = grantable;
    const visiblePerms = selected.filter((p): p is Permission =>
      held.includes(p as Permission)
    );
    // Keep UI-hidden grants that already lived on the template (matrix omits them).
    const preservedHidden: Permission[] = [];
    for (const raw of template?.permissions ?? []) {
      if (!isPermission(raw)) continue;
      if (!isAdminUiHiddenPermissionFeature(permissionFeature(raw))) continue;
      if (held.includes(raw)) preservedHidden.push(raw);
    }
    const perms = Array.from(new Set([...visiblePerms, ...preservedHidden]));
    if (!hasAllPermissions(held, perms)) {
      addToast('Cannot grant permissions beyond your own', 'error');
      return;
    }
    try {
      if (isEdit && template) {
        const result = await updateMutation.mutateAsync({
          id: template._id,
          name: trimmed,
          description: description.trim(),
          permissions: perms,
        });
        addToast('Role template updated', 'success');
        const selfId = user?.id;
        if (
          selfId &&
          result.invalidatedAssigneeIds.some((id) => String(id) === String(selfId))
        ) {
          addToast(
            'Your membership changed. Please sign in again to refresh permissions.',
            'info'
          );
          clearUserQueries(queryClient);
          queryClient.removeQueries({ queryKey: ['admin-members'] });
          await logout();
          router.push(signInHref('/admin/users'));
          return;
        }
      } else {
        await createMutation.mutateAsync({
          name: trimmed,
          description: description.trim(),
          permissions: perms,
        });
        addToast('Role template created', 'success');
      }
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!template) return;
    if (!window.confirm(`Delete template "${template.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(template._id);
      addToast('Role template deleted', 'success');
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const submitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-gray-100 shadow-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {isEdit ? 'Edit role template' : 'New role template'}
        </h2>
        {!isEdit && createBlockedHint ? (
          <p className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {createBlockedHint}
          </p>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="rounded-xl border border-gray-100 px-3 py-3">
            <p className="text-xs text-gray-500 mb-2">
              {isPlatformAdminActor(user)
                ? 'Select the actions this role is allowed to perform (full catalog).'
                : 'Select the actions this role is allowed to perform (only features you can grant).'}
            </p>
            <PermissionGrantList
              permissions={grantable}
              selected={selected}
              onToggle={toggle}
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            {isEdit ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={submitting}
                className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Delete template
              </button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || (!isEdit && createBlocked)}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                {submitting && <ButtonSpinner />}
                {isEdit ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
