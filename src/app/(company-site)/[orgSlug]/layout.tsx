import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { whiteLabelMetadata } from '@/lib/publicCategory/companySitePage';

/** Company white-label pages: no platform header, footer, or brand metadata. */
export const metadata: Metadata = whiteLabelMetadata({ title: 'Page not found' });

export default function CompanySiteOrgLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-stone-50 text-stone-900">{children}</div>;
}
