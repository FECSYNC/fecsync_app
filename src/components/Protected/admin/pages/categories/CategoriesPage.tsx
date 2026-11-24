'use client';

import { useState, useRef } from 'react';
import CategoriesTable, { type CategoriesTableRef } from './CategoriesTable';
import AddCategoryModal from './AddCategoryModal';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  CATEGORIES_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

export default function CategoriesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [categoryCount, setCategoryCount] = useState(0);
  const tableRef = useRef<CategoriesTableRef | null>(null);
  const { canWriteCategories } = useCatalogActionPermissions();

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Product Categories{' '}
            <span className="text-base sm:text-lg font-normal text-gray-500">
              ({categoryCount})
            </span>
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            Shared Catalog folders for shop menu items and Online Booking /
            Ticketing products. Open the guide if you are doing this for the
            first time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canWriteCategories && (
            <button
              onClick={() => setShowAddModal(true)}
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
          )}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Product Categories"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={CATEGORIES_GUIDE_STEPS}
      />

      <CategoriesTable
        ref={tableRef}
        onCategoryCountChange={setCategoryCount}
      />

      {showAddModal && (
        <AddCategoryModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={(newCategory) => {
            if (tableRef.current?.addCategory) {
              tableRef.current.addCategory(newCategory);
            }
          }}
        />
      )}
    </div>
  );
}
