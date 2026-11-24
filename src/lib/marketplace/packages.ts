/**
 * Marketplace BookingPackage admin CRUD helpers.
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertOrganizationActive, getStorefrontOrgId } from "@/lib/org";
import { assertWithinPlanLimit } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import {
  computePlatformFeeMinor,
  getMarketplaceCurrencyDefault,
} from "@/lib/marketplace/fees";
import { MARKETPLACE_STOREFRONT_MESSAGE } from "@/lib/marketplace/assertChargeReady";

export const BOOKING_PACKAGE_NOT_FOUND = "Booking package not found";
export const BOOKING_PACKAGE_VENUE_SLUG_COLLISION =
  "This slug is already used by a venue location — choose a different package slug so /book/{org}/{slug} does not collide";

function normalizeSlug(raw: unknown): string {
  const s =
    typeof raw === "string"
      ? raw
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64)
      : "";
  if (!s) throw new ForbiddenError("slug is required");
  return s;
}

async function assertRegisteredMarketplaceOrg(orgId: string) {
  const id = requireId(orgId, "orgId");
  const storefrontId = await getStorefrontOrgId();
  if (id === storefrontId) {
    throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { isDefault: true },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
  }
  await assertNotDemoPlanLocked(id);
  await assertOrganizationActive(id);
  return id;
}

async function assertSlugDoesNotCollideWithVenue(
  orgId: string,
  slug: string
): Promise<void> {
  const venue = await prisma.venueLocation.findFirst({
    where: { orgId, slug },
    select: { id: true },
  });
  if (venue) {
    throw new ForbiddenError(BOOKING_PACKAGE_VENUE_SLUG_COLLISION);
  }
}

export function toBookingPackageDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  slug: string;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  capacity: number | null;
  active: boolean;
  published: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    amountMinor: row.amountMinor,
    currency: row.currency,
    capacity: row.capacity,
    active: row.active,
    published: row.published,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listBookingPackagesForOrg(
  orgId: string,
  opts?: { locationId?: string | null; locationIds?: string[]; parkLocked?: boolean }
) {
  const id = await assertRegisteredMarketplaceOrg(orgId);
  const where: { orgId: string; locationId?: string | { in: string[] } } = {
    orgId: id,
  };
  if (opts?.parkLocked) {
    if (opts.locationId) {
      where.locationId = opts.locationId;
    } else if (opts.locationIds?.length) {
      where.locationId = { in: opts.locationIds };
    } else {
      where.locationId = { in: [] };
    }
  } else if (opts?.locationId) {
    where.locationId = opts.locationId;
  }
  const rows = await prisma.bookingPackage.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map(toBookingPackageDto);
}

export async function createBookingPackage(opts: {
  orgId: string;
  title: string;
  slug?: string;
  description?: string | null;
  amountMinor: number;
  currency?: string;
  capacity?: number | null;
  locationId?: string | null;
  /** Park-locked creates must stamp a venue. */
  requireLocation?: boolean;
  published?: boolean;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  const id = await assertRegisteredMarketplaceOrg(opts.orgId);
  await assertWithinPlanLimit(id, "bookingPackages");

  const title = opts.title?.trim();
  if (!title) throw new ForbiddenError("title is required");
  const amountMinor = Math.floor(Number(opts.amountMinor));
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new ForbiddenError("amountMinor must be a positive integer");
  }
  try {
    computePlatformFeeMinor({ amountMinor });
  } catch (err) {
    throw new ForbiddenError(
      err instanceof Error
        ? err.message
        : "amountMinor is too small for the configured platform fee"
    );
  }
  const slug = normalizeSlug(opts.slug || title);
  await assertSlugDoesNotCollideWithVenue(id, slug);
  // v1: single marketplace currency (USD). Ignore client overrides so packages,
  // Connect account default, and checkout stay aligned.
  const currency = getMarketplaceCurrencyDefault();

  const startsAt = opts.startsAt ? new Date(opts.startsAt) : null;
  const endsAt = opts.endsAt ? new Date(opts.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw new ForbiddenError("startsAt is invalid");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new ForbiddenError("endsAt is invalid");
  }
  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
    throw new ForbiddenError("endsAt must be on or after startsAt");
  }

  let locationId: string | null = null;
  if (opts.locationId?.trim()) {
    const loc = await prisma.venueLocation.findFirst({
      where: { id: opts.locationId.trim(), orgId: id },
      select: { id: true },
    });
    if (!loc) throw new ForbiddenError("locationId does not belong to this company");
    locationId = loc.id;
  }
  if (opts.requireLocation && !locationId) {
    throw new ForbiddenError("locationId is required for park-locked creates");
  }

  try {
    const row = await prisma.bookingPackage.create({
      data: {
        orgId: id,
        locationId,
        slug,
        title,
        description: opts.description?.trim() || null,
        amountMinor,
        currency,
        capacity:
          opts.capacity == null || opts.capacity === undefined
            ? null
            : (() => {
                const c = Math.floor(Number(opts.capacity));
                if (!Number.isFinite(c) || c < 1) {
                  throw new ForbiddenError("capacity must be null or at least 1");
                }
                return c;
              })(),
        published: Boolean(opts.published),
        active: opts.active !== false,
        startsAt,
        endsAt,
      },
    });
    return toBookingPackageDto(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw new ForbiddenError("A package with this slug already exists");
    }
    throw err;
  }
}

