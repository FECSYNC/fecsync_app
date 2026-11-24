'use client';

import { useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import {
  useAddUserBlacklistMutation,
  useRemoveUserBlacklistMutation,
  useUserBlacklistQuery,
} from '@/hooks/useUserBlacklist';
import type { UserBlacklistType } from '@/services/userBlacklist';
import { ButtonSpinner, PageSpinner } from '@/components/Protected/admin/components/Spinner';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';

export default function UserBlacklistPanel({ canManage }: { canManage: boolean }) {
  const { addToast } = useToast();
  const listQuery = useUserBlacklistQuery(canManage);
  const addMutation = useAddUserBlacklistMutation();
  const removeMutation = useRemoveUserBlacklistMutation();

  const [type, setType] = useState<UserBlacklistType>('email');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const entries = listQuery.data?.entries ?? [];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!value.trim()) {
      addToast('Enter an email or phone number', 'error');
      return;
    }
    try {
      await addMutation.mutateAsync({
        type,
        value: value.trim(),
        reason: reason.trim() || undefined,
      });
      setValue('');
      setReason('');
      addToast('Added to blacklist', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to add blacklist entry',
        'error'
      );
    }
  };

  const handleRemove = async (id: string, label: string) => {
    if (!canManage) return;
    if (
      !window.confirm(
        `Remove "${label}" from the blacklist?\n\nThey will be able to create an account with this identity again.`
      )
    ) {
      return;
    }
    try {
      setRemovingId(id);
      await removeMutation.mutateAsync(id);
      addToast('Removed from blacklist', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to remove blacklist entry',
        'error'
      );
    } finally {
      setRemovingId(null);
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        You need <strong>Manage Account Blacklist</strong> (
        <code>users:blacklist</code>) permission to manage the blacklist.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Account blacklist</h2>
        <p className="text-sm text-gray-600 mt-1">
          Blocked emails and phone numbers cannot sign up, sign in, or be
          recreated until you remove them. Permanent user deletes also add the
          account email/phone here automatically.
        </p>
      </div>

      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-gray-200 bg-white p-4 space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as UserBlacklistType)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">
              {type === 'email' ? 'Email address' : 'Phone number'}
            </label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                type === 'email' ? 'user@example.com' : '+234 801 234 5678'
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-[#D4AF37]/90 disabled:opacity-60"
            >
              {addMutation.isPending && <ButtonSpinner />}
              Add to blacklist
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Reason (optional)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Security / abuse / fraud…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
      </form>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800">
          Blacklisted identities ({entries.length})
        </div>
        {listQuery.isLoading && entries.length === 0 ? (
          <PageSpinner className="h-40" />
        ) : listQuery.isError && entries.length === 0 ? (
          <div className="p-4 text-sm text-red-700">
            Failed to load blacklist.{' '}
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              className="underline"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No blacklisted emails or phones yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                  <th className="px-4 py-2 font-medium">Created by</th>
                  <th className="px-4 py-2 font-medium">Updated by</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry._id} className="border-t border-gray-50">
                    <td className="px-4 py-3 capitalize text-gray-700">
                      {entry.type}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-900">
                      {entry.value}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {entry.source === 'hard_delete'
                        ? 'After delete'
                        : 'Manual'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-[14rem] truncate">
                      {entry.reason || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatAuditName(entry.createdByName)}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatAuditName(entry.updatedByName)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatAuditDate(entry.createdAt, 'datetime')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatAuditDate(entry.updatedAt, 'datetime')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          void handleRemove(entry._id, entry.value)
                        }
                        disabled={
                          removeMutation.isPending && removingId === entry._id
                        }
                        aria-busy={removingId === entry._id}
                        className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1"
                      >
                        Remove
                        {removingId === entry._id ? (
                          <ButtonSpinner className="h-3 w-3 shrink-0 text-red-600" />
                        ) : null}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
