'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import {
  ADMIN_LIST_STALE_MS,
  isAdminListBlockingLoad,
} from '@/lib/adminListCache';
import { adminListSnapshotSeed } from '@/lib/adminListSnapshot';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
import {
  archiveMembershipCategory,
  createMembershipCategory,
  listMembershipCategories,
  membershipKeys,
  updateMembershipCategory,
  type MembershipCategoryDto,
} from '@/services/memberships';
import { notifyMembershipChange } from '@/lib/membershipsSync';
import {
  broadcastCatalogChange,
  invalidateCatalogQueries,
} from '@/lib/catalogSync';
import { PublicCategoryCopyMenu } from '@/components/Protected/admin/pages/public-category/PublicCategoryCopyMenu';
import { PublicCategorySettingsButton } from '@/components/Protected/admin/pages/public-category/PublicCategorySettingsButton';

const CATEGORIES_GUIDE_STEPS = [
  {
    title: 'What this is',
    body: 'Membership categories are folders for guest park membership plans only. They are separate from Catalog product categories (Food sales) and Online Booking → Booking category (ticket products).',
    href: '/admin/memberships/plans',
    hrefLabel: 'Open Create plan',
  },
  {
    title: 'Create a category',
    body: 'Add a short name (and optional description). A public link is created once from that name. Renaming later does not change the link. The Copy button in the Actions column copies either the public link or the iframe embed, for anyone who can read membership categories. Writers use the Public link button in the Actions column to change the public slug, layout, and embed flag. Then assign the category when creating or editing a plan under Create plan.',
  },
  {
    title: 'Archive safely',
    body: 'Archiving unlinks the category from plans so those plans stay sellable. The public page for that category becomes inactive in the same step. Recreate with the same name to restore the folder and turn that same public link back on.',
  },
];