export async function getBookingPackageForOrg(orgId: string, packageId: string) {
  const id = await assertRegisteredMarketplaceOrg(orgId);
  const row = await prisma.bookingPackage.findFirst({
    where: { id: requireId(packageId, "packageId"), orgId: id },
  });
  if (!row) throw new ForbiddenError(BOOKING_PACKAGE_NOT_FOUND);
  return toBookingPackageDto(row);
}

export async function updateBookingPackage(opts: {
  orgId: string;
  packageId: string;
  title?: string;
  slug?: string;
  description?: string | null;
  amountMinor?: number;
  currency?: string;
  capacity?: number | null;
  locationId?: string | null;
  published?: boolean;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  const id = await assertRegisteredMarketplaceOrg(opts.orgId);
  const existing = await prisma.bookingPackage.findFirst({
    where: { id: requireId(opts.packageId, "packageId"), orgId: id },
  });
  if (!existing) throw new ForbiddenError(BOOKING_PACKAGE_NOT_FOUND);

  const data: Record<string, unknown> = {};
  if (opts.title !== undefined) {
    const title = opts.title.trim();
    if (!title) throw new ForbiddenError("title is required");
    data.title = title;
  }
  if (opts.slug !== undefined) {
    const nextSlug = normalizeSlug(opts.slug);
    if (nextSlug !== existing.slug) {
      await assertSlugDoesNotCollideWithVenue(id, nextSlug);
    }
    data.slug = nextSlug;
  }
  if (opts.description !== undefined) {
    data.description = opts.description?.trim() || null;
  }
  if (opts.amountMinor !== undefined) {
    const amountMinor = Math.floor(Number(opts.amountMinor));
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new ForbiddenError("amountMinor must be a positive integer");
    }
    try {
      computePlatformFeeMinor({ amountMinor });
    } catch (err) {
      throw new ForbiddenError(
        err instanceof Error
          ? err.message
          : "amountMinor is too small for the configured platform fee"
      );
    }
    data.amountMinor = amountMinor;
  }
  // v1: packages always settle in the marketplace default currency (USD).
  data.currency = getMarketplaceCurrencyDefault();
  if (opts.capacity !== undefined) {
    if (opts.capacity == null) {
      data.capacity = null;
    } else {
      const c = Math.floor(Number(opts.capacity));
      if (!Number.isFinite(c) || c < 1) {
        throw new ForbiddenError("capacity must be null or at least 1");
      }
      const held = await prisma.marketplaceBooking.count({
        where: {
          packageId: existing.id,
          status: {
            in: ["pending_payment", "paid", "disputed", "partially_refunded"],
          },
        },
      });
      if (c < held) {
        throw new ForbiddenError(
          `capacity cannot be below ${held} seat(s) already held by open or paid bookings`
        );
      }
      data.capacity = c;
    }
  }
  if (opts.published !== undefined) data.published = Boolean(opts.published);
  if (opts.active !== undefined) data.active = Boolean(opts.active);
  if (opts.startsAt !== undefined) {
    data.startsAt = opts.startsAt ? new Date(opts.startsAt) : null;
    if (data.startsAt && Number.isNaN((data.startsAt as Date).getTime())) {
      throw new ForbiddenError("startsAt is invalid");
    }
  }
  if (opts.endsAt !== undefined) {
    data.endsAt = opts.endsAt ? new Date(opts.endsAt) : null;
    if (data.endsAt && Number.isNaN((data.endsAt as Date).getTime())) {
      throw new ForbiddenError("endsAt is invalid");
    }
  }
  const nextStarts =
    data.startsAt !== undefined
      ? (data.startsAt as Date | null)
      : existing.startsAt;
  const nextEnds =
    data.endsAt !== undefined ? (data.endsAt as Date | null) : existing.endsAt;
  if (
    nextStarts &&
    nextEnds &&
    nextEnds.getTime() < nextStarts.getTime()
  ) {
    throw new ForbiddenError("endsAt must be on or after startsAt");
  }
  if (opts.locationId !== undefined) {
    if (!opts.locationId?.trim()) {
      data.locationId = null;
    } else {
      const loc = await prisma.venueLocation.findFirst({
        where: { id: opts.locationId.trim(), orgId: id },
        select: { id: true },
      });
      if (!loc) throw new ForbiddenError("locationId does not belong to this company");
      data.locationId = loc.id;
    }
  }

  try {
    const row = await prisma.bookingPackage.update({
      where: { id: existing.id },
      data,
    });
    return toBookingPackageDto(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw new ForbiddenError("A package with this slug already exists");
    }
    throw err;
  }
}

export async function deleteBookingPackage(orgId: string, packageId: string) {
  const id = await assertRegisteredMarketplaceOrg(orgId);
  const existing = await prisma.bookingPackage.findFirst({
    where: { id: requireId(packageId, "packageId"), orgId: id },
  });
  if (!existing) throw new ForbiddenError(BOOKING_PACKAGE_NOT_FOUND);

  // Any booking history blocks hard delete (FK Restrict on packageId). Soft-retire
  // even for failed/cancelled/refunded so we never leave an invalid delete state.
  const bookingCount = await prisma.marketplaceBooking.count({
    where: { packageId: existing.id },
  });
  if (bookingCount > 0) {
    const row = await prisma.bookingPackage.update({
      where: { id: existing.id },
      data: { active: false, published: false },
    });
    return { deleted: false, retired: true, package: toBookingPackageDto(row) };
  }

  await prisma.bookingPackage.delete({ where: { id: existing.id } });
  return { deleted: true, retired: false };
}

export async function countPublishedPackagesNeedingPayouts(
  orgId: string
): Promise<number> {
  return prisma.bookingPackage.count({
    where: { orgId, published: true, active: true },
  });
}
