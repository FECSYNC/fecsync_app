'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  bookShipmentForOrderId,
  cancelShipmentById,
} from '@/services/shipping';
import {
  useShipmentByIdQuery,
  invalidateShipmentCaches,
} from '@/hooks/useShipments';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { useToast } from '@/contexts/toast-context';
import { ApiError } from '@/utils/api';
import { formatPrice } from '@/utils/currency';
import { P } from '@/lib/auth/permissions';
import { useAuthStore } from '@/store/authStore';

function statusBadge(status: string) {
  const statusClasses: Record<string, string> = {
    pending: 'bg-[#D4AF37]/20 text-[#D4AF37]',
    booked: 'bg-indigo-100 text-indigo-800',
    picked_up: 'bg-blue-100 text-blue-800',
    in_transit: 'bg-blue-100 text-blue-800',
    out_for_delivery: 'bg-sky-100 text-sky-800',
    delivered: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-700',
  };

  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${
        statusClasses[status] || 'bg-gray-100 text-gray-800'
      }`}
    >
      {status.replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

export default function AdminDeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = React.use(params);
  const { canManageDeliveries } = useCatalogActionPermissions();
  const can = useAuthStore((s) => s.can);
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'book' | 'cancel' | null>(null);

  const { data: delivery, isLoading, error, refetch } = useShipmentByIdQuery(
    resolvedParams.id,
    { enabled: can(P.DeliveriesRead) }
  );

  async function invalidate() {
    await invalidateShipmentCaches(queryClient, delivery?.orderId);
    await refetch();
  }

  async function handleBook() {
    if (!delivery?.orderId || busy) return;
    setBusy('book');
    try {
      const result = await bookShipmentForOrderId(delivery.orderId);
      if (result.status === 'failed') {
        addToast(result.failureReason || 'Shipment booking failed', 'error');
      } else {
        addToast('Shipment booked', 'success');
      }
      await invalidate();
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Booking failed',
        'error'
      );
      await invalidate();
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!delivery?.id || busy) return;
    if (!window.confirm('Cancel this shipment with the courier?')) return;
    setBusy('cancel');
    try {
      await cancelShipmentById(delivery.id);
      addToast('Shipment cancelled', 'success');
      await invalidate();
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Cancel failed',
        'error'
      );
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">
        Loading shipment…
      </div>
    );
  }

  if (error || !delivery) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">
            {error instanceof Error ? error.message : 'Delivery not found'}
          </p>
          <Link
            href="/admin/deliveries"
            className="text-[#D4AF37] hover:text-[#D4AF37]/80 transition-colors"
          >
            ← Back to Deliveries
          </Link>
        </div>
      </div>
    );
  }

  const canBook =
    canManageDeliveries &&
    ['failed', 'cancelled', 'pending'].includes(delivery.status) &&
    (!delivery.orderStatus ||
      ['paid', 'shipping', 'shipped'].includes(delivery.orderStatus));
  const canCancel =
    canManageDeliveries &&
    !['cancelled', 'delivered', 'pending'].includes(delivery.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            href="/admin/deliveries"
            className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Deliveries
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 font-mono break-all">
              {delivery.id}
            </h1>
            {statusBadge(delivery.status)}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Order</h3>
                <Link
                  href={`/admin/orders/${delivery.orderId}`}
                  className="text-[#B8860B] hover:underline font-mono text-sm break-all"
                >
                  {delivery.orderId}
                </Link>
                {delivery.orderStatus ? (
                  <p className="text-xs text-gray-500 mt-1 capitalize">
                    Order status: {delivery.orderStatus}
                  </p>
                ) : null}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">
                  Tracking number
                </h3>
                <p className="text-gray-900 font-mono text-sm break-all">
                  {delivery.trackingNumber || '—'}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Customer</h3>
              <p className="text-gray-900">{delivery.customerName || '—'}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Address</h3>
              <p className="text-gray-900">{delivery.orderAddress || '—'}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Courier</h3>
                <p className="text-gray-900">
                  {delivery.courierName || delivery.provider}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">
                  Shipping fee
                </h3>
                <p className="text-gray-900">
                  {delivery.shippingFee > 0
                    ? formatPrice(delivery.shippingFee)
                    : 'Free'}
                </p>
              </div>
            </div>

            {delivery.labelUrl ? (
              <div>
                <a
                  href={delivery.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#B8941F] font-medium hover:underline"
                >
                  Open shipping label
                </a>
              </div>
            ) : null}

            {delivery.trackingUrl ? (
              <div>
                <a
                  href={delivery.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#B8941F] font-medium hover:underline"
                >
                  Open tracking link
                </a>
              </div>
            ) : null}

            {delivery.failureReason ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
                {delivery.failureReason}
              </div>
            ) : null}

            {canManageDeliveries && (canBook || canCancel) ? (
              <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
                {canBook ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={handleBook}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-[#D4AF37] text-black hover:bg-[#B8941F] disabled:opacity-50"
                  >
                    {busy === 'book' ? 'Booking…' : 'Book / retry'}
                  </button>
                ) : null}
                {canCancel ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={handleCancel}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-100 disabled:opacity-50"
                  >
                    {busy === 'cancel' ? 'Cancelling…' : 'Cancel shipment'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
