'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { categoryKeys, useAdminCategoryByIdQuery } from '@/hooks/useCategories';
import { PageSpinner } from '@/components/Protected/admin/components/Spinner';
import EditCategoryModal from '@/components/Protected/admin/pages/categories/EditCategoryModal';
import DeleteCategoryModal from '@/components/Protected/admin/pages/categories/DeleteCategoryModal';
import { PublicCategoryShareControls } from '@/components/Protected/admin/pages/public-category/PublicCategoryShareControls';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateCategory, type ProductCategory } from '@/services/product-category';
import { invalidateCatalogQueries, broadcastCatalogChange } from '@/lib/catalogSync';
import { useToast } from '@/contexts/toast-context';

export default function AdminCategoryDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { canWriteCategories, canDeleteCategories, canReadProducts, canReadCategories } =
    useCatalogActionPermissions();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const { data: category, isLoading, error } = useAdminCategoryByIdQuery(id);

  const publicSaveMutation = useMutation({
    mutationFn: (patch: {
      slug: string;
      layout: 'auto' | 'grid' | 'stack';
      embedEnabled: boolean;
    }) =>
      updateCategory(id, {
        publicSlug: patch.slug,
        layout: patch.layout,
        embedEnabled: patch.embedEnabled,
      }),
    onSuccess: (updated) => {
      addToast('Public page saved', 'success');
      queryClient.setQueryData<ProductCategory>(
        categoryKeys.adminDetail(id),
        (old) =>
          old
            ? {
                ...old,
                ...updated,
                publicPage: updated.publicPage ?? old.publicPage,
              }
            : updated
      );
      queryClient.setQueryData<ProductCategory[]>(
        categoryKeys.adminLists(),
        (old = []) =>
          old.map((cat) =>
            cat._id === id
              ? {
                  ...cat,
                  ...updated,
                  publicPage: updated.publicPage ?? cat.publicPage,
                }
              : cat
          )
      );
      invalidateCatalogQueries(queryClient, 'public-category-links');
      broadcastCatalogChange({
        kind: 'public-category-links',
        action: 'update',
        id,
      });
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : 'Could not save public page',
        'error'
      );
    },
  });

  const handleDeleteSuccess = () => {
    router.push('/admin/categories');
  };

  if (isLoading && !category) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <PageSpinner className="h-64" />
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error?.message || 'Category not found'}</p>
          <Link
            href="/admin/categories"
            className="text-[#D4AF37] hover:text-[#D4AF37]/80 transition-colors"
          >
            ← Back to Categories
          </Link>
        </div>
      </div>
    );
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/admin/categories"
              className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Categories
            </Link>
            <div className="flex space-x-3">
              {canWriteCategories && (
                <button
                  onClick={() => setShowEditModal(true)}
                  className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors"
                >
                  Edit Category
                </button>
              )}
              {canDeleteCategories && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete Category
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            <div className="relative h-72 rounded-lg overflow-hidden bg-gray-100">
              {category.image ? (
                <Image
                  src={category.image}
                  alt={category.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-4xl font-semibold">
                  {category.name.charAt(0)}
                </div>
              )}
            </div>

            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{category.name}</h1>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Description</h3>
                  <p className="text-gray-900">{category.description || 'No description available'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Shop slug</h3>
                    <p className="text-gray-900 font-mono text-sm">{category.id || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Status</h3>
                    <p className="text-gray-900 capitalize">{category.status || 'active'}</p>
                  </div>
                </div>

                {canReadCategories || canWriteCategories ? (
                  <PublicCategoryShareControls
                    page={category.publicPage}
                    canWrite={canWriteCategories}
                    saving={publicSaveMutation.isPending}
                    onSave={(patch) => publicSaveMutation.mutate(patch)}
                  />
                ) : null}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Products</h3>
                    <p className="text-lg font-semibold text-gray-900">
                      {Number(category.productCount ?? 0)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm">
                      {category._id && canReadProducts ? (
                        <Link
                          href={`/admin/products?category=${encodeURIComponent(category._id)}`}
                          className="text-[#D4AF37] hover:text-[#B8941F] hover:underline"
                        >
                          {Number(
                            category.shopProductCount ?? category.productCount ?? 0
                          )}{' '}
                          shop product
                          {Number(
                            category.shopProductCount ?? category.productCount ?? 0
                          ) === 1
                            ? ''
                            : 's'}
                        </Link>
                      ) : (
                        <span className="text-gray-600">
                          {Number(
                            category.shopProductCount ?? category.productCount ?? 0
                          )}{' '}
                          shop product
                          {Number(
                            category.shopProductCount ?? category.productCount ?? 0
                          ) === 1
                            ? ''
                            : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Created by</h3>
                    <p className="text-gray-900">
                      {typeof category.createdByName === 'string' &&
                      category.createdByName.trim()
                        ? category.createdByName.trim()
                        : '—'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Updated by</h3>
                    <p className="text-gray-900">
                      {typeof category.updatedByName === 'string' &&
                      category.updatedByName.trim()
                        ? category.updatedByName.trim()
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Created</h3>
                    <p className="text-gray-900">{formatDate(category.createdAt)}</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Updated</h3>
                  <p className="text-gray-900">{formatDate(category.updatedAt)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showEditModal && (
        <EditCategoryModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          category={category}
          onSuccess={() => setShowEditModal(false)}
        />
      )}

      {showDeleteModal && (
        <DeleteCategoryModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          category={category}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}
