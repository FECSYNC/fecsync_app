'use client';

import { useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adBannerKeys } from '@/hooks/useAdBanners';
import type { AdBannerDto } from '@/lib/adBanners.shared';

/** Seed public ad-banner cache before the slider paints. */
export default function AdBannersBootstrap({
  initial,
  children,
}: {
  initial: AdBannerDto[];
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const seeded = useRef(false);

  if (!seeded.current) {
    // SSR may time out before Mongo responds and pass []. Seeding that would
    // mark the query "loaded" and, with refetchOnMount: false, hide the slider
    // until staleTime expires. Only seed when we actually have banners.
    if (initial.length > 0) {
      queryClient.setQueryData(adBannerKeys.public, initial);
    }
    seeded.current = true;
  }

  return <>{children}</>;
}
