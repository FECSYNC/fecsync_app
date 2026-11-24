import connectDB, { withDbRetry } from "@/lib/db";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getStorefrontOrgId } from "@/lib/org";
import { isValidId } from "@/lib/ids";
import {
  catalogIdWhere,
  auditCreateToPrisma,
  auditUpdateToPrisma,
} from "@/lib/catalogWrite";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";
import {
  normalizeAdBannerInput,
  sortAdBanners,
  type AdBannerDto,
  type AdBannerInput,
} from "@/lib/adBanners.shared";

export * from "@/lib/adBanners.shared";

/** Demo banners so the Trending Fashion sidebar isn't empty on first visit. */
export const DEFAULT_AD_BANNERS: Array<{
  image: string;
  heading: string;
  paragraph: string;
  href: string;
  order: number;
  active: boolean;
}> = [
  {
    image: "/fast/h2.webp",
    heading: "New Season Prints",
    paragraph:
      "Explore vibrant Ankara and ready-to-wear looks crafted for every celebration.",
    href: "/shop",
    order: 0,
    active: true,
  },
  {
    image: "/fast/w1.webp",
    heading: "Custom Tailoring",
    paragraph:
      "Bring your fabric — we'll style, fit, and finish a look that's uniquely yours.",
    href: "/customize",
    order: 1,
    active: true,
  },
  {
    image: "/fast/w3.webp",
    heading: "Premium Fabrics",
    paragraph:
      "Shop exclusive Woodin and signature prints with free styling tips in-store.",
    href: "/fabrics",
    order: 2,
    active: true,
  },
];

function normalizeCreateAudit(
  audit?: AuditCreateStamp | Record<string, unknown>
) {
  if (!audit) return {};
  if ("createdBy" in audit && typeof audit.createdBy === "string") {
    return auditCreateToPrisma(audit as AuditCreateStamp);
  }
  return {
    createdById: (audit as Record<string, unknown>).createdById as string | undefined,
    createdByName: (audit as Record<string, unknown>).createdByName as string | undefined,
    updatedById: (audit as Record<string, unknown>).updatedById as string | undefined,
    updatedByName: (audit as Record<string, unknown>).updatedByName as string | undefined,
  };
}

function normalizeUpdateAudit(
  audit?: AuditUpdateStamp | Record<string, unknown>
) {
  if (!audit) return {};
  if ("updatedBy" in audit && typeof audit.updatedBy === "string") {
    return auditUpdateToPrisma(audit as AuditUpdateStamp);
  }
  return {
    updatedById: (audit as Record<string, unknown>).updatedById as string | undefined,
    updatedByName: (audit as Record<string, unknown>).updatedByName as string | undefined,
  };
}

