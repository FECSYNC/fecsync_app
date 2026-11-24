'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAdminProductByIdQuery } from '@/hooks/useProducts';
import { formatPrice } from '@/utils/currency';
import { formatCatalogTaxLabel } from '@/utils/tax';
import { MAX_PRODUCT_IMAGES } from '@/lib/productImages';
import { PageSpinner } from '@/components/Protected/admin/components/Spinner';
import EditProductModal from '@/components/Protected/admin/pages/products/EditProductModal';
import DeleteProductModal from '@/components/Protected/admin/pages/products/DeleteProductModal';
import { motion, AnimatePresence } from 'framer-motion';
import type { Product } from '@/services/products';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { useAdminCategoriesQuery } from '@/hooks/useCategories';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';

export default function AdminProductDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const {
    canWriteProducts,
    canDeleteProducts,
    canReadCategories,
  } = useCatalogActionPermissions();

  // Seed from admin list cache so View opens immediately.
  const { data: product, isLoading, error } = useAdminProductByIdQuery(id);
  const { data: categories = [] } = useAdminCategoriesQuery(canReadCategories);

  const handleDeleteSuccess = () => {
    router.push('/admin/products');
  };

  // Only block the page when we have nothing to show yet.
  if (isLoading && !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <PageSpinner className="h-64" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error?.message || 'Catalog item not found'}</p>
          <Link
            href="/admin/products"
            className="text-[#D4AF37] hover:text-[#D4AF37]/80 transition-colors"
          >
            ← Back to catalog
          </Link>
        </div>
      </div>
    );
  }

  const categoryId =
    typeof product.category === 'object' && product.category?._id
      ? String(product.category._id)
      : typeof product.category === 'string'
        ? product.category
        : null;
  const categoryName =
    typeof product.category === 'object' && product.category?.name
      ? product.category.name
      : categoryId
        ? categories.find((c) => c._id === categoryId)?.name || 'Category'
        : 'N/A';

  const stock = typeof product.remainingInStock === 'number'
    ? product.remainingInStock
    : typeof product.quantity === 'number'
      ? product.quantity
      : parseInt(String(product.remainingInStock || product.quantity || '0')) || 0;

  const price = typeof product.price === 'number'
    ? product.price
    : parseInt(String(product.price || '0')) || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Back Button */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/admin/products"
              className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to catalog
            </Link>
            <div className="flex space-x-3">
              {canWriteProducts && (
                <button
                  onClick={() => setShowEditModal(true)}
                  className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors"
                >
                  {FOOD_VENDOR_COPY.editModalTitle}
                </button>
              )}
              {canDeleteProducts && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  {FOOD_VENDOR_COPY.deleteTitle}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            {/* Image Gallery */}
            <div>
              <div className="mb-4 relative overflow-hidden rounded-lg h-96">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedImageIndex}
                    initial={{ opacity: 0, scale: 0.95, x: 20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95, x: -20 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="absolute inset-0"
                  >
                    <Image
                      src={product.images?.[selectedImageIndex] || '/placeholder.png'}
                      alt={product.name}
                      fill
                      className="object-cover rounded-lg"
                      sizes="(max-width: 768px) 100vw, 50vw"
                      priority={selectedImageIndex === 0}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/placeholder.png';
                      }}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
              {product.images && product.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {product.images.slice(0, MAX_PRODUCT_IMAGES).map((image, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedImageIndex(index)}
                      className={`relative h-24 rounded-lg overflow-hidden border-2 transition-all ${selectedImageIndex === index
                          ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/20'
                          : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <Image
                        src={image || '/placeholder.png'}
                        alt={`${product.name} - Image ${index + 1}`}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 33vw, 15vw"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/placeholder.png';
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Details */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{product.name}</h1>

              <div className="space-y-4 mb-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Description</h3>
                  <p className="text-gray-900">{product.description || 'No description available'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Price</h3>
                    <p className="text-lg font-semibold text-gray-900">{formatPrice(price)}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Tax</h3>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatCatalogTaxLabel(product)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {product.taxExempt
                        ? 'No tax charged on this product'
                        : product.taxRate !== null && product.taxRate !== undefined
                          ? 'Custom override rate'
                          : 'Uses store Tax Settings rate'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Stock</h3>
                    <p className="text-lg font-semibold text-gray-900">{stock.toLocaleString()}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Category</h3>
                    {categoryId ? (
                      <div className="space-y-1">
                        <Link
                          href={`/admin/products?category=${encodeURIComponent(categoryId)}`}
                          className="font-medium text-[#D4AF37] hover:text-[#B8941F] hover:underline"
                        >
                          {categoryName}
                        </Link>
                        {canReadCategories && (
                          <div>
                            <Link
                              href={`/admin/categories/${categoryId}`}
                              className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                            >
                              View category
                            </Link>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-900">{categoryName}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Location</h3>
                    <p className="text-gray-900">{product.location || 'N/A'}</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Item ID</h3>
                  <p className="text-gray-900 font-mono text-sm">{product.id || product._id || 'N/A'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Created by</h3>
                    <p className="text-gray-900">
                      {typeof product.createdByName === 'string' && product.createdByName.trim()
                        ? product.createdByName.trim()
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Updated by</h3>
                    <p className="text-gray-900">
                      {typeof product.updatedByName === 'string' && product.updatedByName.trim()
                        ? product.updatedByName.trim()
                        : '—'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Created</h3>
                    <p className="text-gray-900">
                      {product.createdAt
                        ? new Date(product.createdAt).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Updated</h3>
                    <p className="text-gray-900">
                      {product.updatedAt
                        ? new Date(product.updatedAt).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {/* Edit Modal */}
      {showEditModal && (
        <EditProductModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          product={product as any}
          onSuccess={() => {
            setShowEditModal(false);
            // Refetch will happen automatically via React Query
          }}
        />
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <DeleteProductModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          productId={product.id || product._id || ''}
          productName={product.name}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}
