'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import Link from 'next/link';
import { DataTable, TableColumn, TableAction } from '../components/shared';
import DeleteCategoryModal from './DeleteCategoryModal';
import EditCategoryModal from './EditCategoryModal';
import { useAdminCategoriesQuery, categoryKeys, prefetchAdminCategoryDetail } from '@/hooks/useCategories';
import { invalidateCatalogQueries, broadcastCatalogChange } from '@/lib/catalogSync';
import { useQueryClient } from '@tanstack/react-query';
import { updateCategory, type ProductCategory } from '@/services/product-category';
import { PublicCategoryCopyMenu } from '@/components/Protected/admin/pages/public-category/PublicCategoryCopyMenu';
import { PublicCategorySettingsButton } from '@/components/Protected/admin/pages/public-category/PublicCategorySettingsButton';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';

// Use the ProductCategory type from the service
export type Category = ProductCategory;

interface CategoriesTableProps {
  onCategoryCountChange?: (count: number) => void;
}

export interface CategoriesTableRef {
  refresh: () => void;
  addCategory: (category: Category) => void;
}

const CategoriesTable = forwardRef<CategoriesTableRef, CategoriesTableProps>(({ onCategoryCountChange }, ref) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const { canWriteCategories, canDeleteCategories, canReadProducts, canReadCategories } =
    useCatalogActionPermissions();
  const { addToast } = useToast();
  
  const queryClient = useQueryClient();

  const publicSaveMutation = useMutation({
    mutationFn: (category: Category & {
      patch: {
        slug: string;
        layout: 'auto' | 'grid' | 'stack';
        embedEnabled: boolean;
      };
    }) =>
      updateCategory(category._id, {
        publicSlug: category.patch.slug,
        layout: category.patch.layout,
        embedEnabled: category.patch.embedEnabled,
      }),
    onSuccess: (updated, variables) => {
      addToast('Public page saved', 'success');
      queryClient.setQueryData<Category[]>(categoryKeys.adminLists(), (old = []) =>
        old.map((cat) =>
          cat._id === variables._id
            ? {
                ...cat,
                ...updated,
                publicPage: updated.publicPage ?? cat.publicPage,
              }
            : cat
        )
      );
      queryClient.setQueryData<Category>(
        categoryKeys.adminDetail(variables._id),
        (old) =>
          old
            ? {
                ...old,
                ...updated,
                publicPage: updated.publicPage ?? old.publicPage,
              }
            : old
      );
      invalidateCatalogQueries(queryClient, 'public-category-links');
      broadcastCatalogChange({
        kind: 'public-category-links',
        action: 'update',
        id: variables._id,
      });
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : 'Could not save public page',
        'error'
      );
    },
  });

  const warmCategoryDetail = (categoryId: string | undefined) => {
    if (categoryId) prefetchAdminCategoryDetail(queryClient, categoryId);
  };
  
  // Staff list scoped to actor.orgId (Step 5.3)
  const {
    data: categories = [],
    isPending,
    error: queryError,
  } = useAdminCategoriesQuery();
  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    refresh: () => {
      invalidateCatalogQueries(queryClient, 'category');
    },
    addCategory: (newCategory: Category) => {
      // Optimistically add to cache (mutation hook already handles this, but this allows manual adds)
      queryClient.setQueryData<Category[]>(categoryKeys.adminLists(), (old = []) => {
        const exists = old.some(cat => cat._id === newCategory._id);
        if (exists) return old;
        return [
          {
            ...newCategory,
            productCount: Number(newCategory.productCount ?? 0),
            shopProductCount: Number(newCategory.shopProductCount ?? 0),
            bookingProductCount: Number(newCategory.bookingProductCount ?? 0),
          },
          ...old,
        ];
      });
    }
  }));

  // Update category count when data changes
  useEffect(() => {
    if (onCategoryCountChange) {
      onCategoryCountChange(categories.length);
    }
  }, [categories.length, onCategoryCountChange]);

  const error = queryError ? 'Failed to fetch categories' : null;

  // Pagination
  const totalPages = Math.ceil(categories.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCategories = categories.slice(startIndex, startIndex + itemsPerPage);

  const handleEdit = (category: Category) => {
    if (!canWriteCategories) return;
    setSelectedCategory(category);
    setShowEditModal(true);
  };

  const handleDelete = (category: Category) => {
    if (!canDeleteCategories) return;
    setSelectedCategory(category);
    setShowDeleteModal(true);
  };

  const handleEditSuccess = (updatedCategory: Category) => {
    // React Query mutation handles cache update, just close modal
    setShowEditModal(false);
    setSelectedCategory(null);
  };

  const handleDeleteSuccess = (categoryId: string) => {
    // React Query mutation handles cache update, just close modal
    setShowDeleteModal(false);
    setSelectedCategory(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const columns: TableColumn<Category>[] = [
    {
      key: 'category',
      label: 'Categories',
      render: (category) => {
        const shop = Number(
          category.shopProductCount ?? category.productCount ?? 0
        );
        const shopHref = category._id
          ? `/admin/products?category=${encodeURIComponent(category._id)}`
          : '/admin/products';

        return (
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-[#D4AF37]/10 rounded-full flex items-center justify-center">
                <span className="text-[#D4AF37] text-sm font-semibold">
                  {category.name.charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {category.name}
              </p>
              <p className="text-sm text-gray-500 truncate">
                {shop === 0 ? (
                  '0 products'
                ) : canReadProducts ? (
                  <Link
                    href={shopHref}
                    className="text-[#D4AF37] hover:text-[#B8941F] hover:underline"
                    title={`View shop products in ${category.name}`}
                  >
                    {shop} product{shop === 1 ? '' : 's'}
                  </Link>
                ) : (
                  <span>
                    {shop} product{shop === 1 ? '' : 's'}
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'createdByName',
      label: 'Created by',
      render: (category) => (
        <div className="text-sm text-gray-900">
          {formatAuditName(
            typeof category.createdByName === 'string'
              ? category.createdByName
              : null
          )}
        </div>
      ),
    },
    {
      key: 'updatedByName',
      label: 'Updated by',
      render: (category) => (
        <div className="text-sm text-gray-900">
          {formatAuditName(
            typeof category.updatedByName === 'string'
              ? category.updatedByName
              : null
          )}
        </div>
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (category) => (
        <div className="text-sm text-gray-900">
          {formatAuditDate(category.createdAt)}
        </div>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Updated',
      render: (category) => (
        <div className="text-sm text-gray-900">
          {formatAuditDate(category.updatedAt)}
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (category) => (
        <div className="flex max-w-[17rem] flex-wrap items-center gap-x-3 gap-y-1 whitespace-normal">
          {canReadCategories || canWriteCategories ? (
            <PublicCategoryCopyMenu page={category.publicPage} />
          ) : null}
          {canWriteCategories ? (
            <PublicCategorySettingsButton
              categoryName={category.name}
              page={category.publicPage}
              saving={
                publicSaveMutation.isPending &&
                publicSaveMutation.variables?._id === category._id
              }
              onSave={(patch) => publicSaveMutation.mutate({ ...category, patch })}
            />
          ) : null}
          {category._id && (
            <TableAction
              intent="view"
              href={`/admin/categories/${category._id}`}
              onMouseEnter={() => warmCategoryDetail(category._id)}
              onFocus={() => warmCategoryDetail(category._id)}
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1 rounded-md text-sm font-medium"
              title="View category"
            >
              View
            </TableAction>
          )}
          {canWriteCategories && (
            <TableAction
              intent="edit"
              pendingLabel="Opening…"
              onClick={() => handleEdit(category)}
              className="text-[#D4AF37] hover:text-[#D4AF37]/80 hover:bg-[#D4AF37]/10 px-3 py-1 rounded-md text-sm font-medium"
              title="Edit category"
            >
              Edit
            </TableAction>
          )}
          {canDeleteCategories && (
            <TableAction
              intent="delete"
              pendingLabel="Opening…"
              onClick={() => handleDelete(category)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-md text-sm font-medium"
              title="Delete category"
            >
              Delete
            </TableAction>
          )}
        </div>
      ),
    },
  ];

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow">
        <div className="p-8 text-center">
          <div className="text-red-500 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <DataTable
        data={paginatedCategories}
        columns={columns}
        loading={isPending && categories.length === 0}
        emptyMessage="No categories found"
        getRowId={(item) => (item.slug || item._id) as string}
        pagination={{
          currentPage,
          totalPages,
          totalItems: categories.length,
          itemsPerPage,
          onPageChange: setCurrentPage,
          onItemsPerPageChange: setItemsPerPage,
          showItemsPerPage: true,
          itemsPerPageOptions: [10, 25, 50, 100],
        }}
        showPagination={true}
      />

      {/* Edit Category Modal */}
      {showEditModal && selectedCategory && (
        <EditCategoryModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedCategory(null);
          }}
          category={selectedCategory}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Delete Category Modal */}
      {showDeleteModal && selectedCategory && (
        <DeleteCategoryModal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedCategory(null);
          }}
          category={selectedCategory}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </>
  );
});

CategoriesTable.displayName = 'CategoriesTable';

export default CategoriesTable;
