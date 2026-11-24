/**
 * Per-company staff sign-in ({slug}.{root}/signin or /signin/{slug}).
 * The page shows only that company's identity; the login APIs admit only its members.
 */
import prisma from "@/lib/prisma";
import { withDbRetry } from "@/lib/db";
import { getStorefrontOrgId } from "@/lib/org";
import { USE_COMPANY_SIGNIN_CODE, USE_PLATFORM_SIGNIN_CODE } from "@/lib/companyLoginCodes";
import { optimizeCatalogImageUrl } from "@/lib/catalogImages";
import {
  COMPANY_PROFILE_PUBLIC_SELECT,
  toCompanySiteHeaderDto,
} from "@/lib/publicCategory/publicDto";

export type CompanyLoginPage = {
  orgId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  /** Company-uploaded sign-in panel photo (Cloudinary, delivery-optimized). */
  backgroundUrl: string | null;
  phone: string | null;
  supportEmail: string | null;
  website: string | null;
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeSlug(slug: string | null | undefined): string {
  let value = slug ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    return "";
  }
  return value.trim().toLowerCase();
}

/** Registered company by slug; null for unknown slugs and the platform storefront org. */
async function companyBySlug(slug: string | null | undefined) {
  const value = normalizeSlug(slug);
  if (!value) return null;
  const org = await withDbRetry(() =>
    prisma.organization.findUnique({
      where: { slug: value },
      select: {
        id: true,
        name: true,
        slug: true,
        isDefault: true,
        companyProfile: {
          select: {
            ...COMPANY_PROFILE_PUBLIC_SELECT,
            legalName: true,
            letterheadColor: true,
            signinBackgroundUrl: true,
          },
        },
      },
    })
  );
  return org && !org.isDefault ? org : null;
}

/** Only the company's switched-on public fields — same rules as its public category pages. */
export async function companyLoginPageBySlug(
  slug: string | null | undefined
): Promise<CompanyLoginPage | null> {
  const org = await companyBySlug(slug);
  if (!org) return null;
  const profile = org.companyProfile;
  const header = toCompanySiteHeaderDto(org, profile);
  const color = profile?.letterheadColor?.trim() ?? "";
  const background = profile?.signinBackgroundUrl?.trim() ?? "";
  return {
    orgId: org.id,
    slug: org.slug,
    name: profile?.tradingName?.trim() || profile?.legalName?.trim() || org.name.trim(),
    logoUrl: header.logoUrl,
    accentColor: HEX_COLOR.test(color) ? color : null,
    backgroundUrl: /^https:\/\//i.test(background)
      ? optimizeCatalogImageUrl(background, 1600)
      : null,
    phone: header.phone,
    supportEmail: header.supportEmail,
    website: header.website,
  };
}

export { USE_COMPANY_SIGNIN_CODE, USE_PLATFORM_SIGNIN_CODE } from "@/lib/companyLoginCodes";

/** Where a verified account signs in: its company's own page, the platform page, or nowhere special. */
type SignInHome =
  | { kind: "company"; slug: string; name: string }
  | { kind: "platform" }
  | { kind: "none" };

async function signInHome(userId: string): Promise<SignInHome> {
  const storefrontOrgId = await getStorefrontOrgId();
  const rows = await prisma.membership.findMany({
    where: { userId, status: { not: "revoked" } },
    orderBy: { createdAt: "asc" },
    select: {
      status: true,
      org: {
        select: {
          id: true,
          slug: true,
          name: true,
          isDefault: true,
          companyProfile: { select: { tradingName: true, legalName: true } },
        },
      },
    },
  });
  const isPlatformOrg = (org: { id: string; isDefault: boolean }) =>
    org.isDefault || org.id === storefrontOrgId;
  if (rows.some((row) => row.status === "active" && isPlatformOrg(row.org))) {
    return { kind: "platform" };
  }
  const companyRows = rows.filter((row) => !isPlatformOrg(row.org) && row.org.slug);
  const company = (companyRows.find((row) => row.status === "active") ?? companyRows[0])?.org;
  if (!company) return { kind: "none" };
  return {
    kind: "company",
    slug: company.slug,
    name:
      company.companyProfile?.tradingName?.trim() ||
      company.companyProfile?.legalName?.trim() ||
      company.name.trim(),
  };
}

