'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import {
  useAdminHomepageSectionsQuery,
  useResetHomepageSectionMutation,
  useUpdateHomepageSectionMutation,
} from '@/hooks/useHomepageContent';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import TableAction from '@/components/Protected/admin/pages/components/shared/TableAction';
import type {
  HomepageSectionDto,
  HomepageSectionKey,
} from '@/lib/homepageContent.shared';
import { SECTION_LABELS } from '@/lib/homepageContent.shared';
import HomepageSectionViewModal from './HomepageSectionViewModal';
import HomepageSectionEditModal from './HomepageSectionEditModal';
import HomepageSectionResetModal from './HomepageSectionResetModal';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';

export default function HomepageContentPage() {
  const { addToast } = useToast();
  const { canManageHomepage } = useCatalogActionPermissions();
  const { data: sections = [], isLoading, isError } = useAdminHomepageSectionsQuery();
  const updateMutation = useUpdateHomepageSectionMutation();
  const resetMutation = useResetHomepageSectionMutation();

  const [viewSection, setViewSection] = useState<HomepageSectionDto | null>(null);
  const [editSection, setEditSection] = useState<HomepageSectionDto | null>(null);
  const [resetSection, setResetSection] = useState<HomepageSectionDto | null>(
    null
  );

  const rows = useMemo(() => sections, [sections]);

  const handleTogglePublish = async (section: HomepageSectionDto) => {
    if (!canManageHomepage) {
      addToast('You do not have permission to update homepage sections', 'error');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        key: section.key,
        payload: { published: !section.published },
      });
      addToast(
        section.published
          ? `${section.label} unpublished from the store`
          : `${section.label} published to the store`,
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to update section',
        'error'
      );
    }
  };

  const handleResetConfirm = async () => {
    if (!resetSection || !canManageHomepage) return;
    try {
      await resetMutation.mutateAsync(resetSection.key);
      addToast(`${resetSection.label} reset to defaults and published`, 'success');
      setResetSection(null);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to reset section',
        'error'
      );
    }
  };

  if (isLoading && sections.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError && sections.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load homepage sections. Please refresh and try again.
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Homepage content</h1>
        <p className="text-sm text-gray-600 mt-2">
          Edit marketing sections on the store homepage. Saving updates the
          database and refreshes the live store immediately. New Arrivals product
          tiles still come from your catalog; you can change that section&apos;s
          title here.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">S/N</th>
                <th className="px-4 py-3 font-medium">Section</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created by</th>
                <th className="px-4 py-3 font-medium">Updated by</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last updated</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((section, index) => (
                <tr
                  key={section.key}
                  className="border-t border-gray-100 hover:bg-gray-50/60"
                >
                  <td className="px-4 py-3 text-gray-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{section.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{section.key}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={!canManageHomepage || updateMutation.isPending}
                      onClick={() => handleTogglePublish(section)}
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        section.published
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      } ${canManageHomepage ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                    >
                      {section.published ? 'Published' : 'Draft'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatAuditName(section.createdByName)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatAuditName(section.updatedByName)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatAuditDate(section.createdAt, 'datetime')}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatAuditDate(section.updatedAt, 'datetime')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <TableAction
                        intent="view"
                        onClick={() => setViewSection(section)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        View
                      </TableAction>
                      {canManageHomepage && (
                        <TableAction
                          intent="edit"
                          onClick={() => setEditSection(section)}
                          className="text-[#D4AF37] hover:text-[#D4AF37]/80"
                        >
                          Edit
                        </TableAction>
                      )}
                      {canManageHomepage && (
                        <TableAction
                          intent="delete"
                          onClick={() => setResetSection(section)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Reset
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

      <HomepageSectionViewModal
        section={viewSection}
        onClose={() => setViewSection(null)}
      />
      <HomepageSectionEditModal
        section={editSection}
        onClose={() => setEditSection(null)}
        onSaved={(key: HomepageSectionKey) => {
          addToast(`${SECTION_LABELS[key]} saved — store updated`, 'success');
          setEditSection(null);
        }}
      />
      <HomepageSectionResetModal
        section={resetSection}
        isPending={resetMutation.isPending}
        onClose={() => setResetSection(null)}
        onConfirm={handleResetConfirm}
      />
    </div>
  );
}
