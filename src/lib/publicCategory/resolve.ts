/**
 * Company category site resolution: Organization.slug → active PublicCategoryPage
 * (orgId + slug) → category items. Query/body orgId is never read.
 * Booking items reuse publicBooking.listPublicProducts (published, park booking on,
 * ticket gates, sold-out); menu and membership items are read-only.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { TicketingError } from "@/lib/ticketing/errors";
import { getStorefrontOrgId } from "@/lib/org";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { assertMembershipsEnabled } from "@/lib/memberships/assert";
import { assertTicketingEnabled } from "@/lib/ticketing/assertTicketingEnabled";
import { sellablePlanWhere } from "@/lib/memberships/planCatalogRules";
import { listPublicProducts } from "@/lib/ticketing/publicBooking";
import type { PublicCategoryKindName } from "@/lib/publicCategory/pages";
import type { PublicCategoryLayout } from "@/lib/publicCategory/snippet";
import {
  COMPANY_PROFILE_PUBLIC_SELECT,
  toCompanyBookingCardDto,
  toCompanyMembershipCardDto,
  toCompanyMenuItemDto,
  toCompanySiteHeaderDto,
  type CompanyBookingCardDto,
  type CompanyMembershipCardDto,
  type CompanyMenuItemDto,
  type CompanySiteDto,
  type CompanySiteHeaderDto,
} from "@/lib/publicCategory/publicDto";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ResolvedCompanyCategory = {
  org: { id: string; slug: string; name: string };
  page: {
    id: string;
    kind: PublicCategoryKindName;
    slug: string;
    layout: PublicCategoryLayout;
    embedEnabled: boolean;
    categoryId: string;
  };
  category: { id: string; name: string; description: string | null };
  header: CompanySiteHeaderDto;
};

function normalizeSlug(value: string | null | undefined, max: number): string | null {
  let raw = String(value ?? "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const slug = raw.trim().toLowerCase();
  if (!slug || slug.length > max || !SLUG_RE.test(slug)) return null;
  return slug;
}

/**
 * Null for: unknown org, default storefront, pending/suspended org, Demo plan,
 * missing or inactive page, archived category, booking page without ticketing,
 * membership page without the Memberships module.
 */
export async function resolveCompanyCategory(
  orgSlugRaw: string,
  categorySlugRaw: string
): Promise<ResolvedCompanyCategory | null> {
  const orgSlug = normalizeSlug(orgSlugRaw, 100);
  const categorySlug = normalizeSlug(categorySlugRaw, 80);
  if (!orgSlug || !categorySlug) return null;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, slug: true, name: true, status: true, isDefault: true },
  });
  if (!org || org.isDefault || org.status !== "active") return null;
  const storefrontOrgId = await getStorefrontOrgId().catch(() => null);
  if (storefrontOrgId && storefrontOrgId === org.id) return null;

  const page = await prisma.publicCategoryPage.findFirst({
    where: { orgId: org.id, slug: categorySlug, active: true },
    select: {
      id: true,
      kind: true,
      slug: true,
      layout: true,
      embedEnabled: true,
      bookingCategory: {
        select: { id: true, orgId: true, name: true, description: true, archivedAt: true },
      },
      membershipCategory: {
        select: { id: true, orgId: true, name: true, description: true, archivedAt: true },
      },
      productCategory: {
        select: { id: true, orgId: true, name: true, description: true },
      },
    },
  });
  if (!page) return null;

  const linked =
    page.kind === "booking"
      ? page.bookingCategory
      : page.kind === "membership"
        ? page.membershipCategory
        : page.productCategory;
  if (!linked || linked.orgId !== org.id) return null;
  if ("archivedAt" in linked && linked.archivedAt) return null;

  try {
    await assertNotDemoPlanLocked(org.id);
    if (page.kind === "booking") await assertTicketingEnabled(org.id);
    if (page.kind === "membership") await assertMembershipsEnabled(org.id);
  } catch (err) {
    if (isGuestGateError(err)) return null;
    throw err;
  }

  const profile = await prisma.companyProfile.findUnique({
    where: { orgId: org.id },
    select: COMPANY_PROFILE_PUBLIC_SELECT,
  });

  return {
    org: { id: org.id, slug: org.slug, name: org.name },
    page: {
      id: page.id,
      kind: page.kind,
      slug: page.slug,
      layout: page.layout,
      embedEnabled: page.embedEnabled,
      categoryId: linked.id,
    },
    category: {
      id: linked.id,
      name: linked.name,
      description: linked.description ?? null,
    },
    header: toCompanySiteHeaderDto(org, profile),
  };
}

export function toCompanySiteDto(site: ResolvedCompanyCategory): CompanySiteDto {
  return {
    orgSlug: site.org.slug,
    categorySlug: site.page.slug,
    categoryName: site.category.name,
    categoryDescription: site.category.description,
    kind: site.page.kind,
    layout: site.page.layout,
    header: site.header,
  };
}

