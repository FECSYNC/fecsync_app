'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import ProductsTable from './ProductsTable';
import AddProductModal from './AddProductModal';
import { useAdminProducts } from '@/hooks/useProducts';
import { useAdminCategoriesQuery } from '@/hooks/useCategories';
import type { Product } from '@/services/products';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';
import { useAuthStore } from '@/store/authStore';
import { useParkContextQuery } from '@/hooks/useParkContext';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  MENU_ITEMS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

export default function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryFromUrl = searchParams.get('category')?.trim() || '';
  const parkLocked = useAuthStore((s) => s.user?.parkLocked === true);
  const parkContextQuery = useParkContextQuery(parkLocked);

  const [showAddModal, setShowAddModal] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const { canWriteProducts, canReadCategories } = useCatalogActionPermissions();

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const { data: categories = [] } = useAdminCategoriesQuery(canReadCategories);

  const { data: productsResponse, isPending, isFetching, error } = useAdminProducts({
    page: currentPage,
    limit: itemsPerPage,
    category: categoryFromUrl || undefined,
    sort: 'newest',
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [categoryFromUrl]);

  const products: Product[] = productsResponse?.items || [];

  const categoryName =
    categories.find((c) => c._id === categoryFromUrl)?.name ||
    (() => {
      const row = products.find((p) => {
        const cat = p.category;
        if (!cat) return false;
        if (typeof cat === 'string') return cat === categoryFromUrl;
        return String(cat._id) === categoryFromUrl;
      });
      const cat = row?.category;
      return cat && typeof cat === 'object' && cat.name ? cat.name : null;
    })();

  const paginationData = productsResponse?.pagination || {
    page: currentPage,
    limit: itemsPerPage,
    total: 0,
    totalPages: 0,
    hasMore: false,
  };

  const clearCategoryFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('category');
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            {FOOD_VENDOR_COPY.pageTitle}{' '}
            <span className="text-base sm:text-lg font-normal text-gray-500">
              ({paginationData.total ?? productCount})
            </span>
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            {FOOD_VENDOR_COPY.pageSubtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canWriteProducts && (
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{FOOD_VENDOR_COPY.addButton}</span>
            </button>
          )}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Menu items"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={MENU_ITEMS_GUIDE_STEPS}
      />

      {parkLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Showing products stamped to your assigned park
          {parkContextQuery.data?.effectiveLocationName
            ? ` (${parkContextQuery.data.effectiveLocationName})`
            : ''}
          . Company-shared catalog rows stay visible to company-wide admins only.
        </div>
      ) : null}

      {categoryFromUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
          <span>
            Filtered by category:{' '}
            <span className="font-medium text-gray-900">
              {categoryName || 'selected category'}
            </span>
          </span>
          <button
            type="button"
            onClick={clearCategoryFilter}
            className="text-[#D4AF37] hover:text-[#B8941F] font-medium underline-offset-2 hover:underline"
          >
            Clear filter
          </button>
          {canReadCategories && (
            <Link
              href="/admin/categories"
              className="text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
            >
              Back to categories
            </Link>
          )}
        </div>
      )}

      {error && products.length === 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">Error loading menu items</p>
          <p className="text-red-600 text-sm mt-1">
            {error instanceof Error ? error.message : 'Failed to load menu items'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-red-600 hover:text-red-800 underline text-sm"
          >
            Try again
          </button>
        </div>
      )}

      <ProductsTable
        genderFilter=""
        onProductCountChange={setProductCount}
        products={products}
        isLoading={isPending && products.length === 0}
        error={error}
        pagination={{
          page: paginationData.page,
          limit: paginationData.limit,
          total: paginationData.total,
          totalPages: paginationData.totalPages,
          hasMore: paginationData.hasMore,
        }}
        onPageChange={setCurrentPage}
        onItemsPerPageChange={(n) => {
          setItemsPerPage(n);
          setCurrentPage(1);
        }}
      />
      {isFetching && products.length > 0 ? (
        <p className="text-xs text-gray-400">Updating menu…</p>
      ) : null}

      <AddProductModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => setShowAddModal(false)}
      />
    </div>
  );
}
