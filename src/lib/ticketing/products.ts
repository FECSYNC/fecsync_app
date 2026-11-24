/**
 * Admission product catalog (all product types).
 */
import {
  type AdmissionProduct,
  type AdmissionProductType,
  Prisma,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  assertVenueActiveForTicketingMutate,
  locationScopeFilter,
  applyTicketingLocationScope,
  parseOptionalId,
  rejectClientOrgFields,
  requireActorVenue,
  PRODUCT_NOT_FOUND,
  LOCATION_REQUIRED,
  type TicketingActor,
} from "@/lib/ticketing/common";
import { validatePriceBands } from "@/lib/ticketing/pricing";
import { resolveBookingCategoryId } from "@/lib/ticketing/categories";

const PRODUCT_TYPES = new Set<string>([
  "timed_session",
  "day_pass",
  "group",
  "camp_event",
  "party_package",
  "add_on",
  "pass",
]);

export type PriceBandInput = {
  code: string;
  amount: number;
  currency?: string;
  minAge?: number | null;
  maxAge?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
};

export type CreateProductInput = {
  type: AdmissionProductType;
  name: string;
  description?: string | null;
  images?: string[];
  locationId: string;
  resourceId?: string | null;
  /** Existing BookingCategory id; null/omit = uncategorized. */
  categoryId?: string | null;
  published?: boolean;
  waiverRequired?: boolean;
  minGuests?: number | null;
  maxGuests?: number | null;
  defaultPassExpiryDays?: number | null;
  taxExemptDefault?: boolean;
  prices?: PriceBandInput[];
};

export type ProductListFilters = {
  type?: AdmissionProductType | "all";
  published?: boolean | "all";
  locationId?: string;
  /** Filter by BookingCategory.id (cuid). */
  categoryId?: string;
  includeArchived?: boolean;
  addOnsOnly?: boolean;
  passesOnly?: boolean;
  /** Cap list rows (default 100, max 200) for fast Product Catalog opens. */
  take?: number;
  skip?: number;
};

function requireProductType(raw: unknown): AdmissionProductType {
  if (typeof raw !== "string" || !PRODUCT_TYPES.has(raw)) {
    throw new Error("Invalid product type");
  }
  return raw as AdmissionProductType;
}

function requireName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Name is required");
  const name = raw.trim();
  if (name.length < 2) throw new Error("Name is required");
  if (name.length > 160) throw new Error("Name is too long");
  return name;
}

function requirePositiveAmount(amount: number, label = "Price"): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  return amount;
}

function requireGuestBounds(
  minGuests: number | null | undefined,
  maxGuests: number | null | undefined
) {
  if (minGuests != null) {
    if (!Number.isInteger(minGuests) || minGuests < 0) {
      throw new Error("minGuests must be a non-negative integer");
    }
  }
  if (maxGuests != null) {
    if (!Number.isInteger(maxGuests) || maxGuests < 0) {
      throw new Error("maxGuests must be a non-negative integer");
    }
  }
  if (minGuests != null && maxGuests != null && minGuests > maxGuests) {
    throw new Error("minGuests cannot exceed maxGuests");
  }
}

function requirePassExpiryDays(raw: number | null | undefined) {
  if (raw == null) return;
  if (!Number.isInteger(raw) || raw < 0) {
    throw new Error("defaultPassExpiryDays must be a non-negative integer");
  }
}

/**
 * Resolve optional booking category against actor org. Never trusts client orgId.
 * Empty/null → uncategorized. Foreign/missing/archived → Error.
 */
async function resolveOptionalCategoryId(
  orgId: string,
  categoryId: string | null | undefined
): Promise<string | null> {
  if (categoryId == null) return null;
  const raw = String(categoryId).trim();
  if (!raw) return null;
  if (raw.length > 128) {
    throw new Error("Invalid categoryId");
  }
  try {
    return await resolveBookingCategoryId(orgId, raw);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      throw new ForbiddenError("Category not found");
    }
    throw err;
  }
}

/** Map FK races (e.g. category deleted between resolve and write) to a 400-able Error. */
function rethrowKnownProductWriteFailures(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2003"
  ) {
    throw new Error("Invalid category or related reference");
  }
  throw err;
}