/** Plan, billing, module, or publish gate — the guest sees an empty state. */
function isGuestGateError(err: unknown): boolean {
  return err instanceof ForbiddenError || err instanceof TicketingError;
}

type PublicVenueRef = { id: string; slug: string; name: string };

async function publicBookingVenues(orgId: string): Promise<PublicVenueRef[]> {
  return prisma.venueLocation.findMany({
    where: { orgId, status: "active", publicBookingEnabled: true },
    select: { id: true, slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

type PublicProduct = Awaited<ReturnType<typeof listPublicProducts>>[number];

async function categoryProductsAtVenue(
  site: ResolvedCompanyCategory,
  venue: PublicVenueRef
): Promise<PublicProduct[]> {
  // Same gates as /book: org can sell tickets, venue published, product published.
  const products = await listPublicProducts(site.org.slug, venue.slug);
  return products.filter(
    (p) => p.categoryId === site.page.categoryId && p.type !== "add_on"
  );
}

/** Empty when the company cannot sell tickets right now (plan, billing, module). */
export async function listCompanyBookingCards(
  site: ResolvedCompanyCategory
): Promise<CompanyBookingCardDto[]> {
  if (site.page.kind !== "booking") return [];
  const venues = await publicBookingVenues(site.org.id);
  if (!venues.length) return [];
  let perVenue: Array<{ venue: PublicVenueRef; products: PublicProduct[] }>;
  try {
    perVenue = await Promise.all(
      venues.map(async (venue) => ({
        venue,
        products: await categoryProductsAtVenue(site, venue),
      }))
    );
  } catch (err) {
    if (isGuestGateError(err)) return [];
    throw err;
  }
  const withProducts = perVenue.filter((v) => v.products.length > 0);
  const multiPark = withProducts.length > 1;
  return withProducts.flatMap(({ venue, products }) =>
    products.map((p) =>
      toCompanyBookingCardDto(p, multiPark ? venue.name : null)
    )
  );
}

export type CompanyBookingProduct = {
  product: PublicProduct;
  venue: PublicVenueRef;
};

/** Null unless the product is published, bookable, and in this company's category. */
export async function findCompanyBookingProduct(
  site: ResolvedCompanyCategory,
  productId: string
): Promise<CompanyBookingProduct | null> {
  if (site.page.kind !== "booking" || !isValidId(productId)) return null;
  const row = await prisma.admissionProduct.findFirst({
    where: {
      id: productId,
      orgId: site.org.id,
      categoryId: site.page.categoryId,
      published: true,
      archivedAt: null,
      type: { not: "add_on" },
      location: { status: "active", publicBookingEnabled: true },
    },
    select: {
      location: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!row) return null;
  try {
    const products = await categoryProductsAtVenue(site, row.location);
    const product = products.find((p) => p.id === productId);
    return product ? { product, venue: row.location } : null;
  } catch (err) {
    if (isGuestGateError(err)) return null;
    throw err;
  }
}

/** Category product ids at one park — limits product-page alternatives to this category. */
export async function companyCategoryProductIdsAtVenue(
  site: ResolvedCompanyCategory,
  venueId: string
): Promise<string[]> {
  if (site.page.kind !== "booking") return [];
  const rows = await prisma.admissionProduct.findMany({
    where: {
      orgId: site.org.id,
      locationId: venueId,
      categoryId: site.page.categoryId,
      published: true,
      archivedAt: null,
      type: { not: "add_on" },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Read-only menu. Empty when the company plan cannot use workspace apps. */
export async function listCompanyMenuItems(
  site: ResolvedCompanyCategory
): Promise<CompanyMenuItemDto[]> {
  if (site.page.kind !== "menu") return [];
  try {
    await assertNotDemoPlanLocked(site.org.id);
    await assertCompanyBillingEntitled(site.org.id);
  } catch (err) {
    if (isGuestGateError(err)) return [];
    throw err;
  }
  const rows = await prisma.product.findMany({
    where: { orgId: site.org.id, categoryId: site.page.categoryId },
    select: {
      id: true,
      name: true,
      description: true,
      images: true,
      price: true,
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return rows.map(toCompanyMenuItemDto);
}

/** Display only. Empty when the Memberships module is off for this company. */
export async function listCompanyMembershipCards(
  site: ResolvedCompanyCategory
): Promise<CompanyMembershipCardDto[]> {
  if (site.page.kind !== "membership") return [];
  try {
    await assertMembershipsEnabled(site.org.id);
  } catch (err) {
    if (isGuestGateError(err)) return [];
    throw err;
  }
  const rows = await prisma.membershipPlan.findMany({
    where: {
      orgId: site.org.id,
      categoryId: site.page.categoryId,
      ...sellablePlanWhere(),
    },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      price: true,
      currency: true,
      billing: true,
      intervalCount: true,
      intervalUnit: true,
    },
    orderBy: [{ price: "asc" }, { name: "asc" }],
    take: 200,
  });
  return rows.map(toCompanyMembershipCardDto);
}
