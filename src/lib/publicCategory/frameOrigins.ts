/**
 * Who may frame a company's category pages: the app itself, the company's saved
 * CompanyEmbedOrigin rows, and the origin of CompanyProfile.website when it is https.
 * Used for the CSP frame-ancestors header (proxy) and the embed checkout origin check.
 */
import prisma from "@/lib/prisma";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { parseEmbedOrigin } from "@/lib/publicCategory/origins";

export function appOrigin(): string {
  return new URL(publicAppBaseUrl()).origin;
}

/** https origin of a saved website, or null (http, invalid, or empty). */
export function websiteFrameOrigin(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  try {
    return parseEmbedOrigin(new URL(raw).origin);
  } catch {
    return null;
  }
}

function eligible(org: { status: string; isDefault: boolean } | null): boolean {
  return Boolean(org && !org.isDefault && org.status === "active");
}

function collect(org: {
  embedOrigins: { origin: string }[];
  companyProfile: { website: string | null } | null;
}): string[] {
  const out = new Set<string>();
  for (const row of org.embedOrigins) {
    try {
      out.add(parseEmbedOrigin(row.origin));
    } catch {
      /* stored before validation tightened — never emit it */
    }
  }
  const site = websiteFrameOrigin(org.companyProfile?.website);
  if (site) out.add(site);
  return [...out];
}

const FRAME_SELECT = {
  status: true,
  isDefault: true,
  embedOrigins: { select: { origin: true } },
  companyProfile: { select: { website: true } },
} as const;

/** Company origins (no 'self') by Organization.slug. Empty for unknown or ineligible orgs. */
export async function companyFrameOriginsBySlug(orgSlug: string): Promise<string[]> {
  const slug = orgSlug.trim().toLowerCase();
  if (!slug || slug.length > 100) return [];
  const org = await prisma.organization.findUnique({ where: { slug }, select: FRAME_SELECT });
  return org && eligible(org) ? collect(org) : [];
}

export async function companyFrameOrigins(orgId: string): Promise<string[]> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: FRAME_SELECT });
  return org && eligible(org) ? collect(org) : [];
}

/** CSP value for company-site responses. Origins come from parseEmbedOrigin (no spaces or ;). */
export function frameAncestorsPolicy(origins: string[]): string {
  return ["frame-ancestors", "'self'", ...origins].join(" ");
}

/** Origin of an Origin or Referer header value, or null. */
export function headerOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw === "null") return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
