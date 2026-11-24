'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { companyTabIconUrl } from '@/lib/companyBrandIcon';
import type { UserProfile } from '@/services/auth';
import { isStorefrontOrgSession } from '@/services/auth';
import FecSyncBrandLogo from '@/components/brand/FecSyncBrandLogo';

export type SessionCompanyBrand = { name: string; logoUrl: string | null };

/**
 * White-label identity for the signed-in company. Null for the platform
 * storefront org (and sessions without a company), which keep the FECSYNC brand.
 */
export function sessionCompanyBrand(
  user:
    | Pick<
        UserProfile,
        | 'orgId'
        | 'storefrontOrgId'
        | 'tradingName'
        | 'legalName'
        | 'companyDisplayName'
        | 'organizationName'
        | 'companyLogoUrl'
      >
    | null
    | undefined
): SessionCompanyBrand | null {
  if (!user?.orgId || isStorefrontOrgSession(user)) return null;
  const name =
    user.tradingName?.trim() ||
    user.legalName?.trim() ||
    user.companyDisplayName?.trim() ||
    user.organizationName?.trim() ||
    '';
  if (!name) return null;
  return { name, logoUrl: user.companyLogoUrl?.trim() || null };
}

type CompanyBrandLogoProps = {
  brand: SessionCompanyBrand;
  variant?: 'onDark' | 'onLight';
  className?: string;
};

export function CompanyBrandLogo({
  brand,
  variant = 'onLight',
  className = '',
}: CompanyBrandLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showLogo = Boolean(brand.logoUrl) && failedSrc !== brand.logoUrl;
  const textColor = variant === 'onDark' ? 'text-white' : 'text-[#0B1F2A]';
  const initial = brand.name.charAt(0).toUpperCase();

  return (
    <span className={`inline-flex items-center gap-2.5 min-w-0 max-w-full ${className}`}>
      {showLogo && brand.logoUrl ? (
        <span className="w-8 h-8 shrink-0 rounded-md bg-white flex items-center justify-center overflow-hidden">
          <Image
            src={brand.logoUrl}
            alt=""
            width={32}
            height={32}
            unoptimized
            className="object-contain w-full h-full"
            onError={() => setFailedSrc(brand.logoUrl)}
          />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={`w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-sm font-bold ${
            variant === 'onDark' ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-800'
          }`}
        >
          {initial}
        </span>
      )}
      <span
        className={`text-[0.95rem] font-extrabold tracking-tight leading-tight truncate ${textColor}`}
        title={brand.name}
      >
        {brand.name}
      </span>
    </span>
  );
}

/**
 * Keep the tab title + icon on the company brand after in-app edits (logo
 * upload, rename) and client navigations — server metadata only runs per request.
 */
function useDocumentCompanyBrand(brand: SessionCompanyBrand | null) {
  const pathname = usePathname();
  const name = brand?.name ?? null;
  const logoUrl = brand?.logoUrl ?? null;
  useEffect(() => {
    if (!name) return;
    const icon = companyTabIconUrl({ name, logoUrl });
    const apply = () => {
      if (document.title !== name) document.title = name;
      document
        .querySelectorAll<HTMLLinkElement>(
          'link[rel~="icon"], link[rel="apple-touch-icon"]'
        )
        .forEach((link) => {
          if (link.getAttribute('href') === icon) return;
          link.removeAttribute('type');
          link.removeAttribute('sizes');
          link.setAttribute('href', icon);
        });
    };
    apply();
    // Streamed / navigated metadata can re-insert the platform default ("FECSYNC")
    // after this effect ran — re-apply whenever <head> title or icons change.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    return () => observer.disconnect();
  }, [name, logoUrl, pathname]);
}

/**
 * Dashboard lockup: the company's own name + logo for registered companies,
 * the FECSYNC lockup only for the platform storefront org.
 */
export default function DashboardBrandLogo({
  user,
  variant = 'onLight',
  className = '',
}: {
  user: Parameters<typeof sessionCompanyBrand>[0];
  variant?: 'onDark' | 'onLight';
  className?: string;
}) {
  const brand = user ? sessionCompanyBrand(user) : null;
  useDocumentCompanyBrand(brand);
  if (!user) {
    return <span className={`inline-block h-8 w-32 ${className}`} aria-hidden="true" />;
  }
  if (brand) {
    return <CompanyBrandLogo brand={brand} variant={variant} className={className} />;
  }
  return <FecSyncBrandLogo size="sm" variant={variant} href={null} className={className} />;
}
