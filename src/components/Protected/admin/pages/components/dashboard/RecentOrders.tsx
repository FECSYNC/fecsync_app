'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import StatusBadge from '../shared/StatusBadge';
import { TableAction } from '../shared';
import type { DashboardOrderStatus } from '../../types/dashboard';

interface Order {
  id: string;
  customer: string;
  status: DashboardOrderStatus;
  amount: string;
}

interface RecentOrdersProps {
  orders: Order[];
  className?: string;
}

export default function RecentOrders({ 
  orders, 
  className = ""
}: RecentOrdersProps) {
  const shortenId = (id: string) => {
    return id.length > 5 ? `${id.substring(0, 5)}...` : id;
  };

  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Recent Orders</h3>
        <AdminPendingLink 
          href="/admin/orders" 
          className="text-sm bg-[#D4AF37] text-white px-3 py-1 rounded-md hover:bg-[#D4AF37]/90 transition-colors cursor-pointer font-medium"
        >
          View All
        </AdminPendingLink>
      </div>
      
      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{shortenId(order.id)}</p>
              <p className="text-xs text-gray-600 truncate">{order.customer}</p>
            </div>
            <div className="text-right shrink-0">
              <StatusBadge status={order.status} size="sm" className="mb-1" />
              <p className="text-sm font-semibold text-gray-900">{order.amount}</p>
              <TableAction
                intent="view"
                href={`/admin/orders/${order.id}`}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                View
              </TableAction>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
