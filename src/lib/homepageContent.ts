import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getStorefrontOrgId } from "@/lib/org";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  HOMEPAGE_SECTION_KEYS,
  SECTION_LABELS,
  isHomepageSectionKey,
  normalizeSectionContent,
  type HomepageSectionDto,
  type HomepageSectionKey,
} from "@/lib/homepageContent.shared";

export * from "@/lib/homepageContent.shared";

function toDto(doc: {
  id: string;
  key: HomepageSectionKey;
  label: string;
  published: boolean;
  content: unknown;
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): HomepageSectionDto {
  const key = doc.key;
  return {
    _id: doc.id,
    key,
    label: doc.label?.trim() || SECTION_LABELS[key],
    published: doc.published !== false,
    content: normalizeSectionContent(key, doc.content),
    createdByName:
      typeof doc.createdByName === "string" && doc.createdByName.trim()
        ? doc.createdByName.trim()
        : undefined,
    updatedByName:
      typeof doc.updatedByName === "string" && doc.updatedByName.trim()
        ? doc.updatedByName.trim()
        : undefined,
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
  };
}

export async function ensureHomepageSections(
  orgId?: string
): Promise<HomepageSectionDto[]> {
  await connectDB();
  const resolvedOrgId = orgId ?? (await getStorefrontOrgId());

  const existing = await prisma.homepageSection.findMany({
    where: { orgId: resolvedOrgId },
  });
  const byKey = new Map(
    existing.map((row) => [row.key as HomepageSectionKey, row])
  );

  const result: HomepageSectionDto[] = [];

  for (const key of HOMEPAGE_SECTION_KEYS) {
    let doc = byKey.get(key);
    if (!doc) {
      try {
        doc = await prisma.homepageSection.create({
          data: {
            orgId: resolvedOrgId,
            key,
            label: SECTION_LABELS[key],
            published: true,
            content: DEFAULT_HOMEPAGE_CONTENT[key] as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          doc =
            (await prisma.homepageSection.findFirst({
              where: { orgId: resolvedOrgId, key },
            })) ?? undefined;
          if (!doc) throw err;
        } else {
          throw err;
        }
      }
    }
    result.push(toDto(doc));
  }

  return result;
}

export async function getHomepageSection(
  key: HomepageSectionKey,
  orgId?: string
): Promise<HomepageSectionDto> {
  const sections = await ensureHomepageSections(orgId);
  const found = sections.find((s) => s.key === key);
  if (!found) {
    throw new Error(`Homepage section missing: ${key}`);
  }
  return found;
}

export async function updateHomepageSection(
  key: HomepageSectionKey,
  orgId: string,
  patch: {
    published?: boolean;
    content?: unknown;
    label?: string;
  },
  audit?: {
    createdById?: string;
    createdByName?: string;
    updatedById?: string;
    updatedByName?: string;
  }
): Promise<HomepageSectionDto> {
  await connectDB();
  await ensureHomepageSections(orgId);

  const content =
    patch.content !== undefined
      ? normalizeSectionContent(key, patch.content)
      : undefined;

  const data: Prisma.HomepageSectionUpdateInput = {};
  if (typeof patch.published === "boolean") data.published = patch.published;
  if (content) data.content = content as Prisma.InputJsonValue;
  if (typeof patch.label === "string" && patch.label.trim()) {
    data.label = patch.label.trim();
  }
  if (audit?.createdById) data.createdById = audit.createdById;
  if (audit?.createdByName) data.createdByName = audit.createdByName;
  if (audit?.updatedById) data.updatedById = audit.updatedById;
  if (audit?.updatedByName) data.updatedByName = audit.updatedByName;

  if (Object.keys(data).length === 0) {
    return getHomepageSection(key, orgId);
  }

  const doc = await prisma.homepageSection.update({
    where: { orgId_key: { orgId, key } },
    data,
  });

  invalidatePublicHomepageContentCache();
  return toDto(doc);
}

export async function resetHomepageSection(
  key: HomepageSectionKey,
  orgId: string
): Promise<HomepageSectionDto> {
  await connectDB();
  await ensureHomepageSections(orgId);

  const doc = await prisma.homepageSection.update({
    where: { orgId_key: { orgId, key } },
    data: {
      label: SECTION_LABELS[key],
      published: true,
      content: DEFAULT_HOMEPAGE_CONTENT[key] as Prisma.InputJsonValue,
    },
  });

  invalidatePublicHomepageContentCache();
  return toDto(doc);
}

/** Public storefront payload — published sections only. */
const PUBLIC_HOMEPAGE_TTL_MS = 5 * 60 * 1000;
let publicHomepageCache:
  | {
      at: number;
      value: {
        sections: HomepageSectionDto[];
        byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>>;
      };
    }
  | null = null;

export async function getPublicHomepageContent(
  orgId?: string
): Promise<{
  sections: HomepageSectionDto[];
  byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>>;
}> {
  if (
    !orgId &&
    publicHomepageCache &&
    Date.now() - publicHomepageCache.at < PUBLIC_HOMEPAGE_TTL_MS
  ) {
    return publicHomepageCache.value;
  }

  const all = await ensureHomepageSections(orgId);
  const sections = all.filter((s) => s.published);
  const byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>> = {};
  for (const section of sections) {
    byKey[section.key] = section;
  }
  const value = { sections, byKey };
  if (!orgId) {
    publicHomepageCache = { at: Date.now(), value };
  }
  return value;
}

/** Call after admin CMS mutations so the next storefront SSR is fresh. */
export function invalidatePublicHomepageContentCache() {
  publicHomepageCache = null;
}

export { isHomepageSectionKey };
