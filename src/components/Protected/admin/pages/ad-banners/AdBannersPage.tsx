'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import {
  useAdminAdBannersQuery,
  useDeleteAdBannerMutation,
  useUpdateAdBannerMutation,
} from '@/hooks/useAdBanners';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import TableAction from '@/components/Protected/admin/pages/components/shared/TableAction';
import type { AdBannerDto } from '@/lib/adBanners.shared';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import AdBannerEditModal from './AdBannerEditModal';
import AdBannerViewModal from './AdBannerViewModal';

export default function AdBannersPage() {
  const { addToast } = useToast();
  const { canManageAdBanners } = useCatalogActionPermissions();
  const { data: banners = [], isPending, isLoading, isError } = useAdminAdBannersQuery();
  const updateMutation = useUpdateAdBannerMutation();
  const deleteMutation = useDeleteAdBannerMutation();

  const [editBanner, setEditBanner] = useState<AdBannerDto | null>(null);
  const [viewBanner, setViewBanner] = useState<AdBannerDto | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const nextOrder = useMemo(() => {
    if (!banners.length) return 0;
    return Math.max(...banners.map((b) => b.order)) + 1;
  }, [banners]);

  const openCreate = () => {
    if (!canManageAdBanners) {
      addToast('You do not have permission to manage ad banners', 'error');
      return;
    }
    setMode('create');
    setEditBanner(null);
    setModalOpen(true);
  };

  const openEdit = (banner: AdBannerDto) => {
    setMode('edit');
    setEditBanner(banner);
    setModalOpen(true);
  };

  const handleToggleActive = async (banner: AdBannerDto) => {
    if (!canManageAdBanners) {
      addToast('You do not have permission to update banners', 'error');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: banner._id,
        payload: { active: !banner.active },
      });
      addToast(
        banner.active ? 'Banner hidden from store' : 'Banner published to store',
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to update banner',
        'error'
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteId || !canManageAdBanners) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      addToast('Banner deleted', 'success');
      setDeleteId(null);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to delete banner',
        'error'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ad banners</h1>
          <p className="mt-1 text-sm text-gray-500">
            Slider ads for the Trending Fashion sidebar. Add as many as you need.
          </p>
        </div>
        {canManageAdBanners && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900"
          >
            Add banner
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">S/N</th>
                <th className="px-4 py-3">Preview</th>
                <th className="px-4 py-3">Heading</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created by</th>
                <th className="px-4 py-3">Updated by</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isPending && banners.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                    Loading banners…
                  </td>
                </tr>
              )}
              {isError && !isLoading && banners.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-red-500">
                    Failed to load banners.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && banners.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                    No banners yet. Create one to fill the Trending Fashion sidebar.
                  </td>
                </tr>
              )}
              {banners.map((banner, index) => (
                <tr key={banner._id} className="border-t border-gray-50">
                  <td className="px-4 py-3 text-gray-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={banner.image}
                      alt=""
                      className="h-12 w-16 rounded-lg object-cover"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{banner.heading}</div>
                    <div className="mt-0.5 line-clamp-1 max-w-xs text-xs text-gray-500">
                      {banner.paragraph}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{banner.order}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={!canManageAdBanners || updateMutation.isPending}
                      onClick={() => handleToggleActive(banner)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        banner.active
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-gray-100 text-gray-500'
                      } ${canManageAdBanners ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                    >
                      {banner.active ? 'Active' : 'Hidden'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatAuditName(banner.createdByName)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatAuditName(banner.updatedByName)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatAuditDate(banner.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatAuditDate(banner.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <TableAction
                        intent="view"
                        onClick={() => setViewBanner(banner)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        View
                      </TableAction>
                      {canManageAdBanners && (
                        <TableAction
                          intent="edit"
                          onClick={() => openEdit(banner)}
                          className="text-sm text-[#D4AF37] hover:underline"
                        >
                          Edit
                        </TableAction>
                      )}
                      {canManageAdBanners && (
                        <TableAction
                          intent="delete"
                          pendingLabel="Opening…"
                          onClick={() => setDeleteId(banner._id)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Delete
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

      {viewBanner && (
        <AdBannerViewModal
          banner={viewBanner}
          onClose={() => setViewBanner(null)}
        />
      )}

      {modalOpen && (
        <AdBannerEditModal
          banner={editBanner}
          mode={mode}
          nextOrder={nextOrder}
          onClose={() => setModalOpen(false)}
          onSaved={() =>
            addToast(
              mode === 'edit' ? 'Banner updated' : 'Banner created',
              'success'
            )
          }
        />
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete banner?</h3>
            <p className="mt-2 text-sm text-gray-500">
              This removes the banner from the storefront slider immediately.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
