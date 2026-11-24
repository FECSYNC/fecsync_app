/**
 * Create, patch, and deactivate PublicCategoryPage rows in the same
 * transaction as the category they point at.
 */
import type { Prisma, PrismaClient, PublicCategoryLayout } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  allocateCategorySlug,
  assertEditableCategorySlug,
} from "@/lib/publicCategory/slug";
import {
  toPublicCategoryPageDto,
  type PublicCategoryLayout as LayoutDto,
  type PublicCategoryPageDto,
} from "@/lib/publicCategory/snippet";

type Db = Prisma.TransactionClient | PrismaClient;

export type PublicCategoryKindName = "booking" | "menu" | "membership";

export type PublicPageRef = {
  orgId: string;
  kind: PublicCategoryKindName;
  name: string;
  bookingCategoryId?: string;
  membershipCategoryId?: string;
  productCategoryId?: string;
  /** Archived categories backfilled on read stay inactive. */
  active?: boolean;
};

export type PublicPageSettingsPatch = {
  slug?: string;
  layout?: LayoutDto;
  embedEnabled?: boolean;
};

const LAYOUTS = new Set<LayoutDto>(["auto", "grid", "stack"]);

function refWhere(ref: PublicPageRef): Prisma.PublicCategoryPageWhereInput {
  return {
    orgId: ref.orgId,
    ...(ref.bookingCategoryId
      ? { bookingCategoryId: ref.bookingCategoryId }
      : {}),
    ...(ref.membershipCategoryId
      ? { membershipCategoryId: ref.membershipCategoryId }
      : {}),
    ...(ref.productCategoryId
      ? { productCategoryId: ref.productCategoryId }
      : {}),
  };
}

export async function orgSkipsPublicCategoryPage(
  db: Db,
  orgId: string
): Promise<boolean> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { isDefault: true },
  });
  return !org || org.isDefault;
}

function uniqueFieldTargets(err: unknown): string[] {
  if (!err || typeof err !== "object" || !("code" in err)) return [];
  if ((err as { code?: string }).code !== "P2002") return [];
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map((item) => String(item));
  if (typeof target === "string") return [target];
  return [];
}

/** orgId+slug collision. Distinct from a category name unique violation. */
export function isPublicSlugConflict(err: unknown): boolean {
  return uniqueFieldTargets(err).some(
    (target) => target === "slug" || /(?:^|_)slug(?:_|$)/i.test(target)
  );
}

export function isPublicPageCategoryConflict(err: unknown): boolean {
  return uniqueFieldTargets(err).some((target) =>
    /bookingCategoryId|membershipCategoryId|productCategoryId/i.test(target)
  );
}

const PUBLIC_PAGE_CLIENT_ERRORS = new Set([
  "Public link is required",
  "That public link is reserved",
  "That public link is already used in this company",
  "Public link must use lowercase letters, numbers, and hyphens",
  "layout must be auto, grid, or stack",
  "embedEnabled must be a boolean",
  "The storefront does not have a public category page",
  "Could not allocate a public link for this category",
]);

/** Staff-facing public-link failures. Null when the error belongs to the category row. */
export function publicPageClientErrorMessage(err: unknown): string | null {
  if (isPublicSlugConflict(err)) {
    return "That public link is already used in this company";
  }
  if (err instanceof Error && PUBLIC_PAGE_CLIENT_ERRORS.has(err.message)) {
    return err.message;
  }
  return null;
}

/**
 * Retry a write whose transaction rolled back because two catalogs allocated
 * the same slug. A failed statement aborts the Postgres transaction, so the
 * retry must start a new transaction.
 */
export async function retryOnPublicSlugConflict<T>(
  fn: () => Promise<T>
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isPublicSlugConflict(err) || attempt === 2) throw err;
    }
  }
  throw last;
}

async function takenSlugs(db: Db, orgId: string): Promise<string[]> {
  const rows = await db.publicCategoryPage.findMany({
    where: { orgId },
    select: { slug: true },
  });
  return rows.map((row) => row.slug);
}

export async function insertPublicCategoryPage(
  db: Db,
  ref: PublicPageRef
): Promise<void> {
  if (await orgSkipsPublicCategoryPage(db, ref.orgId)) return;
  const slug = allocateCategorySlug(ref.name, await takenSlugs(db, ref.orgId));
  await db.publicCategoryPage.create({
    data: {
      orgId: ref.orgId,
      kind: ref.kind,
      slug,
      layout: "auto",
      embedEnabled: true,
      active: ref.active ?? true,
      bookingCategoryId: ref.bookingCategoryId ?? null,
      membershipCategoryId: ref.membershipCategoryId ?? null,
      productCategoryId: ref.productCategoryId ?? null,
    },
  });
}