export default function MembershipCategoriesPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const hasHydratedAuth = useAuthStore((s) => s.hasHydratedAuth);
  const canWrite = can(P.MembershipsWrite);
  const canRead =
    can(P.MembershipsRead) ||
    canWrite ||
    can(P.MembershipsAdmin) ||
    can(P.MembershipsSell) ||
    can(P.MembershipsBilling) ||
    can(P.MembershipsCancel) ||
    can(P.MembershipsRedeem);

  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MembershipCategoryDto | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const categoriesKey = membershipKeys.categories(showArchived);
  const snapshotSeed =
    adminListSnapshotSeed<MembershipCategoryDto[]>(categoriesKey);

  const categoriesQuery = useQuery({
    queryKey: categoriesKey,
    queryFn: () =>
      listMembershipCategories({ includeArchived: showArchived }),
    enabled: hasHydratedAuth && canRead,
    staleTime: ADMIN_LIST_STALE_MS,
    placeholderData: (prev) => prev,
    initialData: snapshotSeed.initialData,
    initialDataUpdatedAt: snapshotSeed.initialDataUpdatedAt,
  });

  useEffect(() => {
    if (!categoriesQuery.isError) return;
    const err = categoriesQuery.error;
    addToast(
      err instanceof Error
        ? err.message
        : 'Failed to load membership categories',
      'error'
    );
  }, [categoriesQuery.isError, categoriesQuery.error, addToast]);

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setName('');
    setDescription('');
  };

  const { overlayDismissProps } = useOverlayDismiss(closeModal);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saveMutation.isPending) closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveMutation identity churns
  }, [modalOpen]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required');
      const body = {
        name: trimmed,
        description: description.trim() || null,
      };
      if (editing) {
        return updateMembershipCategory(editing.id, body);
      }
      return createMembershipCategory(body);
    },
    onSuccess: (category) => {
      addToast(editing ? 'Category updated' : 'Category created', 'success');
      closeModal();
      notifyMembershipChange(queryClient, {
        kind: 'category',
        action: editing ? 'update' : 'create',
        id: category.id,
      });
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : 'Could not save category',
        'error'
      );
    },
  });

  const publicSaveMutation = useMutation({
    mutationFn: (input: {
      id: string;
      slug: string;
      layout: 'auto' | 'grid' | 'stack';
      embedEnabled: boolean;
    }) =>
      updateMembershipCategory(input.id, {
        slug: input.slug,
        layout: input.layout,
        embedEnabled: input.embedEnabled,
      }),
    onSuccess: (updated) => {
      addToast('Public page saved', 'success');
      queryClient.setQueriesData<MembershipCategoryDto[]>(
        { queryKey: [...membershipKeys.all, 'categories'] },
        (old) =>
          Array.isArray(old)
            ? old.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
            : old
      );
      invalidateCatalogQueries(queryClient, 'public-category-links');
      broadcastCatalogChange({
        kind: 'public-category-links',
        action: 'update',
      });
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : 'Could not save public page',
        'error'
      );
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveMembershipCategory(id),
    onSuccess: (_data, id) => {
      addToast('Category archived', 'success');
      notifyMembershipChange(queryClient, {
        kind: 'category',
        action: 'delete',
        id,
      });
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : 'Could not archive category',
        'error'
      );
    },
  });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setModalOpen(true);
  };

  const openEdit = (row: MembershipCategoryDto) => {
    setEditing(row);
    setName(row.name);
    setDescription(row.description ?? '');
    setModalOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  // Never blank the leaf on auth hydrate — shell paints immediately.
  if (!canRead && hasHydratedAuth) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
        You do not have permission to view membership categories.
      </div>
    );
  }

  const categories = categoriesQuery.data ?? [];
  const showListSpinner =
    hasHydratedAuth &&
    canRead &&
    isAdminListBlockingLoad(categoriesQuery.isLoading, categories.length);

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-xl sm:text-2xl font-bold text-gray-900">
            Membership categories{' '}
            <span className="text-base sm:text-lg font-normal text-gray-500">
              ({categories.length})
            </span>
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            Folders for guest park membership plans — separate from shop Catalog
            categories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          {canWrite ? (
            <button
              type="button"
              onClick={openCreate}
              className="w-full sm:w-auto bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>ADD CATEGORY</span>
            </button>
          ) : null}
        </div>
      </div>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Membership categories"
          subtitle="Guest park Memberships catalog folders."
          steps={CATEGORIES_GUIDE_STEPS}
        />
      ) : null}

      {showListSpinner ? (
        <p className="text-sm text-stone-500">Loading categories…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
              <tr>
                <th className="px-4 py-3 font-medium w-14">#</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Plans</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {categories.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-stone-500"
                  >
                    <p>No membership categories yet.</p>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={openCreate}
                        className="mt-4 inline-flex items-center justify-center space-x-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-medium text-white hover:bg-[#D4AF37]/90"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>ADD CATEGORY</span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                categories.map((row, index) => (
                  <tr key={row.id} className="align-middle">
                    <td className="px-4 py-3 text-stone-500">{index + 1}</td>
                    <td className="px-4 py-3 font-medium text-stone-900">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {row.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-stone-700">{row.planCount}</td>
                    <td className="px-4 py-3">
                      {row.archivedAt ? (
                        <span className="text-xs text-stone-500">Archived</span>
                      ) : (
                        <span className="text-xs text-emerald-700">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <PublicCategoryCopyMenu page={row.publicPage} />
                        {canWrite && !row.archivedAt ? (
                          <>
                            <PublicCategorySettingsButton
                              categoryName={row.name}
                              page={row.publicPage}
                              saving={
                                publicSaveMutation.isPending &&
                                publicSaveMutation.variables?.id === row.id
                              }
                              onSave={(patch) =>
                                publicSaveMutation.mutate({ id: row.id, ...patch })
                              }
                            />
                            <button
                              type="button"
                              className="rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700"
                              onClick={() => openEdit(row)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700"
                              disabled={archiveMutation.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Archive “${row.name}”? Plans using it will be unlinked.`
                                  )
                                ) {
                                  archiveMutation.mutate(row.id);
                                }
                              }}
                            >
                              Archive
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && canWrite ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="membership-category-modal-title"
          {...overlayDismissProps}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="membership-category-modal-title"
              className="text-lg font-semibold text-stone-900"
            >
              {editing ? 'Edit category' : 'Add category'}
            </h2>
            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">
                  Name
                </label>
                <input
                  className={fieldClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  autoFocus
                  placeholder="Enter category name"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">
                  Description
                </label>
                <textarea
                  className={fieldClass}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  placeholder="Enter category description"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded border border-stone-300 px-4 py-2 text-sm text-stone-700"
                  onClick={closeModal}
                  disabled={saveMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={btnPrimaryClass}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <ButtonSpinner /> : null}
                  {editing ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
