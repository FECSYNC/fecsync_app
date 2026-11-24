/**
 * White-label identity for a registered company's dashboard (name + logo + slug).
 * The platform storefront org (isDefault) never white-labels — callers fall back
 * to the FECSYNC brand when these return null.
 */
import prisma from "@/lib/prisma";
import { isSubdomainSafeSlug } from "@/lib/tenantDomain";

export type CompanyBranding = {
  orgId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
};

const BRANDING_SELECT = {
  id: true,
  name: true,
  slug: true,
  isDefault: true,
  companyProfile: { select: { legalName: true, tradingName: true, logoUrl: true } },
} as const;

type BrandingRow = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  companyProfile: {
    legalName: string | null;
    tradingName: string | null;
    logoUrl: string | null;
  } | null;
};

function toBranding(row: BrandingRow | null): CompanyBranding | null {
  if (!row || row.isDefault) return null;
  return {
    orgId: row.id,
    slug: row.slug,
    // Trading name is the customer-facing brand; legal name is the fallback.
    name:
      row.companyProfile?.tradingName?.trim() ||
      row.companyProfile?.legalName?.trim() ||
      row.name.trim(),
    logoUrl: row.companyProfile?.logoUrl?.trim() || null,
  };
}

/**
 * Branding is read on every admin document (tab title + icon). Serve it from
 * memory: fresh for BRANDING_TTL_MS, then stale-while-revalidate so a slow
 * database never holds the page open. Profile saves clear it explicitly.
 */
const BRANDING_TTL_MS = 60_000;
type BrandingEntry = {
  value: CompanyBranding | null;
  /** False until the first load succeeds (no stale value to serve yet). */
  loaded: boolean;
  expires: number;
  refreshing?: Promise<CompanyBranding | null>;
};
const brandingCache = new Map<string, BrandingEntry>();

function cachedBranding(key: string, load: () => Promise<CompanyBranding | null>): Promise<CompanyBranding | null> {
  const hit = brandingCache.get(key);
  if (hit?.loaded && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (hit?.refreshing) return hit.loaded ? Promise.resolve(hit.value) : hit.refreshing;

  const refreshing = load()
    .then((value) => {
      brandingCache.set(key, { value, loaded: true, expires: Date.now() + BRANDING_TTL_MS });
      return value;
    })
    .catch((err) => {
      // Keep serving the last good value; retry after a short pause.
      if (hit?.loaded) brandingCache.set(key, { value: hit.value, loaded: true, expires: Date.now() + 10_000 });
      else brandingCache.delete(key);
      throw err;
    });
  if (hit?.loaded) {
    // Stale: answer now, refresh in the background.
    brandingCache.set(key, { ...hit, refreshing });
    refreshing.catch(() => undefined);
    return Promise.resolve(hit.value);
  }
  brandingCache.set(key, { value: null, loaded: false, expires: 0, refreshing });
  return refreshing;
}

/** Call after a company name / trading name / logo change. */
export function invalidateCompanyBranding(orgId?: string | null): void {
  if (!orgId) {
    brandingCache.clear();
    return;
  }
  for (const [key, entry] of brandingCache) {
    if (key === `org:${orgId}` || entry.value?.orgId === orgId) brandingCache.delete(key);
  }
}

export async function companyBrandingByOrgId(
  orgId: string | null | undefined
): Promise<CompanyBranding | null> {
  const id = orgId?.trim();
  if (!id) return null;
  return cachedBranding(`org:${id}`, async () =>
    toBranding(
      await prisma.organization.findUnique({
        where: { id },
        select: BRANDING_SELECT,
      })
    )
  );
}

export async function companyBrandingBySlug(
  slug: string | null | undefined
): Promise<CompanyBranding | null> {
  const value = slug?.trim().toLowerCase();
  if (!value) return null;
  return cachedBranding(`slug:${value}`, async () =>
    toBranding(
      await prisma.organization.findUnique({
        where: { slug: value },
        select: BRANDING_SELECT,
      })
    )
  );
}

// Proxy-local (not shared with API routes), so a slug rename can lag this long.
const SLUG_TTL_MS = 15_000;
const slugCache = new Map<string, { slug: string | null; expires: number }>();

/**
 * Dashboard subdomain label for an org: its slug when it is a registered
 * company with a DNS-safe slug, else null (stays on the root host).
 * Cached briefly — the proxy calls this on every admin request.
 */
export async function dashboardSlugForOrg(
  orgId: string | null | undefined,
  opts?: { fresh?: boolean }
): Promise<string | null> {
  const id = orgId?.trim();
  if (!id) return null;
  const now = Date.now();
  const hit = slugCache.get(id);
  if (!opts?.fresh && hit && hit.expires > now) return hit.slug;
  const row = await prisma.organization.findUnique({
    where: { id },
    select: { slug: true, isDefault: true },
  });
  const slug = row && !row.isDefault && isSubdomainSafeSlug(row.slug) ? row.slug : null;
  if (slugCache.size > 5000) slugCache.clear();
  slugCache.set(id, { slug, expires: now + SLUG_TTL_MS });
  return slug;
}