const productIncludeBase = {
  prices: { orderBy: { amount: "asc" as const } },
  resource: {
    select: { id: true, name: true, defaultCapacity: true },
  },
  location: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, orgId: true } },
  _count: { select: { parentLinks: true, sessions: true } },
};

/** Table lists: skip session counts + full price bands (huge with bulk slots). */
const productListInclude = {
  prices: { orderBy: { amount: "asc" as const }, take: 1 },
  resource: {
    select: { id: true, name: true, defaultCapacity: true },
  },
  location: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, orgId: true } },
  _count: { select: { parentLinks: true } },
};

function normalizeProductImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("images must be an array");
  if (raw.length > 12) throw new Error("At most 12 images are allowed");
  const out: string[] = [];
  for (const u of raw) {
    if (typeof u !== "string") throw new Error("Invalid image URL");
    const url = u.trim();
    if (!url) continue;
    if (url.length > 2048) throw new Error("Image URL is too long");
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Image URLs must start with http:// or https://");
    }
    out.push(url);
  }
  return out;
}

function assertPartyRoomType(type: string) {
  if (type !== "room" && type !== "party_room") {
    throw new Error(
      "Party packages require a room / party_room capacity resource"
    );
  }
}

function toNumber(d: Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

export function toProductDto(
  row: AdmissionProduct & {
    prices?: Array<{
      id: string;
      code: string;
      amount: Decimal;
      currency: string;
      minAge: number | null;
      maxAge: number | null;
    }>;
    resource?: { id: string; name: string; defaultCapacity: number } | null;
    location?: { id: string; name: string; slug: string } | null;
    category?: { id: string; name: string; orgId?: string } | null;
    _count?: { parentLinks?: number; sessions?: number };
  }
) {
  const prices = row.prices ?? [];
  const amounts = prices.map((p) => toNumber(p.amount));
  // Defense in depth: never surface a category that is not owned by the product org.
  const categorySafe =
    row.category &&
    (row.category.orgId == null || row.category.orgId === row.orgId)
      ? { id: row.category.id, name: row.category.name }
      : null;
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    categoryId: categorySafe ? row.categoryId ?? null : null,
    category: categorySafe,
    type: row.type,
    name: row.name,
    description: row.description,
    images: row.images,
    resourceId: row.resourceId,
    published: row.published,
    waiverRequired: row.waiverRequired,
    minGuests: row.minGuests,
    maxGuests: row.maxGuests,
    defaultPassExpiryDays: row.defaultPassExpiryDays,
    taxExemptDefault: row.taxExemptDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    prices: prices.map((p) => ({
      id: p.id,
      code: p.code,
      amount: toNumber(p.amount),
      currency: p.currency,
      minAge: p.minAge,
      maxAge: p.maxAge,
    })),
    priceFrom: amounts.length ? Math.min(...amounts) : null,
    resource: row.resource
      ? {
          id: row.resource.id,
          name: row.resource.name,
          defaultCapacity: row.resource.defaultCapacity,
        }
      : null,
    location: row.location
      ? {
          id: row.location.id,
          name: row.location.name,
          slug: row.location.slug,
        }
      : null,
    parentLinksCount: row._count?.parentLinks ?? 0,
    sessionsCount: row._count?.sessions ?? 0,
  };
}

export async function listAdmissionProducts(
  actor: TicketingActor,
  filters: ProductListFilters = {}
) {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.AdmissionProductWhereInput = {
    orgId: scope.orgId,
  };
  applyTicketingLocationScope(scope, where);
  if (
    !scope.parkLocked &&
    !scope.locationId &&
    filters.locationId !== undefined &&
    filters.locationId !== ""
  ) {
    if (!isValidId(filters.locationId)) {
      throw new Error("Invalid locationId");
    }
    where.locationId = filters.locationId;
  }
  if (filters.type && filters.type !== "all") where.type = filters.type;
  if (filters.addOnsOnly) where.type = "add_on";
  if (filters.passesOnly) where.type = "pass";
  if (filters.published === true || filters.published === false) {
    where.published = filters.published;
  }
  if (filters.categoryId !== undefined && filters.categoryId !== "") {
    const raw = String(filters.categoryId).trim();
    if (!raw || raw.length > 128 || !isValidId(raw)) {
      throw new Error("Invalid categoryId");
    }
    // Same-org resolution as create/update — foreign/archived ids deny.
    const catId = await resolveOptionalCategoryId(scope.orgId, raw);
    if (!catId) {
      throw new ForbiddenError("Category not found");
    }
    where.categoryId = catId;
  }
  if (!filters.includeArchived) where.archivedAt = null;

  const take = Math.min(200, Math.max(1, Number(filters.take) || 100));
  const skip = Math.max(0, Number(filters.skip) || 0);

  const rows = await prisma.admissionProduct.findMany({
    where,
    include: productListInclude,
    orderBy: [{ updatedAt: "desc" }],
    take,
    skip,
  });
  return rows.map(toProductDto);
}

