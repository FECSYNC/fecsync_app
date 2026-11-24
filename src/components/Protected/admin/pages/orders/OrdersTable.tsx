'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { OrderTabId } from './order-tabs';
import { type Order, getOrderCustomerName } from '@/services/order';
import { OrderPrint } from './print';
import { PageSpinner } from '../../components/Spinner';
import { formatPrice } from '@/utils/currency';
import { getOrderDisplayLines } from '@/utils/orderCartLines';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { formatTaxRateLabel, formatOrderShippingFeeLabel, getOrderMoneySummary } from '@/utils/tax';
import { prefetchAdminOrderDetail } from '@/hooks/useOrders';
import { navigateAdminRoute } from '@/lib/adminInstantNav';

const ORDERS_PAGE_SIZE = 10;

interface OrderItem {
  id: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  discount: number;
  total: number;
}

interface OrdersTableProps {
  filters: {
    search: string;
    dateRange: string;
  };
  activeTab: OrderTabId;
  loading?: boolean;
  orders: Order[];
}

export default function OrdersTable({ filters, activeTab, loading = false, orders }: OrdersTableProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [animatingRows, setAnimatingRows] = useState<Set<string>>(new Set());
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const openOrderDetail = (orderId: string) => {
    prefetchAdminOrderDetail(queryClient, orderId);
    navigateAdminRoute(router, `/admin/orders/${orderId}`);
  };

  const warmOrderDetail = (orderId: string) => {
    prefetchAdminOrderDetail(queryClient, orderId);
  };

  // Helper function to calculate profit (mock calculation for now)
  const calculateProfit = (amount: number) => {
    // Simple 10% profit calculation - replace with actual business logic
    return Math.round(amount * 0.1);
  };

  const calculateProfitPercentage = (amount: number, profit: number) => {
    return Math.round((profit / amount) * 100);
  };

  const getStatusBadge = (status: string) => {
    const statusClasses: Record<string, string> = {
      pending: 'bg-[#D4AF37]/20 text-[#D4AF37]',
      initiated: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      shipping: 'bg-indigo-100 text-indigo-800',
      shipped: 'bg-blue-100 text-blue-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };

    const label =
      status === 'shipping'
        ? 'Shipping'
        : status.charAt(0).toUpperCase() + status.slice(1);

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClasses[status] || 'bg-gray-100 text-gray-800'}`}>
        {label}
      </span>
    );
  };

  const getProfitBadge = (percentage: number) => {
    return (
      <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium">
        {percentage}%
      </span>
    );
  };

  const toggleExpanded = (orderId: string) => {
    const isCurrentlyExpanded = expandedRows.has(orderId);

    if (isCurrentlyExpanded) {
      // Closing: Start slide up animation
      setAnimatingRows(prev => new Set(prev).add(orderId));

      // After animation duration, remove from expanded and animating
      setTimeout(() => {
        setExpandedRows(new Set<string>());
        setAnimatingRows(prev => {
          const newSet = new Set(prev);
          newSet.delete(orderId);
          return newSet;
        });
      }, 300); // Match animation duration
    } else {
      // Opening: Close all others first, then open this one
      setExpandedRows(new Set<string>());
      setAnimatingRows(new Set<string>());

      // Small delay to ensure smooth transition
      setTimeout(() => {
        setExpandedRows(new Set([orderId]));
        setAnimatingRows(prev => new Set(prev).add(orderId));

        // Remove from animating after animation completes
        setTimeout(() => {
          setAnimatingRows(prev => {
            const newSet = new Set(prev);
            newSet.delete(orderId);
            return newSet;
          });
        }, 300);
      }, 50);
    }
  };


  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 60) {
      return `${diffInMinutes} min ago`;
    } else if (diffInHours < 24) {
      return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    } else if (diffInDays < 7) {
      return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  // Helper to get user name safely
  const getUserName = (order: Order): string => {
    return getOrderCustomerName(order.user);
  };

  // Helper to get product information safely
  const getProductInfo = (cartProduct: { product: string | null | { _id?: string; name?: string; price?: number; images?: string[];[key: string]: any } }) => {
    if (!cartProduct.product) {
      return { id: null, name: 'Product not found', price: undefined, image: undefined };
    }

    if (typeof cartProduct.product === 'string') {
      // Product is just an ID string
      return {
        id: cartProduct.product,
        name: `Product ${cartProduct.product.substring(0, 8)}`,
        price: undefined,
        image: undefined
      };
    }

    // Product is a populated object
    return {
      id: cartProduct.product._id || null,
      name: cartProduct.product.name || 'Product not found',
      price: typeof cartProduct.product.price === 'number' ? cartProduct.product.price : undefined,
      image: Array.isArray(cartProduct.product.images) && cartProduct.product.images.length > 0
        ? cartProduct.product.images[0]
        : undefined,
    };
  };

  // Filter orders based on search and date filters (tab filtering is done on OrdersPage)
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      let matchesSearch = true;
      if (filters.search.trim()) {
        const searchTerm = filters.search.toLowerCase().trim();
        const userName = getUserName(order).toLowerCase();
        matchesSearch =
          order._id.toLowerCase().includes(searchTerm) ||
          userName.includes(searchTerm) ||
          (order.address || '').toLowerCase().includes(searchTerm);
      }

      let matchesDateRange = true;
      if (filters.dateRange) {
        const orderDate = new Date(order.createdAt);
        const now = new Date();

        switch (filters.dateRange) {
          case 'today':
            matchesDateRange = orderDate.toDateString() === now.toDateString();
            break;
          case 'week': {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            matchesDateRange = orderDate >= weekAgo;
            break;
          }
          case 'month': {
            const monthAgo = new Date(
              now.getFullYear(),
              now.getMonth() - 1,
              now.getDate()
            );
            matchesDateRange = orderDate >= monthAgo;
            break;
          }
          case 'quarter': {
            const quarterAgo = new Date(
              now.getFullYear(),
              now.getMonth() - 3,
              now.getDate()
            );
            matchesDateRange = orderDate >= quarterAgo;
            break;
          }
          case 'year': {
            const yearAgo = new Date(
              now.getFullYear() - 1,
              now.getMonth(),
              now.getDate()
            );
            matchesDateRange = orderDate >= yearAgo;
            break;
          }
          default:
            matchesDateRange = true;
        }
      }

      return matchesSearch && matchesDateRange;
    });
  }, [orders, filters.search, filters.dateRange]);

  // Sort orders by createdAt descending (latest first)
  const sortedOrders = useMemo(
    () =>
      [...filteredOrders].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [filteredOrders]
  );

  const totalItems = sortedOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ORDERS_PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, filters.search, filters.dateRange]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const startIndex = (currentPage - 1) * ORDERS_PAGE_SIZE;
  const paginatedOrders = sortedOrders.slice(
    startIndex,
    startIndex + ORDERS_PAGE_SIZE
  );
  const startItem = totalItems === 0 ? 0 : startIndex + 1;
  const endItem = Math.min(startIndex + ORDERS_PAGE_SIZE, totalItems);

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    let start = Math.max(1, currentPage - 2);
    let end = start + maxButtons - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - maxButtons + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);


  // Expandable content component
  const expandableContent = (order: Order) => {
    const profit = calculateProfit(order.amount);
    const profitPercentage = calculateProfitPercentage(order.amount, profit);

    const displayLines = getOrderDisplayLines(order.carts);

    return (
      <div className="space-y-4">
        {/* Order Items Table with PRINT Button in Header */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TYPE</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">NAME</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PRICE</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QTY</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SIZE</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DISC.</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TOTAL</th>
                <th className="px-4 py-2 text-right">
                  <button
                    onClick={() => setPrintOrder(order)}
                    className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg hover:bg-[#D4AF37]/90 transition-colors text-sm font-medium cursor-pointer"
                  >
                    PRINT
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayLines.length > 0 ? (
                displayLines.map((line, index) => (
                  <tr key={line.key}>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{index + 1}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 capitalize">
                      {line.kind}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {line.name}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {formatPrice(line.unitPrice)}
                      {line.kind === 'fabric' && (
                        <span className="block text-xs text-gray-500">/ {line.yardBundle} yd</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      x{line.quantity}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-900">
                      {line.productNote && line.productNote.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {line.productNote.map((note: string, noteIndex: number) => (
                            <span
                              key={noteIndex}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#D4AF37]/10 text-[#B8941F] border border-[#D4AF37]/30"
                            >
                              {note}
                            </span>
                          ))}
                        </div>
                      ) : line.kind === 'fabric' ? (
                        <span className="text-gray-600">{line.unitLabel}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">0%</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {formatPrice(line.lineTotal)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      <button className="text-gray-400 hover:text-gray-600 cursor-pointer">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-2 text-center text-sm text-gray-500">
                      No cart items available
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>

        {/* Order Summary - Right Aligned with Updated Colors */}
        <div className="flex justify-end">
          <div className="bg-white p-4 rounded-lg border w-full max-w-xs">
            <div className="space-y-2">
              {(() => {
                const money = getOrderMoneySummary(order);
                return (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8B909A]">Subtotal:</span>
                      <span className="text-[#23272E]">
                        {formatPrice(money.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8B909A]">Shipping:</span>
                      <span className="text-[#23272E]">
                        {formatOrderShippingFeeLabel(
                          money.shippingFee,
                          Boolean(order.shippingMethod),
                          formatPrice
                        )}
                      </span>
                    </div>
                    {money.taxAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-[#8B909A]">
                          {formatTaxRateLabel(money.taxRate, money.taxLabel)}:
                        </span>
                        <span className="text-[#23272E]">
                          {formatPrice(money.taxAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8B909A]">Discount:</span>
                      <span className="text-[#23272E]">
                        {formatPrice(0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t pt-2">
                      <span className="text-[#8B909A]">TOTAL:</span>
                      <span className="text-[#23272E]">
                        {formatPrice(money.total)}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  };


  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow">
        <PageSpinner className="h-64" />
      </div>
    );
  }

  if (filteredOrders.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow">
        <div className="p-8 text-center">
          <p className="text-gray-500">No {activeTab} orders found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-14">
                S/N
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Updated by
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Updated
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedOrders.map((order, index) => {
              const serialNumber = startIndex + index + 1;

              return (
                <React.Fragment key={order._id}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onMouseEnter={() => warmOrderDetail(order._id)}
                    onClick={() => openOrderDetail(order._id)}
                  >
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-medium tabular-nums">
                      {serialNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      ...{order._id.slice(-8)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatRelativeTime(order.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {typeof order.updatedByName === 'string' &&
                      order.updatedByName.trim()
                        ? order.updatedByName.trim()
                        : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatRelativeTime(order.updatedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatPrice(order.amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        {getStatusBadge(order.status)}
                      </div>
                    </td>
                    <td
                      className="px-6 py-4 whitespace-nowrap text-sm font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end space-x-2">
                        <TableAction
                          intent="view"
                          href={`/admin/orders/${order._id}`}
                          onMouseEnter={() => warmOrderDetail(order._id)}
                          onFocus={() => warmOrderDetail(order._id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          View
                        </TableAction>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(order._id);
                          }}
                          className="text-gray-400 hover:text-gray-600 transition-colors border border-gray-300 rounded-md p-1 hover:border-gray-400 cursor-pointer"
                        >
                          <svg
                            className={`w-4 h-4 transform transition-transform duration-200 ${expandedRows.has(order._id) ? 'rotate-90' : ''}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Order Details */}
                  {(expandedRows.has(order._id) || animatingRows.has(order._id)) && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 bg-gray-50">
                        <div className={`transition-all duration-300 ease-out ${expandedRows.has(order._id)
                          ? 'animate-in slide-in-from-top-2 opacity-100'
                          : 'animate-out slide-out-to-top-2 opacity-0'
                          }`}>
                          {expandableContent(order)}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination — 10 orders per page */}
      <div className="bg-white px-6 py-3 border-t border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-700">
          Showing <span className="font-medium">{startItem}</span> to{' '}
          <span className="font-medium">{endItem}</span> of{' '}
          <span className="font-medium">{totalItems}</span> results
          <span className="text-gray-400"> · {ORDERS_PAGE_SIZE} per page</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Previous page"
          >
            &lt;
          </button>
          {pageNumbers.map((pageNum) => (
            <button
              key={pageNum}
              type="button"
              onClick={() => setCurrentPage(pageNum)}
              className={`px-3 py-1 text-sm rounded transition-colors cursor-pointer ${
                currentPage === pageNum
                  ? 'bg-[#D4AF37] text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {pageNum}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Next page"
          >
            &gt;
          </button>
        </div>
      </div>

      {/* Print Modal */}
      {printOrder && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setPrintOrder(null)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  Print Order - {printOrder._id}
                </h2>
                <button
                  onClick={() => setPrintOrder(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl font-bold transition-colors hover:bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center"
                >
                  ×
                </button>
              </div>
              <OrderPrint
                order={printOrder}
                onClose={() => setPrintOrder(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
