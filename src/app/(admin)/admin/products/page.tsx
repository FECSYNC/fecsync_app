import { Suspense } from 'react';
import ProductsPage from '@/components/Protected/admin/pages/products/ProductsPage';

function ProductsPageFallback() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-gray-200 rounded" />
      <div className="h-10 w-full bg-gray-100 rounded" />
      <div className="h-64 w-full bg-gray-100 rounded" />
    </div>
  );
}

export default function AdminProductsPage() {
  return (
    <Suspense fallback={<ProductsPageFallback />}>
      <ProductsPage />
    </Suspense>
  );
}
