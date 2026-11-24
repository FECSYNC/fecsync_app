import { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import AdminLayout from '@/components/Protected/admin/layout/AdminLayout';
import { verifyAccessTokenEdge } from '@/lib/auth/edge-jwt';
import {
  companyBrandingByOrgId,
  companyBrandingBySlug,
  type CompanyBranding,
} from '@/lib/companyBranding';
import { tenantSlugFromHost } from '@/lib/tenantDomain';
import { companyTabIconUrl } from '@/lib/companyBrandIcon';

interface AdminLayoutProps {
  children: ReactNode;
}

/** Session company first; the subdomain only names the company while access is refreshing. */
async function requestCompanyBranding(): Promise<CompanyBranding | null> {
  const raw = (await cookies()).get('access-token')?.value;
  if (raw) {
    try {
      const token = await verifyAccessTokenEdge(raw);
      return companyBrandingByOrgId(token.orgId);
    } catch {
      /* expired — fall back to the host */
    }
  }
  const h = await headers();
  const hostSlug = tenantSlugFromHost(h.get('x-forwarded-host') ?? h.get('host'));
  return hostSlug ? companyBrandingBySlug(hostSlug) : null;
}

/**
 * Metadata streams after the page body — while it is pending the browser tab keeps
 * spinning. Cap the wait: a slow database falls back to the default title instead
 * of holding the document open (the cached branding answers instantly next time).
 */
const BRANDING_METADATA_WAIT_MS = 1_200;

/** Registered companies see their own name + logo in the browser tab. */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await Promise.race([
    requestCompanyBranding().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BRANDING_METADATA_WAIT_MS)),
  ]);
  if (!branding) return {};
  const icon = companyTabIconUrl(branding);
  return {
    title: branding.name,
    applicationName: branding.name,
    robots: { index: false, follow: false },
    icons: {
      icon: [{ url: icon }],
      shortcut: [icon],
      apple: [{ url: icon }],
    },
  };
}

export default function Layout({ children }: AdminLayoutProps) {
  return <AdminLayout>{children}</AdminLayout>;
}
