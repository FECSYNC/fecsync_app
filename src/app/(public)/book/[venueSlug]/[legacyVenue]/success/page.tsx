import { Suspense } from 'react';
import MarketplaceBookSuccessClient from '@/components/Public_C/marketplace/MarketplaceBookSuccessClient';

export default async function MarketplaceBookSuccessPage({
  params,
}: {
  params: Promise<{ venueSlug: string; legacyVenue: string }>;
}) {
  const { venueSlug: orgSlug, legacyVenue: packageSlug } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
        </div>
      }
    >
      <MarketplaceBookSuccessClient
        orgSlug={orgSlug}
        packageSlug={packageSlug}
      />
    </Suspense>
  );
}
