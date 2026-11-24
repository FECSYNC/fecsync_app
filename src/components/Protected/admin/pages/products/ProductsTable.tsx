'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable, TableColumn, TableAction } from '../components/shared';
import DeleteProductModal from './DeleteProductModal';
import EditProductModal from './EditProductModal';
import { formatPrice } from '@/utils/currency';
import { formatCatalogTaxLabel } from '@/utils/tax';
import { PageSpinner } from '../../components/Spinner';
import type { Product } from '@/services/products';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { prefetchAdminProductDetail } from '@/hooks/useProducts';
import { useAdminCategoriesQuery } from '@/hooks/useCategories';
import { catalogRefId } from '@/lib/ids';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';

interface ProductsTableProps {
  genderFilter: string;
  onProductCountChange?: (count: number) => void;
  products: Product[]; // Products from parent (required now)
  isLoading?: boolean; // Loading state from parent
  error?: Error | null; // Error state from parent
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
  onPageChange?: (page: number) => void;
  onItemsPerPageChange?: (itemsPerPage: number) => void;
}

function refId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (typeof value === 'object' && value !== null) {
    const row = value as { _id?: string; id?: string };
    const id = catalogRefId(row);
    return id || null;
  }
  return null;
}

function refName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export default function ProductsTable({
  genderFilter,
  onProductCountChange,
  products,
  isLoading = false,
  error: parentError,
  pagination,
  onPageChange,
  onItemsPerPageChange
}: ProductsTableProps) {
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const { canWriteProducts, canDeleteProducts, canReadCategories } =
    useCatalogActionPermissions();

  // Name lookups when list rows only have ObjectId refs (after optimistic edits)
  const { data: categories = [] } = useAdminCategoriesQuery(canReadCategories);
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      if (c._id && c.name) map.set(String(c._id), c.name);
    }
    return map;
  }, [categories]);

  const resolveCategory = useCallback(
    (product: Product) => {
      const id = refId(product.category);
      if (!id) return null;
      const name =
        refName(product.category) || categoryNameById.get(id) || 'Category';
      return { id, name };
    },
    [categoryNameById]
  );

  const warmProductDetail = useCallback(
    (productId: string | undefined) => {
      if (productId) prefetchAdminProductDetail(queryClient, productId);
    },
    [queryClient]
  );

  // Notify parent component of product count changes
  useEffect(() => {
    if (onProductCountChange && pagination) {
      onProductCountChange(pagination.total);
    }
  }, [pagination?.total, onProductCountChange]);

  // Calculate pagination
  // When pagination prop is provided (server-side), these are just for display/logic
  const totalItems = pagination ? pagination.total : products.length;
  // If server-side, totalPages comes from prop. If client-side fallback, calculate it.
  const totalPages = pagination ? pagination.totalPages : Math.ceil(totalItems / itemsPerPage);

  // If server-side (pagination prop exists), products are already the correct page.
  // If client-side (fallback), we slice.
  const paginatedProducts = pagination ? products : products.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);


  const getStatusBadge = (product: Product) => {
    // Determine status based on stock
    const stock = typeof product.remainingInStock === 'number'
      ? product.remainingInStock
      : typeof product.quantity === 'number'
        ? product.quantity
        : parseInt(String(product.remainingInStock || product.quantity || '0'));
    const status = stock > 10 ? 'active' : stock > 0 ? 'low_stock' : 'out_of_stock';

    const statusClasses = {
      active: 'bg-green-100 text-green-800',
      low_stock: 'bg-[#D4AF37]/20 text-[#D4AF37]',
      out_of_stock: 'bg-red-100 text-red-800'
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClasses[status as keyof typeof statusClasses]}`}>
        {status.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  // Define handlers before columns so they can be used in useMemo dependencies
  const handleEditClick = useCallback((product: Product) => {
    if (!canWriteProducts) return;
    setSelectedProduct(product);
    setShowEditModal(true);
  }, [canWriteProducts]);

  const handleDeleteClick = useCallback((product: Product) => {
    if (!canDeleteProducts) return;
    setSelectedProduct(product);
    setShowDeleteModal(true);
  }, [canDeleteProducts]);

  // Memoize columns to prevent unnecessary re-renders
  const columns: TableColumn<Product>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Item',
      render: (product) => {
        const productName = product.name || 'Untitled item';
        const truncatedName = productName.length > 10
          ? `${productName.substring(0, 10)}...`
          : productName;
        const productId = product.id || product._id || 'N/A';
        const shortId = productId.length > 8 ? `${productId.substring(0, 8)}...` : productId;

        return (
          <Link
            href={`/admin/products/${productId}`}
            onMouseEnter={() => warmProductDetail(productId)}
            onFocus={() => warmProductDetail(productId)}
            className="flex items-center hover:opacity-80 transition-opacity"
          >
            <div className="flex-shrink-0 h-10 w-10 relative">
              <Image
                className="rounded-lg object-cover"
                src={product.images?.[0] || '/placeholder.png'}
                alt={productName}
                fill
                sizes="40px"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/placeholder.png';
                }}
              />
            </div>
            <div className="ml-4">
              <div className="text-sm font-medium text-gray-900" title={productName}>
                {truncatedName}
              </div>
              <div className="text-sm text-gray-500" title={productId}>
                ID: {shortId}
              </div>
            </div>
          </Link>
        );
      }
    },
    {
      key: 'category',
      label: 'Category',
      render: (product) => {
        const category = resolveCategory(product);
        if (!category) {
          return <span className="text-sm text-gray-400">—</span>;
        }
        return (
          <div className="min-w-0 max-w-[10rem]">
            <Link
              href={`/admin/products?category=${encodeURIComponent(category.id)}`}
              className="block text-sm font-medium text-[#D4AF37] hover:text-[#B8941F] hover:underline truncate"
              title={`Filter products in ${category.name}`}
            >
              {category.name}
            </Link>
            {canReadCategories && (
              <Link
                href={`/admin/categories/${category.id}`}
                className="block text-[11px] text-gray-500 hover:text-gray-700 hover:underline truncate mt-0.5"
                title="Open category"
              >
                View category
              </Link>
            )}
          </div>
        );
      },
    },
    {
      key: 'price',
      label: 'Price',
      render: (product) => {
        const price = typeof product.price === 'number'
          ? product.price
          : parseInt(String(product.price || '0')) || 0;
        return formatPrice(price);
      },
      sortable: true
    },
    {
      key: 'tax',
      label: 'Tax',
      render: (product) => (
        <span className="text-sm text-gray-900">
          {formatCatalogTaxLabel(product)}
        </span>
      ),
    },
    {
      key: 'stock',
      label: 'Stock',
      render: (product) => {
        const stock = typeof product.remainingInStock === 'number'
          ? product.remainingInStock
          : typeof product.quantity === 'number'
            ? product.quantity
            : parseInt(String(product.remainingInStock || product.quantity || '0')) || 0;
        return stock.toLocaleString();
      },
      sortable: true
    },
    {
      key: 'status',
      label: 'Status',
      render: (product) => getStatusBadge(product)
    },
    {
      key: 'createdByName',
      label: 'Created by',
      render: (product) => (
        <span className="text-sm text-gray-900">
          {formatAuditName(
            typeof product.createdByName === 'string'
              ? product.createdByName
              : null
          )}
        </span>
      ),
    },
    {
      key: 'updatedByName',
      label: 'Updated by',
      render: (product) => (
        <span className="text-sm text-gray-900">
          {formatAuditName(
            typeof product.updatedByName === 'string'
              ? product.updatedByName
              : null
          )}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (product) => (
        <span className="text-sm text-gray-900">
          {formatAuditDate(product.createdAt)}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Updated',
      render: (product) => (
        <span className="text-sm text-gray-900">
          {formatAuditDate(product.updatedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (product) => {
        const productId = product._id || product.id;
        return (
          <div className="flex space-x-2">
            {productId && (
              <TableAction
                intent="view"
                href={`/admin/products/${productId}`}
                onMouseEnter={() => warmProductDetail(productId)}
                onFocus={() => warmProductDetail(productId)}
                className="text-blue-600 hover:text-blue-800"
              >
                View
              </TableAction>
            )}
            {canWriteProducts && (
              <TableAction
                intent="edit"
                pendingLabel="Opening…"
                onClick={() => handleEditClick(product)}
                className="text-[#D4AF37] hover:text-[#D4AF37]/80"
              >
                Edit
              </TableAction>
            )}
            {canDeleteProducts && (
              <TableAction
                intent="delete"
                pendingLabel="Opening…"
                onClick={() => handleDeleteClick(product)}
                className="text-red-600 hover:text-red-800"
              >
                Delete
              </TableAction>
            )}
          </div>
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [
    canWriteProducts,
    canDeleteProducts,
    canReadCategories,
    warmProductDetail,
    resolveCategory,
  ]);


  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page);
    } else {
      setCurrentPage(page);
    }
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    if (onItemsPerPageChange) {
      onItemsPerPageChange(newItemsPerPage);
    } else {
      setItemsPerPage(newItemsPerPage);
      setCurrentPage(1);
    }
  };

  const handleEditSuccess = () => {
    // Mutation patches admin list + storefront caches; close modal only.
    setShowEditModal(false);
    setSelectedProduct(null);
  };

  const handleDeleteSuccess = () => {
    // Mutation removes product from admin/shop caches; animate row out.
    const productId = selectedProduct?.id || selectedProduct?._id;
    setShowDeleteModal(false);
    setSelectedProduct(null);
    if (!productId) return;
    setDeletingProductId(productId);
    setTimeout(() => {
      setDeletingProductId(null);
    }, 300);
  };

  // Get row classes with animation support
  const getRowClasses = (product: Product) => {
    const baseClasses = "transition-all duration-300 ease-in-out";
    const deletingClasses = deletingProductId === (product._id || product.id)
      ? "opacity-0 transform translate-x-full"
      : "opacity-100 transform translate-x-0";
    return `${baseClasses} ${deletingClasses}`;
  };


  // Error state
  if (parentError) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center">
          <div className="text-red-600 mb-2">
            <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error loading catalog</h3>
          <p className="text-gray-500 mb-4">{parentError.message || 'Failed to fetch products'}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {isLoading ? (
        <div className="bg-white rounded-lg shadow">
          <PageSpinner className="h-64" />
        </div>
      ) : (
        <DataTable
          data={paginatedProducts}
          columns={columns}
          emptyMessage={FOOD_VENDOR_COPY.emptyList}
          rowClassName={getRowClasses}
          pagination={pagination ? {
            currentPage: pagination.page,
            totalPages: pagination.totalPages,
            totalItems: pagination.total, // Server-side total (all products, not filtered)
            itemsPerPage: pagination.limit,
            onPageChange: handlePageChange,
            onItemsPerPageChange: handleItemsPerPageChange,
            showItemsPerPage: true,
            itemsPerPageOptions: [10, 20, 50, 100]
          } : {
            currentPage,
            totalPages,
            totalItems,
            itemsPerPage,
            onPageChange: handlePageChange,
            onItemsPerPageChange: handleItemsPerPageChange,
            showItemsPerPage: true,
            itemsPerPageOptions: [5, 10, 25, 50]
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteProductModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedProduct(null);
        }}
        productId={selectedProduct?.id || selectedProduct?._id || ''}
        productName={selectedProduct?.name || ''}
        onSuccess={handleDeleteSuccess}
      />

      {/* Edit Product Modal */}
      <EditProductModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct as any}
        onSuccess={handleEditSuccess}
      />
    </>
  );
}
