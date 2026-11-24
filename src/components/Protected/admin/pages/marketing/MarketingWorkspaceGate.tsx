'use client';

import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import { isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import MarketingStorefrontNotice from '@/components/Protected/admin/pages/marketing/MarketingStorefrontNotice';

/**
 * Guest Marketing Automation runs on registered Growth+ company workspaces only.
 * Storefront seats see a light notice (no overview/API chunk).
 */
export default function MarketingWorkspaceGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (isStorefrontOrgSession(user)) return <MarketingStorefrontNotice />;
  return <>{children}</>;
}