/**
 * The registered company whose own sign-in link this account must use, or null
 * when the platform sign-in is right for it: anyone with an active seat on the
 * platform storefront org (super admin, platform staff, tailors) and customers
 * with no company seat. Revoked company seats no longer tie an account to a company.
 */
export async function companyOnlySignIn(
  userId: string
): Promise<{ slug: string; name: string } | null> {
  const home = await signInHome(userId);
  return home.kind === "company" ? { slug: home.slug, name: home.name } : null;
}

export type CompanyLoginGate =
  | { ok: true; orgId: string }
  | {
      ok: false;
      status: 403 | 404;
      message: string;
      /** Set when the account belongs elsewhere — the client sends it there. */
      code?: typeof USE_COMPANY_SIGNIN_CODE | typeof USE_PLATFORM_SIGNIN_CODE;
      companySlug?: string;
    };

/**
 * Admit a signed-in identity to one company's login only when it holds an
 * active Membership there. Run after the password / Google identity is proven
 * so the answer never reveals who belongs to which company.
 */
export async function companyLoginGate(
  userId: string,
  slug: string
): Promise<CompanyLoginGate> {
  const org = await companyBySlug(slug);
  if (!org) {
    // Renamed / removed link: a proven account still has a home to go to.
    const home = await signInHome(userId);
    if (home.kind === "company") {
      return {
        ok: false,
        status: 403,
        code: USE_COMPANY_SIGNIN_CODE,
        companySlug: home.slug,
        message: `This sign-in link has changed. Taking you to ${home.name}'s sign-in page.`,
      };
    }
    if (home.kind === "platform") {
      return {
        ok: false,
        status: 403,
        code: USE_PLATFORM_SIGNIN_CODE,
        message: "This is a FECSYNC platform account. Taking you to the main sign-in page.",
      };
    }
    return {
      ok: false,
      status: 404,
      message: "This company sign-in link is no longer valid. Ask your administrator for the current link.",
    };
  }
  const name =
    org.companyProfile?.tradingName?.trim() ||
    org.companyProfile?.legalName?.trim() ||
    org.name.trim();
  const membership = await prisma.membership.findFirst({
    where: { userId, orgId: org.id },
    select: { status: true },
    orderBy: { createdAt: "desc" },
  });
  if (membership?.status === "active") return { ok: true, orgId: org.id };
  if (membership?.status === "invited") {
    return {
      ok: false,
      status: 403,
      message: `Your invitation to ${name} is waiting for an administrator to activate it.`,
    };
  }
  if (membership?.status === "suspended") {
    return {
      ok: false,
      status: 403,
      message: `Your access to ${name} has been turned off. Contact your administrator.`,
    };
  }
  // No live seat here (none, or revoked): send the account to where it does belong.
  const home = await signInHome(userId);
  if (home.kind === "company" && home.slug !== org.slug) {
    return {
      ok: false,
      status: 403,
      code: USE_COMPANY_SIGNIN_CODE,
      companySlug: home.slug,
      message: `This account belongs to ${home.name}. Taking you to ${home.name}'s sign-in page.`,
    };
  }
  if (home.kind === "platform") {
    return {
      ok: false,
      status: 403,
      code: USE_PLATFORM_SIGNIN_CODE,
      message: "This is a FECSYNC platform account. Taking you to the main sign-in page.",
    };
  }
  if (membership) {
    return {
      ok: false,
      status: 403,
      message: `Your access to ${name} has been turned off. Contact your administrator.`,
    };
  }
  return {
    ok: false,
    status: 403,
    message: `This account is not a member of ${name}. Use your own company's sign-in link.`,
  };
}
