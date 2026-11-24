'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { TableAction } from '../shared';

interface Product {
  id: string;
  name: string;
  itemCode: string;
  price: string;
  image?: string;
}

interface PopularProductsProps {
  products: Product[];
  totalVisitors?: string;
  className?: string;
}

export default function PopularProducts({ 
  products, 
  totalVisitors = "10.4k Visitors",
  className = ""
}: PopularProductsProps) {
  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Popular catalog items</h3>
          <p className="text-sm text-gray-600">Total {totalVisitors}</p>
        </div>
        <AdminPendingLink
          href="/admin/products"
          className="text-sm bg-[#D4AF37] text-white px-3 py-1 rounded-md hover:bg-[#D4AF37]/90 transition-colors cursor-pointer font-medium"
        >
          View All
        </AdminPendingLink>
      </div>
      
      <div className="space-y-3">
        {products.map((product) => (
          <div key={product.id} className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden shrink-0">
              {product.image ? (
                <img 
                  src={product.image} 
                  alt={product.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="text-gray-500 text-xs font-medium">
                  {product.name.charAt(0)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
              <p className="text-xs text-gray-600">Item: {product.itemCode}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-gray-900">{product.price}</p>
              {product.id && (
                <TableAction
                  intent="view"
                  href={`/admin/products/${product.id}`}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  View
                </TableAction>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