function toDto(row: {
  id: string;
  image: string;
  heading: string;
  paragraph: string;
  href?: string | null;
  order: number;
  active: boolean;
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AdBannerDto {
  const href = row.href?.trim();
  return {
    _id: row.id,
    image: String(row.image ?? "").trim(),
    heading: String(row.heading ?? "").trim(),
    paragraph: String(row.paragraph ?? "").trim(),
    href: href || undefined,
    order:
      typeof row.order === "number" && Number.isFinite(row.order)
        ? row.order
        : 0,
    active: row.active !== false,
    createdByName:
      typeof row.createdByName === "string" ? row.createdByName : undefined,
    updatedByName:
      typeof row.updatedByName === "string" ? row.updatedByName : undefined,
    createdAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : undefined,
    updatedAt: row.updatedAt
      ? new Date(row.updatedAt).toISOString()
      : undefined,
  };
}

const BANNER_SELECT = {
  id: true,
  image: true,
  heading: true,
  paragraph: true,
  href: true,
  order: true,
  active: true,
  createdByName: true,
  updatedByName: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function fetchBannersForOrg(
  orgId: string,
  activeOnly: boolean
): Promise<AdBannerDto[]> {
  const rows = await prisma.adBanner.findMany({
    where: activeOnly ? { orgId, active: true } : { orgId },
    select: BANNER_SELECT,
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const mapped = rows.map((row) => toDto(row));
  return sortAdBanners(
    activeOnly ? mapped.filter((b) => Boolean(b.image)) : mapped
  );
}

/** Drop accidental duplicate seed rows; never rewrite content or active. */
async function dedupeSeedRaceDuplicates(orgId: string): Promise<void> {
  const seedHeadings = DEFAULT_AD_BANNERS.map((b) => b.heading);
  const rows = await prisma.adBanner.findMany({
    where: { orgId, heading: { in: seedHeadings } },
    select: { id: true, heading: true },
    orderBy: { id: "asc" },
  });

  const byHeading = new Map<string, string[]>();
  for (const row of rows) {
    const heading = String(row.heading ?? "");
    const list = byHeading.get(heading) ?? [];
    list.push(row.id);
    byHeading.set(heading, list);
  }

  const removeIds: string[] = [];
  for (const ids of byHeading.values()) {
    if (ids.length > 1) removeIds.push(...ids.slice(1));
  }
  if (removeIds.length > 0) {
    await prisma.adBanner.deleteMany({ where: { id: { in: removeIds } } });
  }
}

/**
 * Seed demo banners once per org when empty.
 * Uses a unique seed lock so delete-all does not resurrect demos,
 * and never overwrites admin edits / active toggles.
 */
export async function ensureDefaultAdBanners(orgId?: string): Promise<void> {
  await connectDB();
  const resolvedOrgId = orgId ?? (await getStorefrontOrgId());
  const count = await prisma.adBanner.count({ where: { orgId: resolvedOrgId } });

  if (count > 0) {
    void dedupeSeedRaceDuplicates(resolvedOrgId).catch((err) => {
      console.warn("Ad banner seed dedupe skipped:", err);
    });
    return;
  }

  try {
    await prisma.adBannerSeedLock.create({ data: { orgId: resolvedOrgId } });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return;
    }
    console.warn("Ad banner seed lock skipped:", err);
    return;
  }

  try {
    await prisma.adBanner.createMany({
      data: DEFAULT_AD_BANNERS.map((banner) => ({
        orgId: resolvedOrgId,
        ...banner,
      })),
    });
  } catch (err) {
    console.warn("Ad banners seed skipped:", err);
  }
}

/** Public storefront: active banners only, sorted. */
const PUBLIC_BANNERS_TTL_MS = 5 * 60 * 1000;
let publicBannersCache: { at: number; value: AdBannerDto[] } | null = null;

export async function getPublicAdBanners(): Promise<AdBannerDto[]> {
  if (
    publicBannersCache &&
    Date.now() - publicBannersCache.at < PUBLIC_BANNERS_TTL_MS
  ) {
    return publicBannersCache.value;
  }

  try {
    const value = await withDbRetry(async () => {
      const orgId = await getStorefrontOrgId();
      await ensureDefaultAdBanners(orgId);
      return fetchBannersForOrg(orgId, true);
    });
    publicBannersCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    if (publicBannersCache) {
      console.warn(
        "Public ad banners: serving stale cache after DB error",
        err
      );
      return publicBannersCache.value;
    }
    console.warn("Public ad banners: DB unavailable, returning empty list", err);
    return [];
  }
}

export function invalidatePublicAdBannersCache() {
  publicBannersCache = null;
}

/** Admin list: all banners for actor org. */
export async function listAdminAdBanners(orgId: string): Promise<AdBannerDto[]> {
  await connectDB();
  await ensureDefaultAdBanners(orgId);
  return fetchBannersForOrg(orgId, false);
}

export async function getAdminAdBanner(
  orgId: string,
  id: string
): Promise<AdBannerDto | null> {
  await connectDB();
  if (!isValidId(id)) return null;
  const row = await prisma.adBanner.findFirst({
    where: { orgId, ...catalogIdWhere(id) },
    select: BANNER_SELECT,
  });
  return row ? toDto(row) : null;
}

export async function createAdBanner(
  orgId: string,
  input: AdBannerInput,
  audit?: AuditCreateStamp | Record<string, unknown>
): Promise<AdBannerDto> {
  await connectDB();
  try {
    await prisma.adBannerSeedLock.create({ data: { orgId } });
  } catch {
    /* already locked */
  }

  const count = await prisma.adBanner.count({ where: { orgId } });
  const normalized = normalizeAdBannerInput(input, count);

  if (!normalized.image) {
    throw new Error("Banner image is required");
  }
  if (!normalized.heading) {
    throw new Error("Banner heading is required");
  }
  if (!normalized.paragraph) {
    throw new Error("Banner paragraph is required");
  }

  const auditFields = normalizeCreateAudit(audit);
  const created = await prisma.adBanner.create({
    data: {
      orgId,
      image: normalized.image,
      heading: normalized.heading,
      paragraph: normalized.paragraph,
      href: normalized.href || null,
      order: normalized.order,
      active: normalized.active,
      ...auditFields,
    },
    select: BANNER_SELECT,
  });

  invalidatePublicAdBannersCache();
  return toDto(created);
}

export async function updateAdBanner(
  orgId: string,
  id: string,
  input: AdBannerInput,
  audit?: AuditUpdateStamp | Record<string, unknown>
): Promise<AdBannerDto | null> {
  await connectDB();
  if (!isValidId(id)) return null;

  const existing = await prisma.adBanner.findFirst({
    where: { orgId, ...catalogIdWhere(id) },
  });
  if (!existing) return null;

  const clearHref = Object.prototype.hasOwnProperty.call(input, "href");
  const nextHref = clearHref
    ? input.href === null || input.href === undefined
      ? ""
      : String(input.href).trim()
    : existing.href ?? "";

  const normalized = normalizeAdBannerInput(
    {
      image: input.image ?? existing.image,
      heading: input.heading ?? existing.heading,
      paragraph: input.paragraph ?? existing.paragraph,
      href: nextHref,
      order: input.order ?? existing.order,
      active: input.active !== undefined ? input.active : existing.active,
    },
    existing.order
  );

  if (!normalized.image) throw new Error("Banner image is required");
  if (!normalized.heading) throw new Error("Banner heading is required");
  if (!normalized.paragraph) throw new Error("Banner paragraph is required");

  const auditFields = normalizeUpdateAudit(audit);
  const updated = await prisma.adBanner.update({
    where: { id: existing.id },
    data: {
      image: normalized.image,
      heading: normalized.heading,
      paragraph: normalized.paragraph,
      order: normalized.order,
      active: normalized.active,
      href: clearHref ? normalized.href || null : undefined,
      ...auditFields,
    },
    select: BANNER_SELECT,
  });

  invalidatePublicAdBannersCache();
  return toDto(updated);
}

export async function deleteAdBanner(
  orgId: string,
  id: string
): Promise<boolean> {
  await connectDB();
  if (!isValidId(id)) return false;
  try {
    await prisma.adBannerSeedLock.create({ data: { orgId } });
  } catch {
    /* already locked */
  }
  const existing = await prisma.adBanner.findFirst({
    where: { orgId, ...catalogIdWhere(id) },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.adBanner.delete({ where: { id: existing.id } });
  invalidatePublicAdBannersCache();
  return true;
}
