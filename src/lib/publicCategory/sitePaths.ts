/**
 * Company category site paths (/{orgSlug}/{categorySlug}/…). Client-safe.
 * Static first segments always win over the dynamic org segment.
 */
import { isReservedFirstSegment } from "@/lib/publicCategory/slug";

/** Set by the proxy from ?embed=1; any client-sent value is dropped. */
export const COMPANY_EMBED_HEADER = "x-company-site-embed";

export type CompanySitePaths = {
  home: string;
  product: (productId: string, party?: boolean) => string;
  /** Bare path — callers append their own query, including embed=1. */
  checkout: string;
  success: string;
  cancel: string;
};

export function companySiteBase(orgSlug: string, categorySlug: string): string {
  return `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(categorySlug)}`;
}

/** In an embed, every in-frame link keeps embed=1 so the frame stays chrome-free. */
export function companySitePaths(
  orgSlug: string,
  categorySlug: string,
  opts?: { embed?: boolean }
): CompanySitePaths {
  const home = companySiteBase(orgSlug, categorySlug);
  const q = opts?.embed ? "?embed=1" : "";
  return {
    home: `${home}${q}`,
    product: (productId, party = false) =>
      `${home}/${party ? "party" : "p"}/${encodeURIComponent(productId)}${q}`,
    checkout: `${home}/checkout`,
    success: `${home}/payment/success${q}`,
    cancel: `${home}/payment/cancel${q}`,
  };
}

/** True when the path is served by the company category site route group. */
export function isCompanySitePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const segments = pathname.split("?")[0].split("/").filter(Boolean);
  if (segments.length < 2) return false;
  let first = segments[0];
  try {
    first = decodeURIComponent(first);
  } catch {
    return false;
  }
  return !isReservedFirstSegment(first);
}
