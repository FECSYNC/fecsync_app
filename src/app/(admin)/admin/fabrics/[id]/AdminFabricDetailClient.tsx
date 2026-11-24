'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAdminFabricByIdQuery } from '@/hooks/useFabrics';
import { formatPrice } from '@/utils/currency';
import { formatCatalogTaxLabel } from '@/utils/tax';
import { PageSpinner } from '@/components/Protected/admin/components/Spinner';
import EditFabricModal from '@/components/Protected/admin/pages/fabrics/EditFabricModal';
import DeleteFabricModal from '@/components/Protected/admin/pages/fabrics/DeleteFabricModal';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';

export default function AdminFabricDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { canWriteFabrics, canDeleteFabrics, canReadProducts } =
    useCatalogActionPermissions();

  const { data: fabric, isLoading, error } = useAdminFabricByIdQuery(id);

  const handleDeleteSuccess = () => {
    router.push('/admin/fabrics');
  };

  if (isLoading && !fabric) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <PageSpinner className="h-64" />
      </div>
    );
  }

  if (error || !fabric) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error?.message || 'Fabric not found'}</p>
          <Link
            href="/admin/fabrics"
            className="text-[#D4AF37] hover:text-[#D4AF37]/80 transition-colors"
          >
            ← Back to Fabrics
          </Link>
        </div>
      </div>
    );
  }

  const price =
    typeof fabric.bundlePrice === 'number'
      ? fabric.bundlePrice
      : typeof fabric.pricePerMeter === 'number'
        ? fabric.pricePerMeter
        : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/admin/fabrics"
              className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Fabrics
            </Link>
            <div className="flex space-x-3">
              {canWriteFabrics && (
                <button
                  onClick={() => setShowEditModal(true)}
                  className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors"
                >
                  Edit Fabric
                </button>
              )}
              {canDeleteFabrics && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete Fabric
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            <div className="relative h-96 rounded-lg overflow-hidden bg-gray-100">
              {fabric.image ? (
                <Image
                  src={fabric.image}
                  alt={fabric.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  No image
                </div>
              )}
            </div>

            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-6">{fabric.name}</h1>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Type</h3>
                    <p className="text-gray-900">{fabric.type || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Color</h3>
                    <p className="text-gray-900">{fabric.color || 'N/A'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Pattern</h3>
                    <p className="text-gray-900">{fabric.pattern || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Composition</h3>
                    <p className="text-gray-900">{fabric.composition || 'N/A'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Price</h3>
                    <p className="text-lg font-semibold text-gray-900">{formatPrice(price)}</p>
                    {fabric.yardBundle ? (
                      <p className="text-xs text-gray-500 mt-0.5">{fabric.yardBundle} yard bundle</p>
                    ) : null}
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Tax</h3>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatCatalogTaxLabel(fabric)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Products</h3>
                    {fabric._id && canReadProducts ? (
                      <Link
                        href={`/admin/products?fabric=${encodeURIComponent(fabric._id)}`}
                        className="text-lg font-semibold text-[#D4AF37] hover:text-[#B8941F] hover:underline"
                      >
                        {fabric.productCount ?? 0}
                      </Link>
                    ) : (
                      <p className="text-lg font-semibold text-gray-900">
                        {fabric.productCount ?? 0}
                      </p>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Stock</h3>
                    <p className="text-gray-900">
                      {fabric.isSellable
                        ? `${fabric.stockBundles ?? 0} bundles`
                        : fabric.inStock
                          ? 'In stock'
                          : 'Out of stock'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Supplier</h3>
                    <p className="text-gray-900">{fabric.supplier || 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Created by</h3>
                    <p className="text-gray-900">{fabric.createdByName?.trim() || '—'}</p>
                  </div>
                </div>

                {(fabric.weight || fabric.width) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Weight</h3>
                      <p className="text-gray-900">{fabric.weight ? `${fabric.weight} gsm` : 'N/A'}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Width</h3>
                      <p className="text-gray-900">{fabric.width ? `${fabric.width} cm` : 'N/A'}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Updated by</h3>
                    <p className="text-gray-900">{fabric.updatedByName?.trim() || '—'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Created</h3>
                    <p className="text-gray-900">
                      {fabric.createdAt
                        ? new Date(fabric.createdAt).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Updated</h3>
                    <p className="text-gray-900">
                      {fabric.updatedAt
                        ? new Date(fabric.updatedAt).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showEditModal && (
        <EditFabricModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          fabric={fabric}
          onSuccess={() => setShowEditModal(false)}
        />
      )}

      {showDeleteModal && (
        <DeleteFabricModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          fabric={fabric}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}
