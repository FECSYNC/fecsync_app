'use client';

import Link from 'next/link';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';

export default function ReviewsPage() {
  const { canModerateReviews } = useCatalogActionPermissions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <p className="text-gray-600 mt-1">
          Product review moderation for your catalog. Customers submit reviews on
          the storefront; staff moderation tools will expand here.
        </p>
      </div>

      {!canModerateReviews && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          You have read access. Approving or removing reviews requires{' '}
          <span className="font-medium">reviews:moderate</span>.
        </p>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900">Coming soon</h2>
        <p className="text-sm text-gray-600 mt-2">
          A full moderation queue (filter by product, rating, and status) is
          planned. Until then, product-level reviews are visible on the public
          product pages and via the reviews API.
        </p>
        <Link
          href="/admin/products"
          className="inline-block mt-4 text-sm font-medium text-[#B8860B] hover:text-[#8B6914]"
        >
          Go to products →
        </Link>
      </div>
    </div>
  );
}
