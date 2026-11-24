import type { ReactNode } from 'react';
import PartiesDeskHost from '@/components/Protected/admin/pages/parties/PartiesDeskHost';

/** One desk host for every /admin/parties route: sub-nav tabs open as in-place modals. */
export default function AdminPartiesLayout({ children }: { children: ReactNode }) {
  return <PartiesDeskHost>{children}</PartiesDeskHost>;
}