export async function deactivatePublicCategoryPage(
  db: Db,
  ref: Pick<
    PublicPageRef,
    | "orgId"
    | "bookingCategoryId"
    | "membershipCategoryId"
    | "productCategoryId"
  >
): Promise<void> {
  if (
    !ref.bookingCategoryId &&
    !ref.membershipCategoryId &&
    !ref.productCategoryId
  ) {
    throw new Error("Public page category is required");
  }
  await db.publicCategoryPage.updateMany({
    where: refWhere({ ...ref, kind: "booking", name: "" }),
    data: { active: false },
  });
}

/** Restore keeps the original slug. A missing page is created once. */
export async function reactivateOrCreatePublicCategoryPage(
  db: Db,
  ref: PublicPageRef
): Promise<void> {
  if (await orgSkipsPublicCategoryPage(db, ref.orgId)) return;
  const existing = await db.publicCategoryPage.findFirst({
    where: refWhere(ref),
    select: { id: true, active: true },
  });
  if (!existing) {
    await insertPublicCategoryPage(db, ref);
    return;
  }
  if (!existing.active) {
    await db.publicCategoryPage.update({
      where: { id: existing.id },
      data: { active: true },
    });
  }
}

export function parsePublicPageSettingsPatch(
  body: Record<string, unknown>,
  opts?: { slugKey?: "slug" | "publicSlug" }
): PublicPageSettingsPatch | null {
  const slugKey = opts?.slugKey ?? "slug";
  const patch: PublicPageSettingsPatch = {};
  if (slugKey in body) {
    const raw = body[slugKey];
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error("Public link is required");
    }
    patch.slug = assertEditableCategorySlug(raw);
  }
  if ("layout" in body) {
    const layout = body.layout;
    if (typeof layout !== "string" || !LAYOUTS.has(layout as LayoutDto)) {
      throw new Error("layout must be auto, grid, or stack");
    }
    patch.layout = layout as LayoutDto;
  }
  if ("embedEnabled" in body) {
    if (typeof body.embedEnabled !== "boolean") {
      throw new Error("embedEnabled must be a boolean");
    }
    patch.embedEnabled = body.embedEnabled;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function applyPublicPagePatch(
  db: Db,
  ref: PublicPageRef,
  patch: PublicPageSettingsPatch
): Promise<void> {
  if (await orgSkipsPublicCategoryPage(db, ref.orgId)) {
    throw new Error("The storefront does not have a public category page");
  }
  const existing = await db.publicCategoryPage.findFirst({
    where: refWhere(ref),
  });
  if (!existing) {
    const slug = patch.slug
      ? patch.slug
      : allocateCategorySlug(ref.name, await takenSlugs(db, ref.orgId));
    if (patch.slug) {
      const clash = await db.publicCategoryPage.findFirst({
        where: { orgId: ref.orgId, slug },
        select: { id: true },
      });
      if (clash) {
        throw new Error("That public link is already used in this company");
      }
    }
    await db.publicCategoryPage.create({
      data: {
        orgId: ref.orgId,
        kind: ref.kind,
        slug,
        layout: (patch.layout ?? "auto") as PublicCategoryLayout,
        embedEnabled: patch.embedEnabled ?? true,
        active: ref.active ?? true,
        bookingCategoryId: ref.bookingCategoryId ?? null,
        membershipCategoryId: ref.membershipCategoryId ?? null,
        productCategoryId: ref.productCategoryId ?? null,
      },
    });
    return;
  }

  const data: Prisma.PublicCategoryPageUpdateInput = {};
  if (patch.slug && patch.slug !== existing.slug) {
    const clash = await db.publicCategoryPage.findFirst({
      where: {
        orgId: ref.orgId,
        slug: patch.slug,
        NOT: { id: existing.id },
      },
      select: { id: true },
    });
    if (clash) {
      throw new Error("That public link is already used in this company");
    }
    data.slug = patch.slug;
  }
  if (patch.layout) data.layout = patch.layout;
  if (patch.embedEnabled !== undefined) data.embedEnabled = patch.embedEnabled;
  if (Object.keys(data).length === 0) return;
  await db.publicCategoryPage.update({
    where: { id: existing.id },
    data,
  });
}

function isMissingCategoryFk(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "P2003"
  );
}

