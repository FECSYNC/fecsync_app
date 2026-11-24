'use client';

import dynamic from 'next/dynamic';

/** Lazy how-to modal — keeps the ~146KB guide catalog off the page critical path. */
export const DeferredMembershipsGuideModal = dynamic(
  () => import('@/components/Protected/admin/components/AdminHowToGuideModal'),
  { ssr: false }
);
