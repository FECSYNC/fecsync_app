/**
 * Guest-facing booking URLs — venue slug only (no company / storefront slug).
 * APIs still resolve tenant via org+venue after the page loads.
 */
import { companySitePaths } from "@/lib/publicCategory/sitePaths";

export function publicBookHomePath(venueSlug: string): string {
  return `/book/${encodeURIComponent(venueSlug)}`;
}

export function publicBookProductPath(
  venueSlug: string,
  productId: string,
  party = false
): string {
  const base = publicBookHomePath(venueSlug);
  return party
    ? `${base}/party/${encodeURIComponent(productId)}`
    : `${base}/p/${encodeURIComponent(productId)}`;
}

export function publicBookCheckoutPath(venueSlug: string): string {
  return `${publicBookHomePath(venueSlug)}/checkout`;
}

/** Company category site context for the shared product / checkout screens. */
export type CompanyBookContext = {
  orgSlug: string;
  categorySlug: string;
  /** ?embed=1 — links and Checkout return URLs keep it. */
  embed?: boolean;
};

export type BookFlowPaths = {
  home: string;
  product: (productId: string, party?: boolean) => string;
  checkout: string;
};

export function bookFlowPaths(
  venueSlug: string,
  company?: CompanyBookContext | null
): BookFlowPaths {
  if (company) {
    const site = companySitePaths(company.orgSlug, company.categorySlug, {
      embed: company.embed,
    });
    return { home: site.home, product: site.product, checkout: site.checkout };
  }
  return {
    home: publicBookHomePath(venueSlug),
    product: (productId, party) =>
      publicBookProductPath(venueSlug, productId, party),
    checkout: publicBookCheckoutPath(venueSlug),
  };
}