/**
 * Lock the category row so archive or delete cannot pass between the
 * archive-state read and the page insert. Null means the category is gone.
 */
async function lockCategoryPageActive(
  tx: Prisma.TransactionClient,
  orgId: string,
  kind: PublicCategoryKindName,
  categoryId: string
): Promise<boolean | null> {
  if (kind === "booking") {
    const rows = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
      SELECT "archivedAt" FROM booking_categories
      WHERE id = ${categoryId} AND "orgId" = ${orgId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return null;
    return row.archivedAt == null;
  }
  if (kind === "membership") {
    const rows = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
      SELECT "archivedAt" FROM membership_categories
      WHERE id = ${categoryId} AND "orgId" = ${orgId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return null;
    return row.archivedAt == null;
  }
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM product_categories
    WHERE id = ${categoryId} AND "orgId" = ${orgId}
    FOR UPDATE
  `;
  return rows[0] ? true : null;
}

/**
 * Categories created before public pages existed get a stable slug on the
 * next staff read. The storefront org is skipped. Idempotent.
 */
export async function ensureMissingPublicCategoryPages(
  orgId: string,
  kind: PublicCategoryKindName,
  rows: Array<{ id: string; name: string; archived?: boolean }>
): Promise<void> {
  if (rows.length === 0) return;
  if (await orgSkipsPublicCategoryPage(prisma, orgId)) return;
  const fk =
    kind === "booking"
      ? "bookingCategoryId"
      : kind === "membership"
        ? "membershipCategoryId"
        : "productCategoryId";
  const existing = await prisma.publicCategoryPage.findMany({
    where: {
      orgId,
      [fk]: { in: rows.map((row) => row.id) },
    } as Prisma.PublicCategoryPageWhereInput,
    select: {
      bookingCategoryId: true,
      membershipCategoryId: true,
      productCategoryId: true,
    },
  });
  const have = new Set(
    existing
      .map((row) => row.bookingCategoryId || row.membershipCategoryId || row.productCategoryId)
      .filter((id): id is string => Boolean(id))
  );
  for (const row of rows) {
    if (have.has(row.id)) continue;
    try {
      const created = await retryOnPublicSlugConflict(() =>
        prisma.$transaction(async (tx) => {
          const active = await lockCategoryPageActive(tx, orgId, kind, row.id);
          if (active == null) return false;
          await insertPublicCategoryPage(tx, {
            orgId,
            kind,
            name: row.name,
            active,
            bookingCategoryId: kind === "booking" ? row.id : undefined,
            membershipCategoryId: kind === "membership" ? row.id : undefined,
            productCategoryId: kind === "menu" ? row.id : undefined,
          });
          return true;
        })
      );
      if (created) have.add(row.id);
    } catch (err) {
      if (
        isPublicSlugConflict(err) ||
        isPublicPageCategoryConflict(err) ||
        isMissingCategoryFk(err)
      ) {
        continue;
      }
      throw err;
    }
  }
}

export async function publicPageDtosForProductCategories(
  orgId: string,
  categoryIds: string[]
): Promise<Map<string, PublicCategoryPageDto>> {
  const map = new Map<string, PublicCategoryPageDto>();
  if (categoryIds.length === 0) return map;
  const [pages, orgSlug] = await Promise.all([
    prisma.publicCategoryPage.findMany({
      where: { orgId, productCategoryId: { in: categoryIds } },
    }),
    loadOrgSlug(orgId),
  ]);
  for (const page of pages) {
    if (!page.productCategoryId) continue;
    const dto = pageDto(page, orgSlug);
    if (dto) map.set(page.productCategoryId, dto);
  }
  return map;
}

export async function loadOrgSlug(orgId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { slug: true },
  });
  return org?.slug?.trim() || orgId;
}

export function pageDto(
  page: {
    slug: string;
    layout: PublicCategoryLayout | LayoutDto;
    embedEnabled: boolean;
    active: boolean;
  } | null
  | undefined,
  orgSlug: string
): PublicCategoryPageDto | null {
  if (!page) return null;
  const layout: LayoutDto =
    page.layout === "grid" || page.layout === "stack" ? page.layout : "auto";
  return toPublicCategoryPageDto({
    slug: page.slug,
    layout,
    embedEnabled: page.embedEnabled,
    active: page.active,
    orgSlug,
  });
}
