'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import {
  useAdminTailorsQuery,
  usePatchTailorStatusMutation,
} from '@/hooks/useTailors';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import TableAction from '@/components/Protected/admin/pages/components/shared/TableAction';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import type { TailorProfileDto, TailorStatus } from '@/lib/tailors.shared';
import TailorEditModal from './TailorEditModal';

const STATUS_FILTERS: { value: '' | TailorStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'suspended', label: 'Suspended' },
];

function statusClass(status: TailorStatus): string {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-800';
  if (status === 'pending') return 'bg-amber-100 text-amber-800';
  if (status === 'suspended') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
}

export default function TailorsPage() {
  const { addToast } = useToast();
  const { canManageTailors } = useCatalogActionPermissions();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | TailorStatus>('');
  const [debouncedQ, setDebouncedQ] = useState('');

  const { data: tailors = [], isPending, isLoading, isError, refetch } = useAdminTailorsQuery({
    q: debouncedQ,
    status: statusFilter,
  });
  const statusMutation = usePatchTailorStatusMutation();

  const [editTailor, setEditTailor] = useState<TailorProfileDto | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [modalOpen, setModalOpen] = useState(false);

  const openCreate = () => {
    if (!canManageTailors) {
      addToast('You do not have permission to manage tailors', 'error');
      return;
    }
    setMode('create');
    setEditTailor(null);
    setModalOpen(true);
  };

  const openEdit = (tailor: TailorProfileDto) => {
    setMode('edit');
    setEditTailor(tailor);
    setModalOpen(true);
  };

  const applySearch = () => setDebouncedQ(search.trim());

  const setStatus = async (tailor: TailorProfileDto, status: TailorStatus) => {
    if (!canManageTailors) {
      addToast('You do not have permission to manage tailors', 'error');
      return;
    }
    try {
      await statusMutation.mutateAsync({ id: tailor._id, status });
      addToast(`Tailor marked ${status}`, 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to update status',
        'error'
      );
    }
  };

  const rows = useMemo(() => tailors, [tailors]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tailors</h1>
          <p className="mt-1 text-sm text-gray-500">
            Link users as tailors, approve profiles, and suspend providers.
          </p>
        </div>
        {canManageTailors && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900"
          >
            Add tailor
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Search
          </label>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
              }}
              placeholder="Name, slug, email…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={applySearch}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
            >
              Search
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as '' | TailorStatus)
            }
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          >
            {STATUS_FILTERS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">S/N</th>
                <th className="px-4 py-3">Tailor</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Specialties</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated by</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isPending && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#D4AF37]" />
                      <p>Loading tailor profiles…</p>
                      <p className="text-xs text-gray-400">
                        First load can take a few seconds on a remote database.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {isError && !isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-red-500">
                    Failed to load tailors.{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void refetch()}
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    No tailors yet. Link a user to create a provider profile.
                  </td>
                </tr>
              )}
              {rows.map((tailor, index) => (
                <tr key={tailor._id} className="border-t border-gray-50">
                  <td className="px-4 py-3 text-gray-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {tailor.displayName}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      /{tailor.slug}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-800">
                      {tailor.userName || '—'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {tailor.userEmail || tailor.user}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {tailor.specialties.slice(0, 3).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium capitalize ${statusClass(tailor.status)}`}
                    >
                      {tailor.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatAuditName(tailor.updatedByName)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatAuditDate(tailor.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {canManageTailors && (
                        <TableAction
                          intent="edit"
                          onClick={() => openEdit(tailor)}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </TableAction>
                      )}
                      {canManageTailors && tailor.status !== 'approved' && (
                        <TableAction
                          intent="edit"
                          onClick={() => void setStatus(tailor, 'approved')}
                          className="text-sm text-emerald-600 hover:text-emerald-800"
                        >
                          Approve
                        </TableAction>
                      )}
                      {canManageTailors && tailor.status !== 'suspended' && (
                        <TableAction
                          intent="update"
                          onClick={() => void setStatus(tailor, 'suspended')}
                          className="text-sm text-amber-700 hover:text-amber-900"
                        >
                          Suspend
                        </TableAction>
                      )}
                      {canManageTailors && tailor.status === 'suspended' && (
                        <TableAction
                          intent="edit"
                          onClick={() => void setStatus(tailor, 'pending')}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          Reopen
                        </TableAction>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <TailorEditModal
          mode={mode}
          tailor={editTailor}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
