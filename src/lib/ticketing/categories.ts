/**
 * Online Booking categories (org-scoped folders for AdmissionProduct).
 * Distinct from shop ProductCategory and MembershipCategory.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  type TicketingActor,
} from "@/lib/ticketing/common";
import {
  applyPublicPagePatch,
  deactivatePublicCategoryPage,
  ensureMissingPublicCategoryPages,
  insertPublicCategoryPage,
  isPublicSlugConflict,
  loadOrgSlug,
  pageDto,
  parsePublicPageSettingsPatch,
  reactivateOrCreatePublicCategoryPage,
  retryOnPublicSlugConflict,
  type PublicPageSettingsPatch,
} from "@/lib/publicCategory/pages";
import type { PublicCategoryPageDto } from "@/lib/publicCategory/snippet";

export type BookingCategoryDto = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
  publicPage: PublicCategoryPageDto | null;
};

function toDto(
  row: {
    id: string;
    orgId: string;
    name: string;
    description: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count?: { admissionProducts: number };
    publicPage?: {
      slug: string;
      layout: "auto" | "grid" | "stack";
      embedEnabled: boolean;
      active: boolean;
    } | null;
  },
  orgSlug: string
): BookingCategoryDto {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    productCount: row._count?.admissionProducts ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publicPage: pageDto(row.publicPage, orgSlug),
  };
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

function mapCategoryWriteError(err: unknown): never {
  if (isPublicSlugConflict(err)) {
    throw new Error("That public link is already used in this company");
  }
  if (isPrismaUniqueViolation(err)) {
    throw new Error("A booking category with this name already exists");
  }
  throw err;
}

/** Case-insensitive name clash against any other row in the org. */
async function findNameClash(
  orgId: string,
  name: string,
  excludeId?: string
) {
  return prisma.bookingCategory.findFirst({
    where: {
      orgId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
}

const activeProductCount = {
  admissionProducts: {
    where: { archivedAt: null },
  },
} as const;

const categoryInclude = {
  _count: { select: activeProductCount },
  publicPage: true,
} as const;

export async function listBookingCategories(
  actor: TicketingActor,
  opts?: { includeArchived?: boolean }
): Promise<BookingCategoryDto[]> {
  const orgId = await assertTicketingStaffRead(actor);
  const where: Prisma.BookingCategoryWhereInput = { orgId };
  if (!opts?.includeArchived) where.archivedAt = null;

  let rows = await prisma.bookingCategory.findMany({
    where,
    include: categoryInclude,
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  const missing = rows.filter((row) => !row.publicPage);
  if (missing.length > 0) {
    await ensureMissingPublicCategoryPages(
      orgId,
      "booking",
      missing.map((row) => ({
        id: row.id,
        name: row.name,
        archived: Boolean(row.archivedAt),
      }))
    );
    rows = await prisma.bookingCategory.findMany({
      where,
      include: categoryInclude,
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    });
  }
  const orgSlug = await loadOrgSlug(orgId);
  return rows.map((row) => toDto(row, orgSlug));
}

export async function getBookingCategory(
  actor: TicketingActor,
  categoryId: string
): Promise<BookingCategoryDto> {
  const orgId = await assertTicketingStaffRead(actor);
  const id = requireId(categoryId, "categoryId");
  let row = await prisma.bookingCategory.findFirst({
    where: { id, orgId },
    include: categoryInclude,
  });
  if (!row) throw new ForbiddenError("Booking category not found");
  if (!row.publicPage) {
    await ensureMissingPublicCategoryPages(orgId, "booking", [
      { id: row.id, name: row.name, archived: Boolean(row.archivedAt) },
    ]);
    row = await prisma.bookingCategory.findFirst({
      where: { id, orgId },
      include: categoryInclude,
    });
    if (!row) throw new ForbiddenError("Booking category not found");
  }
  const orgSlug = await loadOrgSlug(orgId);
  return toDto(row, orgSlug);
}

export async function createBookingCategory(
  actor: TicketingActor,
  body: unknown
): Promise<BookingCategoryDto> {
  const orgId = await assertTicketingStaffMutate(actor);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  delete b.orgId;
  delete b.organizationId;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("name is required");
  if (name.length > 80) throw new Error("name is too long (max 80)");
  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim().slice(0, 500)
      : null;

  const existing = await findNameClash(orgId, name);
  if (existing && !existing.archivedAt) {
    throw new Error("A booking category with this name already exists");
  }
  if (existing?.archivedAt) {
    try {
      const orgSlug = await loadOrgSlug(orgId);
      const row = await retryOnPublicSlugConflict(() =>
        prisma.$transaction(async (tx) => {
        await tx.bookingCategory.update({
          where: { id: existing.id },
          data: { archivedAt: null, description, name },
        });
        await reactivateOrCreatePublicCategoryPage(tx, {
          orgId,
          kind: "booking",
          name,
          bookingCategoryId: existing.id,
        });
        return tx.bookingCategory.findFirstOrThrow({
          where: { id: existing.id },
          include: categoryInclude,
        });
        })
      );
      logStaffActivityEntry(actor, {
        action: "booking_category.restore",
        entityType: "Category",
        entityId: row.id,
        description: `Restored booking category “${row.name}”`,
      });
      return toDto(row, orgSlug);
    } catch (err) {
      mapCategoryWriteError(err);
    }
  }

  try {
    const orgSlug = await loadOrgSlug(orgId);
    const row = await retryOnPublicSlugConflict(() =>
      prisma.$transaction(async (tx) => {
      const created = await tx.bookingCategory.create({
        data: { orgId, name, description },
      });
      await insertPublicCategoryPage(tx, {
        orgId,
        kind: "booking",
        name,
        bookingCategoryId: created.id,
      });
      return tx.bookingCategory.findFirstOrThrow({
        where: { id: created.id },
        include: categoryInclude,
      });
      })
    );
    logStaffActivityEntry(actor, {
      action: "booking_category.create",
      entityType: "Category",
      entityId: row.id,
      description: `Created booking category “${row.name}”`,
    });
    return toDto(row, orgSlug);
  } catch (err) {
    mapCategoryWriteError(err);
  }
}

export async function updateBookingCategory(
  actor: TicketingActor,
  categoryId: string,
  body: unknown
): Promise<BookingCategoryDto> {
  const orgId = await assertTicketingStaffMutate(actor);
  const id = requireId(categoryId, "categoryId");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  delete b.orgId;
  delete b.organizationId;
  const existing = await prisma.bookingCategory.findFirst({
    where: { id, orgId },
  });
  if (!existing) throw new ForbiddenError("Booking category not found");
  if (existing.archivedAt) {
    throw new Error("Archived categories cannot be edited — recreate or restore");
  }

  const data: Prisma.BookingCategoryUpdateInput = {};
  let publicPatch: PublicPageSettingsPatch | null = null;
  try {
    publicPatch = parsePublicPageSettingsPatch(b, { slugKey: "slug" });
  } catch (err) {
    if (err instanceof Error) throw err;
    throw err;
  }
  if ("name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) throw new Error("name is required");
    if (name.length > 80) throw new Error("name is too long (max 80)");
    const clash = await findNameClash(orgId, name, id);
    if (clash) {
      throw new Error("A booking category with this name already exists");
    }
    data.name = name;
  }
  if ("description" in b) {
    data.description =
      typeof b.description === "string" && b.description.trim()
        ? b.description.trim().slice(0, 500)
        : null;
  }

  if (
    !("name" in b) &&
    !("description" in b) &&
    !publicPatch
  ) {
    throw new Error("No category changes");
  }

  try {
    const orgSlug = await loadOrgSlug(orgId);
    const row = await retryOnPublicSlugConflict(() =>
      prisma.$transaction(async (tx) => {
      if ("name" in data || "description" in data) {
        await tx.bookingCategory.update({ where: { id }, data });
      }
      if (publicPatch) {
        await applyPublicPagePatch(
          tx,
          {
            orgId,
            kind: "booking",
            name: typeof data.name === "string" ? data.name : existing.name,
            bookingCategoryId: id,
          },
          publicPatch
        );
      }
      return tx.bookingCategory.findFirstOrThrow({
        where: { id },
        include: categoryInclude,
      });
      })
    );
    logStaffActivityEntry(actor, {
      action: "booking_category.update",
      entityType: "Category",
      entityId: row.id,
      description: `Updated booking category “${row.name}”`,
    });
    return toDto(row, orgSlug);
  } catch (err) {
    mapCategoryWriteError(err);
  }
}

export async function archiveBookingCategory(
  actor: TicketingActor,
  categoryId: string
): Promise<BookingCategoryDto> {
  const orgId = await assertTicketingStaffMutate(actor);
  const id = requireId(categoryId, "categoryId");
  const existing = await prisma.bookingCategory.findFirst({
    where: { id, orgId },
    include: categoryInclude,
  });
  if (!existing) throw new ForbiddenError("Booking category not found");
  const orgSlug = await loadOrgSlug(orgId);
  if (existing.archivedAt) {
    await deactivatePublicCategoryPage(prisma, {
      orgId,
      bookingCategoryId: id,
    });
    const row = await prisma.bookingCategory.findFirstOrThrow({
      where: { id },
      include: categoryInclude,
    });
    return toDto(row, orgSlug);
  }

  const productsLinked = existing._count.admissionProducts;

  // Archive first so resolveBookingCategoryId rejects concurrent product connects,
  // then unlink products so they stay sellable without a dead folder reference.
  const row = await prisma.$transaction(async (tx) => {
    await tx.bookingCategory.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    await deactivatePublicCategoryPage(tx, {
      orgId,
      bookingCategoryId: id,
    });
    await tx.admissionProduct.updateMany({
      where: { orgId, categoryId: id },
      data: { categoryId: null },
    });
    return tx.bookingCategory.findFirstOrThrow({
      where: { id },
      include: categoryInclude,
    });
  });

  logStaffActivityEntry(actor, {
    action: "booking_category.archive",
    entityType: "Category",
    entityId: row.id,
    description: `Archived booking category “${row.name}”`,
    metadata: { productsUnlinked: productsLinked },
  });
  return toDto(row, orgSlug);
}

/** Validate categoryId belongs to org and is active (or null). */
export async function resolveBookingCategoryId(
  orgId: string,
  categoryId: unknown
): Promise<string | null> {
  if (categoryId == null || categoryId === "") return null;
  if (typeof categoryId !== "string" || !isValidId(categoryId)) {
    throw new Error("categoryId is invalid");
  }
  const row = await prisma.bookingCategory.findFirst({
    where: { id: categoryId, orgId, archivedAt: null },
    select: { id: true },
  });
  if (!row) throw new Error("Booking category not found or archived");
  return row.id;
}