export async function getAdmissionProduct(
  actor: TicketingActor,
  productId: string
) {
  await assertTicketingStaffRead(actor);
  const orgId = requireId(
    (await locationScopeFilter(actor)).orgId,
    "orgId"
  );
  const row = await prisma.admissionProduct.findFirst({
    where: { id: requireId(productId, "productId"), orgId },
    include: {
      ...productIncludeBase,
      parentLinks: true,
      addOnLinks: {
        include: {
          addOnProduct: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });
  if (!row) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  await assertLocationInHqScope(actor, row.locationId);
  return {
    ...toProductDto(row),
    addOnLinks: row.addOnLinks.map((l) => ({
      id: l.id,
      addOnProductId: l.addOnProductId,
      required: l.required,
      maxQty: l.maxQty,
      stockPeriodId: l.stockPeriodId,
      addOnProduct: l.addOnProduct,
    })),
  };
}

export async function createAdmissionProduct(
  actor: TicketingActor,
  input: CreateProductInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const type = requireProductType(input.type);
  const name = requireName(input.name);
  if (!input.locationId || !isValidId(input.locationId)) {
    throw new Error(LOCATION_REQUIRED);
  }
  const venue = await requireActorVenue(orgId, input.locationId);

  await assertLocationInHqScope(actor, venue.id);

  let resourceId: string | null = null;
  if (input.resourceId) {
    const resource = await prisma.capacityResource.findFirst({
      where: {
        id: requireId(input.resourceId, "resourceId"),
        orgId,
        locationId: venue.id,
        archivedAt: null,
      },
    });
    if (!resource) throw new ForbiddenError("Capacity resource not found");
    resourceId = resource.id;
  }

  if (type === "party_package") {
    if (!resourceId) {
      throw new Error(
        "Party packages require a room / party_room capacity resource"
      );
    }
    const room = await prisma.capacityResource.findFirst({
      where: { id: resourceId, orgId, locationId: venue.id, archivedAt: null },
      select: { type: true },
    });
    if (!room) throw new ForbiddenError("Capacity resource not found");
    assertPartyRoomType(room.type);
  }

  requireGuestBounds(input.minGuests ?? null, input.maxGuests ?? null);
  requirePassExpiryDays(input.defaultPassExpiryDays ?? null);

  const prices = input.prices ?? [];
  if (!prices.length) {
    throw new Error("At least one price band is required");
  }
  validatePriceBands(prices);

  const images =
    input.images !== undefined ? normalizeProductImages(input.images) : [];

  const categoryId = await resolveOptionalCategoryId(orgId, input.categoryId);

  let row;
  try {
    row = await prisma.admissionProduct.create({
      data: {
        orgId,
        locationId: venue.id,
        categoryId,
        type,
        name,
        description: input.description?.trim() || null,
        images,
        resourceId,
        published: Boolean(input.published),
        waiverRequired: Boolean(input.waiverRequired),
        minGuests: input.minGuests ?? null,
        maxGuests: input.maxGuests ?? null,
        defaultPassExpiryDays: input.defaultPassExpiryDays ?? null,
        taxExemptDefault: Boolean(input.taxExemptDefault),
        prices: {
          create: prices.map((p) => ({
            orgId,
            locationId: venue.id,
            code: p.code.trim().toLowerCase(),
            amount: new Decimal(requirePositiveAmount(Number(p.amount))),
            currency: (p.currency || "USD").toUpperCase().slice(0, 3),
            minAge: p.minAge ?? null,
            maxAge: p.maxAge ?? null,
            validFrom: p.validFrom ? new Date(p.validFrom) : null,
            validTo: p.validTo ? new Date(p.validTo) : null,
          })),
        },
      },
      include: productIncludeBase,
    });
  } catch (err) {
    rethrowKnownProductWriteFailures(err);
  }
  return toProductDto(row);
}

export async function updateAdmissionProduct(
  actor: TicketingActor,
  productId: string,
  patch: Partial<CreateProductInput> & {
    published?: boolean;
    archive?: boolean;
    unarchive?: boolean;
  }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const existing = await prisma.admissionProduct.findFirst({
    where: { id: requireId(productId, "productId"), orgId },
  });
  if (!existing) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  await assertLocationInHqScope(actor, existing.locationId);

  const productInclude = productIncludeBase;

  // Idempotent archive / wind-down allowed on archived venues.
  if (patch.archive) {
    if (existing.archivedAt) {
      // Heal legacy rows that were archived before category disconnect shipped.
      if (existing.categoryId) {
        const healed = await prisma.admissionProduct.update({
          where: { id: existing.id },
          data: { category: { disconnect: true } },
          include: productInclude,
        });
        return toProductDto(healed);
      }
      const row = await prisma.admissionProduct.findFirst({
        where: { id: existing.id },
        include: productInclude,
      });
      return toProductDto(row!);
    }
    await assertVenueActiveForTicketingMutate(orgId, existing.locationId, {
      allowArchived: true,
    });
    const row = await prisma.$transaction(async (tx) => {
      await tx.ticketSession.updateMany({
        where: { productId: existing.id, isClosed: false },
        data: { isClosed: true },
      });
      return tx.admissionProduct.update({
        where: { id: existing.id },
        data: {
          archivedAt: new Date(),
          published: false,
          // Release category so Booking category archive is not trapped by soft-archived rows.
          category: { disconnect: true },
        },
        include: productInclude,
      });
    }).catch((err) => {
      rethrowKnownProductWriteFailures(err);
    });
    return toProductDto(row);
  }

  await assertVenueActiveForTicketingMutate(orgId, existing.locationId);

  if (existing.archivedAt && !patch.unarchive) {
    throw new Error("Archived products cannot be edited — unarchive first");
  }

  const data: Prisma.AdmissionProductUpdateInput = {};
  if (patch.name !== undefined) data.name = requireName(patch.name);
  if (patch.description !== undefined) {
    data.description = patch.description?.trim() || null;
  }
  if (patch.images !== undefined) {
    data.images = normalizeProductImages(patch.images);
  }

  const nextResourceId =
    patch.resourceId !== undefined ? patch.resourceId : existing.resourceId;
  const willPublish =
    patch.published === true ||
    (existing.published && patch.published !== false);

  if (willPublish && existing.type === "party_package" && !nextResourceId) {
    throw new Error(
      "Party packages require a room / party_room capacity resource before publish"
    );
  }
  if (patch.published === true) {
    const priceCount = await prisma.admissionProductPrice.count({
      where: { productId: existing.id },
    });
    if (priceCount < 1) {
      throw new Error("Publish requires at least one price band");
    }
  }
  if (patch.published !== undefined) data.published = Boolean(patch.published);

  if (patch.waiverRequired !== undefined) {
    data.waiverRequired = Boolean(patch.waiverRequired);
  }
  if (patch.taxExemptDefault !== undefined) {
    data.taxExemptDefault = Boolean(patch.taxExemptDefault);
  }

  const nextMin =
    patch.minGuests !== undefined ? patch.minGuests : existing.minGuests;
  const nextMax =
    patch.maxGuests !== undefined ? patch.maxGuests : existing.maxGuests;
  requireGuestBounds(nextMin, nextMax);
  if (patch.minGuests !== undefined) data.minGuests = patch.minGuests;
  if (patch.maxGuests !== undefined) data.maxGuests = patch.maxGuests;

  if (patch.defaultPassExpiryDays !== undefined) {
    requirePassExpiryDays(patch.defaultPassExpiryDays);
    data.defaultPassExpiryDays = patch.defaultPassExpiryDays;
  }
  if (patch.resourceId !== undefined) {
    if (patch.resourceId) {
      const resource = await prisma.capacityResource.findFirst({
        where: {
          id: requireId(patch.resourceId, "resourceId"),
          orgId,
          locationId: existing.locationId,
          archivedAt: null,
        },
      });
      if (!resource) throw new ForbiddenError("Capacity resource not found");
      if (existing.type === "party_package") {
        assertPartyRoomType(resource.type);
      }
      data.resource = { connect: { id: resource.id } };
    } else {
      if (willPublish && existing.type === "party_package") {
        throw new Error(
          "Cannot remove room resource from a published party package"
        );
      }
      data.resource = { disconnect: true };
    }
  }
  if (patch.categoryId !== undefined) {
    const categoryId = await resolveOptionalCategoryId(orgId, patch.categoryId);
    if (categoryId) {
      data.category = { connect: { id: categoryId } };
    } else {
      data.category = { disconnect: true };
    }
  }
  if (patch.unarchive) data.archivedAt = null;

  let row;
  try {
    row = await prisma.admissionProduct.update({
      where: { id: existing.id },
      data,
      include: productInclude,
    });
  } catch (err) {
    rethrowKnownProductWriteFailures(err);
  }
  return toProductDto(row);
}

/** Soft-archive (DELETE handler). */
export async function archiveAdmissionProduct(
  actor: TicketingActor,
  productId: string
) {
  return updateAdmissionProduct(actor, productId, { archive: true });
}

export async function setProductExpiry(
  actor: TicketingActor,
  productId: string,
  defaultPassExpiryDays: number | null
) {
  return updateAdmissionProduct(actor, productId, { defaultPassExpiryDays });
}

export async function replaceProductPrices(
  actor: TicketingActor,
  productId: string,
  prices: PriceBandInput[]
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const product = await prisma.admissionProduct.findFirst({
    where: { id: requireId(productId, "productId"), orgId },
  });
  if (!product) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  if (product.archivedAt) {
    throw new Error("Archived products cannot be edited — unarchive first");
  }
  await assertLocationInHqScope(actor, product.locationId);
  await assertVenueActiveForTicketingMutate(orgId, product.locationId);
  if (!Array.isArray(prices) || prices.length === 0) {
    throw new Error("At least one price band is required");
  }
  validatePriceBands(prices);

  await prisma.$transaction([
    prisma.admissionProductPrice.deleteMany({ where: { productId: product.id } }),
    prisma.admissionProductPrice.createMany({
      data: prices.map((p) => ({
        orgId,
        locationId: product.locationId,
        productId: product.id,
        code: p.code.trim().toLowerCase(),
        amount: new Decimal(requirePositiveAmount(Number(p.amount))),
        currency: (p.currency || "USD").toUpperCase().slice(0, 3),
        minAge: p.minAge ?? null,
        maxAge: p.maxAge ?? null,
        validFrom: p.validFrom ? new Date(p.validFrom) : null,
        validTo: p.validTo ? new Date(p.validTo) : null,
      })),
    }),
  ]);

  return getAdmissionProduct(actor, product.id);
}

export async function listProductPrices(
  actor: TicketingActor,
  productId: string
) {
  const product = await getAdmissionProduct(actor, productId);
  return product.prices;
}

export async function linkProductAddOn(
  actor: TicketingActor,
  parentProductId: string,
  input: {
    addOnProductId: string;
    required?: boolean;
    maxQty?: number | null;
    stockPeriodId?: string | null;
  }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const parent = await prisma.admissionProduct.findFirst({
    where: { id: requireId(parentProductId, "productId"), orgId },
  });
  if (!parent) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  if (parent.archivedAt) {
    throw new Error("Archived products cannot be edited — unarchive first");
  }
  if (parent.type === "add_on") {
    throw new Error("Add-on products cannot be parents of other add-ons");
  }
  await assertLocationInHqScope(actor, parent.locationId);
  await assertVenueActiveForTicketingMutate(orgId, parent.locationId);
  if (input.addOnProductId === parent.id) {
    throw new Error("A product cannot link itself as an add-on");
  }
  const addOn = await prisma.admissionProduct.findFirst({
    where: {
      id: requireId(input.addOnProductId, "addOnProductId"),
      orgId,
      type: "add_on",
      archivedAt: null,
    },
  });
  if (!addOn) throw new ForbiddenError("Add-on product not found");
  if (addOn.locationId !== parent.locationId) {
    throw new Error("Add-on must belong to the same venue as the parent");
  }

  let maxQty: number | null | undefined = undefined;
  if (input.maxQty !== undefined) {
    if (input.maxQty == null) {
      maxQty = null;
    } else {
      const n = Number(input.maxQty);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("maxQty must be a positive integer or null");
      }
      maxQty = n;
    }
  }

  let stockPeriodId: string | null | undefined = undefined;
  if (input.stockPeriodId !== undefined) {
    if (input.stockPeriodId == null || input.stockPeriodId === "") {
      stockPeriodId = null;
    } else {
      const stock = await prisma.stockPeriod.findFirst({
        where: {
          id: requireId(input.stockPeriodId, "stockPeriodId"),
          orgId,
          locationId: parent.locationId,
        },
        select: { id: true },
      });
      if (!stock) throw new ForbiddenError("Stock period not found");
      stockPeriodId = stock.id;
    }
  }

  const required =
    input.required !== undefined ? Boolean(input.required) : undefined;

  const link = await prisma.$transaction(async (tx) => {
    const addOnFresh = await tx.admissionProduct.findFirst({
      where: {
        id: addOn.id,
        orgId,
        type: "add_on",
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!addOnFresh) throw new ForbiddenError("Add-on product not found");

    return tx.admissionAddOnLink.upsert({
      where: {
        parentProductId_addOnProductId: {
          parentProductId: parent.id,
          addOnProductId: addOn.id,
        },
      },
      create: {
        orgId,
        locationId: parent.locationId,
        parentProductId: parent.id,
        addOnProductId: addOn.id,
        required: required ?? false,
        maxQty: maxQty ?? null,
        stockPeriodId: stockPeriodId ?? null,
      },
      update: {
        ...(required !== undefined ? { required } : {}),
        ...(maxQty !== undefined ? { maxQty } : {}),
        ...(stockPeriodId !== undefined ? { stockPeriodId } : {}),
      },
    });
  });
  return link;
}

export async function unlinkProductAddOn(
  actor: TicketingActor,
  parentProductId: string,
  addOnProductId: string
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const parent = await prisma.admissionProduct.findFirst({
    where: { id: requireId(parentProductId, "productId"), orgId },
    select: { id: true, locationId: true, archivedAt: true },
  });
  if (!parent) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  if (parent.archivedAt) {
    throw new Error("Archived products cannot be edited — unarchive first");
  }
  await assertLocationInHqScope(actor, parent.locationId);
  await assertVenueActiveForTicketingMutate(orgId, parent.locationId);

  const result = await prisma.admissionAddOnLink.deleteMany({
    where: {
      orgId,
      parentProductId: parent.id,
      addOnProductId: requireId(addOnProductId, "addOnProductId"),
    },
  });
  if (!result.count) throw new ForbiddenError("Add-on link not found");
  return { parentProductId: parent.id, addOnProductId };
}

export async function listProductAddOns(
  actor: TicketingActor,
  productId: string
) {
  const product = await getAdmissionProduct(actor, productId);
  return product.addOnLinks ?? [];
}

export function parseCreateProductBody(body: unknown): CreateProductInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    type: requireProductType(b.type),
    name: requireName(b.name),
    description: typeof b.description === "string" ? b.description : null,
    images: Array.isArray(b.images) ? (b.images as string[]) : [],
    locationId: String(b.locationId ?? ""),
    resourceId: parseOptionalId(b.resourceId, "resourceId") ?? null,
    published: Boolean(b.published),
    waiverRequired: Boolean(b.waiverRequired),
    minGuests:
      b.minGuests == null || b.minGuests === ""
        ? null
        : Number(b.minGuests),
    maxGuests:
      b.maxGuests == null || b.maxGuests === ""
        ? null
        : Number(b.maxGuests),
    defaultPassExpiryDays:
      b.defaultPassExpiryDays == null || b.defaultPassExpiryDays === ""
        ? null
        : Number(b.defaultPassExpiryDays),
    taxExemptDefault: Boolean(b.taxExemptDefault),
    categoryId:
      b.categoryId === undefined
        ? undefined
        : b.categoryId == null || b.categoryId === ""
          ? null
          : String(b.categoryId),
    prices: Array.isArray(b.prices)
      ? (b.prices as PriceBandInput[])
      : undefined,
  };
}
