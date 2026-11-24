'use client';

import Link from 'next/link';
import type { ShipmentDto } from '@/services/shipping';
import { TableAction } from '../components/shared';

interface DeliveriesTableProps {
  deliveries: ShipmentDto[];
  loading?: boolean;
  canManage?: boolean;
}

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

export default function DeliveriesTable({
  deliveries,
  loading,
  canManage,
}: DeliveriesTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        Loading shipments…
      </div>
    );
  }

  if (!deliveries.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No shipments match these filters.
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
                Shipment
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Courier
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tracking
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Updated
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {deliveries.map((delivery, index) => (
              <tr key={delivery.id} className="hover:bg-gray-50">
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-medium tabular-nums">
                  {index + 1}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 font-mono">
                  {delivery.id.slice(-10)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <Link
                    href={`/admin/orders/${delivery.orderId}`}
                    className="text-[#B8860B] hover:underline font-mono text-xs"
                  >
                    {delivery.orderId.slice(-8)}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {delivery.customerName || '—'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                  <div
                    className="truncate"
                    title={delivery.orderAddress || undefined}
                  >
                    {delivery.orderAddress || '—'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {statusBadge(delivery.status)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {delivery.courierName || delivery.provider || '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono text-xs">
                  {delivery.trackingNumber || '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {delivery.updatedAt
                    ? new Date(delivery.updatedAt).toLocaleString()
                    : '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex space-x-2">
                    <TableAction
                      intent="view"
                      href={`/admin/deliveries/${delivery.id}`}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      View
                    </TableAction>
                    {delivery.trackingUrl ? (
                      <a
                        href={delivery.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#D4AF37] hover:text-[#D4AF37]/80"
                      >
                        Track
                      </a>
                    ) : null}
                    {canManage && (
                      <TableAction
                        intent="update"
                        pendingLabel="Opening…"
                        href={`/admin/deliveries/${delivery.id}`}
                        className="text-gray-600 hover:text-gray-800"
                      >
                        Manage
                      </TableAction>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
