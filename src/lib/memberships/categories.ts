/**
 * Membership catalog categories (org-scoped folders for MembershipPlan).
 * Distinct from shop ProductCategory.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  type MembershipsActor,
} from "@/lib/memberships/common";
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

export type MembershipCategoryDto = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  planCount: number;
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
    _count?: { plans: number };
    publicPage?: {
      slug: string;
      layout: "auto" | "grid" | "stack";
      embedEnabled: boolean;
      active: boolean;
    } | null;
  },
  orgSlug: string
): MembershipCategoryDto {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    planCount: row._count?.plans ?? 0,
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
    throw new Error("A membership category with this name already exists");
  }
  throw err;
}

const categoryInclude = {
  _count: { select: { plans: true } },
  publicPage: true,
} as const;

/** Case-insensitive name clash against any other row in the org. */
async function findNameClash(
  orgId: string,
  name: string,
  excludeId?: string
) {
  return prisma.membershipCategory.findFirst({
    where: {
      orgId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
}

export async function listMembershipCategories(
  actor: MembershipsActor,
  opts?: { includeArchived?: boolean }
): Promise<MembershipCategoryDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const where: Prisma.MembershipCategoryWhereInput = { orgId };
  if (!opts?.includeArchived) where.archivedAt = null;

  let rows = await prisma.membershipCategory.findMany({
    where,
    include: categoryInclude,
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  const missing = rows.filter((row) => !row.publicPage);
  if (missing.length > 0) {
    await ensureMissingPublicCategoryPages(
      orgId,
      "membership",
      missing.map((row) => ({
        id: row.id,
        name: row.name,
        archived: Boolean(row.archivedAt),
      }))
    );
    rows = await prisma.membershipCategory.findMany({
      where,
      include: categoryInclude,
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    });
  }
  const orgSlug = await loadOrgSlug(orgId);
  return rows.map((row) => toDto(row, orgSlug));
}

export async function getMembershipCategory(
  actor: MembershipsActor,
  categoryId: string
): Promise<MembershipCategoryDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(categoryId, "categoryId");
  let row = await prisma.membershipCategory.findFirst({
    where: { id, orgId },
    include: categoryInclude,
  });
  if (!row) throw new ForbiddenError("Membership category not found");
  if (!row.publicPage) {
    await ensureMissingPublicCategoryPages(orgId, "membership", [
      { id: row.id, name: row.name, archived: Boolean(row.archivedAt) },
    ]);
    row = await prisma.membershipCategory.findFirst({
      where: { id, orgId },
      include: categoryInclude,
    });
    if (!row) throw new ForbiddenError("Membership category not found");
  }
  const orgSlug = await loadOrgSlug(orgId);
  return toDto(row, orgSlug);
}

export async function createMembershipCategory(
  actor: MembershipsActor,
  body: unknown
): Promise<MembershipCategoryDto> {
  const orgId = await assertMembershipsStaff(actor);
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
    throw new Error("A membership category with this name already exists");
  }
  if (existing?.archivedAt) {
    try {
      const orgSlug = await loadOrgSlug(orgId);
      const row = await retryOnPublicSlugConflict(() =>
        prisma.$transaction(async (tx) => {
        await tx.membershipCategory.update({
          where: { id: existing.id },
          data: { archivedAt: null, description, name },
        });
        await reactivateOrCreatePublicCategoryPage(tx, {
          orgId,
          kind: "membership",
          name,
          membershipCategoryId: existing.id,
        });
        return tx.membershipCategory.findFirstOrThrow({
          where: { id: existing.id },
          include: categoryInclude,
        });
        })
      );
      logStaffActivityEntry(actor, {
        action: "membership_category.restore",
        entityType: "Category",
        entityId: row.id,
        description: `Restored membership category “${row.name}”`,
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
      const created = await tx.membershipCategory.create({
        data: { orgId, name, description },
      });
      await insertPublicCategoryPage(tx, {
        orgId,
        kind: "membership",
        name,
        membershipCategoryId: created.id,
      });
      return tx.membershipCategory.findFirstOrThrow({
        where: { id: created.id },
        include: categoryInclude,
      });
      })
    );
    logStaffActivityEntry(actor, {
      action: "membership_category.create",
      entityType: "Category",
      entityId: row.id,
      description: `Created membership category “${row.name}”`,
    });
    return toDto(row, orgSlug);
  } catch (err) {
    mapCategoryWriteError(err);
  }
}

export async function updateMembershipCategory(
  actor: MembershipsActor,
  categoryId: string,
  body: unknown
): Promise<MembershipCategoryDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(categoryId, "categoryId");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  delete b.orgId;
  delete b.organizationId;
  const existing = await prisma.membershipCategory.findFirst({
    where: { id, orgId },
  });
  if (!existing) throw new ForbiddenError("Membership category not found");
  if (existing.archivedAt) {
    throw new Error("Archived categories cannot be edited — recreate or restore");
  }

  const data: Prisma.MembershipCategoryUpdateInput = {};
  const publicPatch: PublicPageSettingsPatch | null =
    parsePublicPageSettingsPatch(b, { slugKey: "slug" });
  if ("name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) throw new Error("name is required");
    if (name.length > 80) throw new Error("name is too long (max 80)");
    const clash = await findNameClash(orgId, name, id);
    if (clash) {
      throw new Error("A membership category with this name already exists");
    }
    data.name = name;
  }
  if ("description" in b) {
    data.description =
      typeof b.description === "string" && b.description.trim()
        ? b.description.trim().slice(0, 500)
        : null;
  }

  if (!("name" in b) && !("description" in b) && !publicPatch) {
    throw new Error("No category changes");
  }

  try {
    const orgSlug = await loadOrgSlug(orgId);
    const row = await retryOnPublicSlugConflict(() =>
      prisma.$transaction(async (tx) => {
      if ("name" in data || "description" in data) {
        await tx.membershipCategory.update({ where: { id }, data });
      }
      if (publicPatch) {
        await applyPublicPagePatch(
          tx,
          {
            orgId,
            kind: "membership",
            name: typeof data.name === "string" ? data.name : existing.name,
            membershipCategoryId: id,
          },
          publicPatch
        );
      }
      return tx.membershipCategory.findFirstOrThrow({
        where: { id },
        include: categoryInclude,
      });
      })
    );
    logStaffActivityEntry(actor, {
      action: "membership_category.update",
      entityType: "Category",
      entityId: row.id,
      description: `Updated membership category “${row.name}”`,
    });
    return toDto(row, orgSlug);
  } catch (err) {
    mapCategoryWriteError(err);
  }
}

export async function archiveMembershipCategory(
  actor: MembershipsActor,
  categoryId: string
): Promise<MembershipCategoryDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(categoryId, "categoryId");
  const existing = await prisma.membershipCategory.findFirst({
    where: { id, orgId },
    include: categoryInclude,
  });
  if (!existing) throw new ForbiddenError("Membership category not found");
  const orgSlug = await loadOrgSlug(orgId);
  if (existing.archivedAt) {
    await deactivatePublicCategoryPage(prisma, {
      orgId,
      membershipCategoryId: id,
    });
    const row = await prisma.membershipCategory.findFirstOrThrow({
      where: { id },
      include: categoryInclude,
    });
    return toDto(row, orgSlug);
  }

  const plansLinked = existing._count.plans;

  // Archive first so resolveMembershipCategoryId rejects concurrent plan connects,
  // then unlink plans so they stay sellable without a dead folder reference.
  const row = await prisma.$transaction(async (tx) => {
    await tx.membershipCategory.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    await deactivatePublicCategoryPage(tx, {
      orgId,
      membershipCategoryId: id,
    });
    await tx.membershipPlan.updateMany({
      where: { orgId, categoryId: id },
      data: { categoryId: null },
    });
    return tx.membershipCategory.findFirstOrThrow({
      where: { id },
      include: categoryInclude,
    });
  });

  logStaffActivityEntry(actor, {
    action: "membership_category.archive",
    entityType: "Category",
    entityId: row.id,
    description: `Archived membership category “${row.name}”`,
    metadata: { plansUnlinked: plansLinked },
  });
  return toDto(row, orgSlug);
}

/** Validate categoryId belongs to org and is active (or null). */
export async function resolveMembershipCategoryId(
  orgId: string,
  categoryId: unknown
): Promise<string | null> {
  if (categoryId == null || categoryId === "") return null;
  if (typeof categoryId !== "string" || !isValidId(categoryId)) {
    throw new Error("categoryId is invalid");
  }
  const row = await prisma.membershipCategory.findFirst({
    where: { id: categoryId, orgId, archivedAt: null },
    select: { id: true },
  });
  if (!row) throw new Error("Membership category not found or archived");
  return row.id;
}
