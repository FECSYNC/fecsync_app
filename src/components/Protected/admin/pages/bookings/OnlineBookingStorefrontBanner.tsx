'use client';

/**
 * Storefront-only tip when Admin opens Online Booking routes on the platform host.
 * Does not replace page content — company workspaces still own live booking data.
 */
import Link from 'next/link';
import { useIsPlatformOpsTenantAppsViewer } from '@/components/Protected/admin/pages/hq/PlatformOpsTenantAppsPanel';

export default function OnlineBookingStorefrontBanner() {
  const show = useIsPlatformOpsTenantAppsViewer();
  if (!show) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">Platform Admin tip</p>
      <p className="mt-1 text-amber-900/90">
        You are on the storefront host. Online Booking catalogs and reservations are
        stored per registered company. Use{' '}
        <Link
          href="/admin/registered-companies"
          className="font-semibold text-[#D4AF37] underline-offset-2 hover:underline"
        >
          Company workspaces
        </Link>{' '}
        to Approve / Set plan, then sign in as that company’s Admin for live data.
      </p>
    </div>
  );
}
