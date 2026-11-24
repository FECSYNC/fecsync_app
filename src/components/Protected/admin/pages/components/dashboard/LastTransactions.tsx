'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { TableAction } from '../shared';

interface Transaction {
  id: string;
  issuedDate: string;
  total: string;
  status?: string;
}

interface LastTransactionsProps {
  transactions: Transaction[];
  className?: string;
}

export default function LastTransactions({ 
  transactions, 
  className = ""
}: LastTransactionsProps) {
  const shortenId = (id: string) => {
    return id.length > 5 ? `${id.substring(0, 5)}...` : id;
  };

  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Last Transactions</h3>
        <AdminPendingLink 
          href="/admin/orders" 
          className="text-sm bg-[#D4AF37] text-white px-3 py-1 rounded-md hover:bg-[#D4AF37]/90 transition-colors cursor-pointer font-medium"
        >
          View All
        </AdminPendingLink>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-sm font-medium text-gray-600">ID</th>
              <th className="text-left py-2 text-sm font-medium text-gray-600">Issued Date</th>
              <th className="text-left py-2 text-sm font-medium text-gray-600">Total</th>
              <th className="text-left py-2 text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="border-b border-gray-100">
                <td className="py-3 text-sm text-gray-900">{shortenId(transaction.id)}</td>
                <td className="py-3 text-sm text-gray-600">{transaction.issuedDate}</td>
                <td className="py-3 text-sm text-gray-900">{transaction.total}</td>
                <td className="py-3">
                  <TableAction
                    intent="view"
                    href={`/admin/orders/${transaction.id}`}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    View
                  </TableAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
