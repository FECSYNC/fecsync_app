/**
 * Server helpers for the (company-site) route group: one rate-limited resolve
 * per request (shared by generateMetadata, layout, and page) and white-label metadata.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rateLimit";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  resolveCompanyCategory,
  type ResolvedCompanyCategory,
} from "@/lib/publicCategory/resolve";
import {
  COMPANY_EMBED_HEADER,
  companySiteBase,
} from "@/lib/publicCategory/sitePaths";

/** True for ?embed=1 (flag set by the proxy, never trusted from the client). */
export async function isCompanyEmbedRequest(): Promise<boolean> {
  return (await headers()).get(COMPANY_EMBED_HEADER) === "1";
}

export type CompanySiteLoad =
  | { status: "ok"; site: ResolvedCompanyCategory }
  | { status: "missing" }
  | { status: "throttled" };

export const loadCompanySite = cache(
  async (orgSlug: string, categorySlug: string): Promise<CompanySiteLoad> => {
    const ip = clientIpFromHeaders(await headers());
    const limit = consumeRateLimit(`public-category-resolve:${ip}:`, 60, 60_000);
    if (!limit.allowed) return { status: "throttled" };
    const site = await resolveCompanyCategory(orgSlug, categorySlug);
    return site ? { status: "ok", site } : { status: "missing" };
  }
);

/**
 * Page entry: 404 when missing (or the wrong kind), null when throttled
 * (the layout already renders the throttle notice).
 */
export async function requireCompanySite(
  params: Promise<{ orgSlug: string; categorySlug: string }>,
  kind?: ResolvedCompanyCategory["page"]["kind"]
): Promise<ResolvedCompanyCategory | null> {
  const { orgSlug, categorySlug } = await params;
  const load = await loadCompanySite(orgSlug, categorySlug);
  if (load.status === "throttled") return null;
  if (load.status === "missing") notFound();
  if (kind && load.site.page.kind !== kind) notFound();
  if (!load.site.page.embedEnabled && (await isCompanyEmbedRequest())) notFound();
  return load.site;
}

/** Replaces every root-layout brand field so no platform name reaches the head. */
export function whiteLabelMetadata(opts: {
  title: string;
  description?: string | null;
  siteName?: string | null;
  path?: string | null;
  logoUrl?: string | null;
  index?: boolean;
}): Metadata {
  const description = opts.description?.trim() || null;
  return {
    metadataBase: new URL(publicAppBaseUrl()),
    title: { absolute: opts.title },
    description,
    keywords: null,
    authors: null,
    creator: null,
    publisher: null,
    alternates: opts.path ? { canonical: opts.path } : null,
    icons: opts.logoUrl ? { icon: opts.logoUrl } : null,
    openGraph: {
      type: "website",
      title: opts.title,
      ...(description ? { description } : {}),
      ...(opts.siteName ? { siteName: opts.siteName } : {}),
      ...(opts.path ? { url: opts.path } : {}),
      images: opts.logoUrl ? [{ url: opts.logoUrl }] : [],
    },
    twitter: {
      card: "summary",
      title: opts.title,
      ...(description ? { description } : {}),
      images: opts.logoUrl ? [opts.logoUrl] : [],
    },
    robots: opts.index ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export async function companySiteMetadata(
  orgSlug: string,
  categorySlug: string,
  opts?: { index?: boolean }
): Promise<Metadata> {
  const load = await loadCompanySite(orgSlug, categorySlug);
  if (load.status !== "ok") {
    return whiteLabelMetadata({ title: "Page not found" });
  }
  const { site } = load;
  return whiteLabelMetadata({
    title: `${site.header.name} — ${site.category.name}`,
    description: site.category.description,
    siteName: site.header.name,
    path: companySiteBase(site.org.slug, site.page.slug),
    logoUrl: site.header.logoUrl,
    index: opts?.index,
  });
}
