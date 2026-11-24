'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import Link from 'next/link';
import { DataTable, TableColumn, TableAction } from '../components/shared';
import EditFabricModal from './EditFabricModal';
import DeleteFabricModal from './DeleteFabricModal';
import { formatPrice } from '@/utils/currency';
import { formatCatalogTaxLabel } from '@/utils/tax';
import { useAdminFabricsQuery, fabricKeys, prefetchAdminFabricDetail } from '@/hooks/useFabrics';
import { invalidateCatalogQueries } from '@/lib/catalogSync';
import { useQueryClient } from '@tanstack/react-query';
import { type Fabric as ServiceFabric } from '@/services/fabric';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';

// Use the service type directly
export type Fabric = ServiceFabric;

interface FabricsTableProps {
  onFabricCountChange?: (count: number) => void;
}

export interface FabricsTableRef {
  refresh: () => void;
  addFabric: (newFabric: Fabric) => void;
}

const FabricsTable = forwardRef<FabricsTableRef, FabricsTableProps>(({ onFabricCountChange }, ref) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedFabric, setSelectedFabric] = useState<Fabric | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { canWriteFabrics, canDeleteFabrics, canReadProducts } =
    useCatalogActionPermissions();
  
  const queryClient = useQueryClient();
  
  // Staff list scoped to actor.orgId (Step 5.3)
  const {
    data: fabrics = [],
    isPending,
    error: queryError,
  } = useAdminFabricsQuery();

  const warmFabricDetail = (fabricId: string | undefined) => {
    if (fabricId) prefetchAdminFabricDetail(queryClient, fabricId);
  };
  useImperativeHandle(ref, () => ({
    refresh: () => {
      invalidateCatalogQueries(queryClient, 'fabric');
    },
    addFabric: (newFabric: Fabric) => {
      // Optimistically add to cache (mutation hook already handles this, but this allows manual adds)
      queryClient.setQueryData<Fabric[]>(fabricKeys.adminLists(), (old = []) => {
        const exists = old.some(f => f._id === newFabric._id);
        if (exists) return old;
        return [{ ...newFabric, productCount: Number(newFabric.productCount ?? 0) }, ...old];
      });
    }
  }));

  useEffect(() => {
    onFabricCountChange?.(fabrics.length);
  }, [fabrics.length, onFabricCountChange]);

  const error = queryError ? 'Failed to fetch fabrics' : null;

  const totalPages = Math.ceil(Math.max(1, fabrics.length) / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedFabrics = fabrics.slice(startIndex, startIndex + itemsPerPage);

  const handleEdit = (fabric: Fabric) => {
    if (!canWriteFabrics) return;
    setSelectedFabric(fabric);
    setShowEditModal(true);
  };

  const handleDelete = (fabric: Fabric) => {
    if (!canDeleteFabrics) return;
    setSelectedFabric(fabric);
    setShowDeleteModal(true);
  };

  const handleEditSuccess = (updatedFabric: Fabric) => {
    // React Query mutation handles cache update, just close modal
    setShowEditModal(false);
    setSelectedFabric(null);
  };

  const handleDeleteSuccess = (fabricId: string) => {
    // React Query mutation handles cache update, just close modal
    setShowDeleteModal(false);
    setSelectedFabric(null);
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const columns: TableColumn<Fabric>[] = [
    { 
      key: 'fabric', 
      label: 'Fabric', 
      render: (fabric) => {
        const productCount = Number(fabric.productCount ?? 0);
        const productsHref = fabric._id
          ? `/admin/products?fabric=${encodeURIComponent(fabric._id)}`
          : '/admin/products';
        const label = `${productCount} ${productCount === 1 ? 'product' : 'products'}`;

        return (
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            {fabric.image ? (
              <img
                src={fabric.image}
                alt={fabric.name}
                className="w-10 h-10 rounded-lg object-cover border border-gray-200"
                onError={(e) => {
                  // Fallback to initials if image fails to load
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div 
              className={`w-10 h-10 bg-[#D4AF37]/10 rounded-lg flex items-center justify-center ${fabric.image ? 'hidden' : ''}`}
            >
              <span className="text-[#D4AF37] text-sm font-semibold">
                {fabric.name.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {fabric.name}
            </p>
            {fabric._id && canReadProducts ? (
              <Link
                href={productsHref}
                className="text-sm text-[#D4AF37] hover:text-[#B8941F] hover:underline truncate inline-block"
                title={`View ${label} using ${fabric.name}`}
              >
                {label}
              </Link>
            ) : (
              <p className="text-sm text-gray-500 truncate">{label}</p>
            )}
            <p className="text-xs text-gray-500 truncate">
              {fabric.type} • {fabric.color}
            </p>
          </div>
        </div>
        );
      }
    },
    { 
      key: 'specs', 
      label: 'Specifications', 
      render: (fabric) => (
        <div className="text-sm text-gray-900">
          <div className="font-medium">{fabric.pattern || 'Solid'}</div>
          <div className="text-gray-500">
            {fabric.weight ? `${fabric.weight}g/m²` : 'N/A'} • {fabric.width ? `${fabric.width}cm` : 'N/A'}
          </div>
        </div>
      )
    },
    { 
      key: 'pricing', 
      label: 'Sale & Stock', 
      render: (fabric) => (
        <div className="text-sm text-gray-900 space-y-1">
          {fabric.isSellable && fabric.yardBundle && fabric.bundlePrice ? (
            <>
              <div className="font-medium text-gray-900">
                {formatPrice(fabric.bundlePrice)}
                <span className="text-gray-500 font-normal"> / {fabric.yardBundle} yd</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full bg-[#D4AF37]/15 px-2 py-0.5 text-xs font-medium text-[#B8941F]">
                  For sale
                </span>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  Tax: {formatCatalogTaxLabel(fabric)}
                </span>
                {typeof fabric.stockBundles === 'number' && (
                  <span className="text-xs text-gray-500">
                    {fabric.stockBundles} bundle{fabric.stockBundles === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-gray-500 text-xs">Catalog only</span>
          )}
          <div className={`text-xs ${fabric.inStock !== false ? 'text-green-600' : 'text-red-600'}`}>
            {fabric.inStock !== false ? 'In stock' : 'Out of stock'}
          </div>
        </div>
      )
    },
    { 
      key: 'createdByName', 
      label: 'Created by', 
      render: (fabric) => (
        <div className="text-sm text-gray-900">{formatAuditName(fabric.createdByName)}</div>
      )
    },
    { 
      key: 'updatedByName', 
      label: 'Updated by', 
      render: (fabric) => (
        <div className="text-sm text-gray-900">{formatAuditName(fabric.updatedByName)}</div>
      )
    },
    { 
      key: 'createdAt', 
      label: 'Created', 
      render: (fabric) => (
        <div className="text-sm text-gray-900">{formatAuditDate(fabric.createdAt)}</div>
      )
    },
    { 
      key: 'updatedAt', 
      label: 'Updated', 
      render: (fabric) => (
        <div className="text-sm text-gray-900">{formatAuditDate(fabric.updatedAt)}</div>
      )
    },
    { 
      key: 'actions', 
      label: 'Actions', 
      render: (fabric) => (
        <div className="flex items-center space-x-3">
          {fabric._id && (
            <TableAction
              intent="view"
              href={`/admin/fabrics/${fabric._id}`}
              onMouseEnter={() => warmFabricDetail(fabric._id)}
              onFocus={() => warmFabricDetail(fabric._id)}
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1 rounded-md text-sm font-medium"
              title="View fabric"
            >
              View
            </TableAction>
          )}
          {canWriteFabrics && (
            <TableAction
              intent="edit"
              pendingLabel="Opening…"
              onClick={() => handleEdit(fabric)}
              className="text-[#D4AF37] hover:text-[#D4AF37]/80 hover:bg-[#D4AF37]/10 px-3 py-1 rounded-md text-sm font-medium"
              title="Edit fabric"
            >
              Edit
            </TableAction>
          )}
          {canDeleteFabrics && (
            <TableAction
              intent="delete"
              pendingLabel="Opening…"
              onClick={() => handleDelete(fabric)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-md text-sm font-medium"
              title="Delete fabric"
            >
              Delete
            </TableAction>
          )}
        </div>
      )
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
        data={paginatedFabrics}
        columns={columns}
        loading={isPending && fabrics.length === 0}
        emptyMessage="No fabrics found"
        getRowId={(item) => item._id as string}
        pagination={{
          currentPage,
          totalPages: totalPages || 1,
          totalItems: fabrics.length,
          itemsPerPage,
          onPageChange: setCurrentPage,
          onItemsPerPageChange: setItemsPerPage,
          showItemsPerPage: true,
          itemsPerPageOptions: [10, 25, 50, 100],
        }}
        showPagination={true}
      />

      {showEditModal && selectedFabric && (
        <EditFabricModal
          isOpen={showEditModal}
          onClose={() => { setShowEditModal(false); setSelectedFabric(null); }}
          fabric={selectedFabric}
          onSuccess={handleEditSuccess}
        />
      )}

      {showDeleteModal && selectedFabric && (
        <DeleteFabricModal
          isOpen={showDeleteModal}
          onClose={() => { setShowDeleteModal(false); setSelectedFabric(null); }}
          fabric={selectedFabric}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </>
  );
});

FabricsTable.displayName = 'FabricsTable';

export default FabricsTable;


