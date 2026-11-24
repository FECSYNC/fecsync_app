'use client';

import dynamic from 'next/dynamic';

/** Lazy how-to modal — keeps the ~146KB guide catalog off the Venues critical path. */
export const DeferredVenuesGuideModal = dynamic(
  () => import('@/components/Protected/admin/components/AdminHowToGuideModal'),
  { ssr: false }
);
