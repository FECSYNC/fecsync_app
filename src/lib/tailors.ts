import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { idWhere, isValidId } from "@/lib/ids";
import {
  auditCreateToPrisma,
  auditUpdateToPrisma,
  whereOrgAndCatalogId,
} from "@/lib/catalogWrite";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";
import { isRolePresetId, isStaffPreset } from "@/lib/auth/permissions";
import {
  normalizeTailorAdminInput,
  normalizeTailorSelfInput,
  slugifyTailorName,
  type PublicTailorDto,
  type PublicTailorListResult,
  type TailorAdminInput,
  type TailorProfileDto,
  type TailorSelfInput,
  type TailorStatus,
  type TailorServiceTierDto,
  TAILOR_PORTFOLIO_REEL_MAX,
} from "@/lib/tailors.shared";
import { paginatedMeta, type PaginationOpts } from "@/lib/pagination";
import { storefrontOrgFilter } from "@/lib/org";
import { invalidateUserSessions } from "@/lib/memberAdmin";

export * from "@/lib/tailors.shared";

type LocationJson = {
  city?: string;
  state?: string;
  country?: string;
};

type ServiceTierJson = {
  name?: string;
  description?: string;
  priceFrom?: number;
  currency?: string;
};

type TailorRow = {
  id: string;
  userId: string;
  orgId: string;
  slug: string;
  displayName: string;
  bio?: string | null;
  specialties?: string[];
  location?: unknown;
  portfolioImages?: string[];
  serviceTypes?: string[];
  serviceTiers?: unknown;
  pricingNotes?: string | null;
  avgRating?: number;
  reviewCount?: number;
  status: TailorStatus;
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  user?: {
    id: string;
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  } | null;
};

function locationField(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function locationDto(raw: unknown): LocationJson {
  const loc =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    city: locationField(loc.city),
    state: locationField(loc.state),
    country: locationField(loc.country),
  };
}

/** Merge a partial location patch without dropping omitted fields. */
function mergeLocationFields(
  existingRaw: unknown,
  patch: { city?: string; state?: string; country?: string }
): LocationJson {
  const prev = locationDto(existingRaw);
  return {
    city: patch.city !== undefined ? patch.city : prev.city,
    state: patch.state !== undefined ? patch.state : prev.state,
    country: patch.country !== undefined ? patch.country : prev.country,
  };
}

function serviceTiersDto(raw: unknown): TailorServiceTierDto[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const tier = t && typeof t === "object" ? (t as ServiceTierJson) : {};
    return {
      name: String(tier.name ?? ""),
      description: tier.description,
      priceFrom: tier.priceFrom,
      currency: tier.currency,
    };
  });
}

function userLabel(user: TailorRow["user"], userId: string): {
  userId: string;
  userEmail?: string;
  userName?: string;
} {
  if (!user) return { userId };
  const parts = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    userId: user.id ?? userId,
    userEmail: user.email,
    userName: parts || user.username || undefined,
  };
}

export function toTailorDto(doc: TailorRow): TailorProfileDto {
  const linked = userLabel(doc.user ?? null, doc.userId);
  return {
    _id: doc.id,
    user: linked.userId,
    userEmail: linked.userEmail,
    userName: linked.userName,
    orgId: doc.orgId,
    slug: String(doc.slug ?? "").trim(),
    displayName: String(doc.displayName ?? "").trim(),
    bio: String(doc.bio ?? ""),
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    location: locationDto(doc.location),
    portfolioImages: Array.isArray(doc.portfolioImages)
      ? doc.portfolioImages
      : [],
    serviceTypes: Array.isArray(doc.serviceTypes) ? doc.serviceTypes : [],
    serviceTiers: serviceTiersDto(doc.serviceTiers),
    pricingNotes: String(doc.pricingNotes ?? ""),
    status: doc.status ?? "draft",
    createdByName:
      typeof doc.createdByName === "string" ? doc.createdByName : undefined,
    updatedByName:
      typeof doc.updatedByName === "string" ? doc.updatedByName : undefined,
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : undefined,
    updatedAt: doc.updatedAt
      ? new Date(doc.updatedAt).toISOString()
      : undefined,
  };
}

export function toPublicTailorDto(doc: TailorRow): PublicTailorDto {
  return {
    slug: String(doc.slug ?? "").trim(),
    displayName: String(doc.displayName ?? "").trim(),
    bio: String(doc.bio ?? ""),
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    location: locationDto(doc.location),
    portfolioImages: Array.isArray(doc.portfolioImages)
      ? doc.portfolioImages
      : [],
    serviceTypes: Array.isArray(doc.serviceTypes) ? doc.serviceTypes : [],
    serviceTiers: serviceTiersDto(doc.serviceTiers),
    pricingNotes: String(doc.pricingNotes ?? ""),
    avgRating:
      typeof doc.avgRating === "number" && Number.isFinite(doc.avgRating)
        ? Math.round(doc.avgRating * 10) / 10
        : 0,
    reviewCount:
      typeof doc.reviewCount === "number" && doc.reviewCount > 0
        ? doc.reviewCount
        : 0,
  };
}

export type PublicTailorListOpts = {
  q?: string;
  specialty?: string;
  /** Legacy combined location string (city/state/country substring). */
  location?: string;
  country?: string;
  city?: string;
  page?: number;
  limit?: number;
};

const PUBLIC_TAILOR_FILTER_MAX_LEN = 120;

function clampPublicFilter(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, PUBLIC_TAILOR_FILTER_MAX_LEN);
}

export async function listPublicTailors(
  opts: PublicTailorListOpts = {}
): Promise<PublicTailorListResult> {
  await dbConnect();
  const { orgId } = await storefrontOrgFilter();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(48, Math.max(1, opts.limit ?? 12));

  const q = clampPublicFilter(opts.q);
  const specialty = clampPublicFilter(opts.specialty);
  const location = clampPublicFilter(opts.location);
  const country = clampPublicFilter(opts.country);
  const city = clampPublicFilter(opts.city);

  const where: Prisma.TailorProfileWhereInput = {
    orgId,
    status: "approved",
  };

  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      { specialties: { has: q } },
    ];
  }

  // Specialty substring match isn't expressible cleanly on String[] — exact `has`
  // first; loose matches still work via the soft fallback below.
  if (specialty) {
    where.specialties = { has: specialty };
  }

  const locationClauses: Prisma.TailorProfileWhereInput[] = [];
  if (country) {
    locationClauses.push({
      location: { path: ["country"], string_contains: country },
    });
  }
  if (city) {
    locationClauses.push({
      location: { path: ["city"], string_contains: city },
    });
  }
  if (location && !country && !city) {
    locationClauses.push({
      OR: [
        { location: { path: ["city"], string_contains: location } },
        { location: { path: ["state"], string_contains: location } },
        { location: { path: ["country"], string_contains: location } },
      ],
    });
  }
  if (locationClauses.length) {
    where.AND = locationClauses;
  }

  const listSelect = {
    id: true,
    slug: true,
    displayName: true,
    bio: true,
    specialties: true,
    location: true,
    portfolioImages: true,
    serviceTypes: true,
    serviceTiers: true,
    pricingNotes: true,
    avgRating: true,
    reviewCount: true,
    status: true,
  } as const;

  // Prefer DB pagination. Soft specialty contains falls back only when exact
  // `has` returned empty (e.g. user typed "brid" for Bridal).
  let [total, pageRows] = await Promise.all([
    prisma.tailorProfile.count({ where }),
    prisma.tailorProfile.findMany({
      where,
      select: listSelect,
      orderBy: { displayName: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  // Partial specialty (e.g. "brid" for Bridal): exact `has` misses — fall back once.
  if (specialty && total === 0) {
    const softWhere: Prisma.TailorProfileWhereInput = {
      orgId,
      status: "approved",
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" as const } },
              { bio: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(country
        ? {
            location: {
              path: ["country"],
              string_contains: country,
            },
          }
        : {}),
      ...(city
        ? {
            location: {
              path: ["city"],
              string_contains: city,
            },
          }
        : {}),
    };
    const softRows = await prisma.tailorProfile.findMany({
      where: softWhere,
      select: listSelect,
      orderBy: { displayName: "asc" },
    });
    const sl = specialty.toLowerCase();
    const filtered = softRows.filter((row) =>
      (row.specialties ?? []).some((s) => String(s).toLowerCase().includes(sl))
    );
    total = filtered.length;
    const totalPagesSoft = Math.max(1, Math.ceil(total / limit));
    const effectivePage =
      total === 0 ? 1 : Math.min(Math.max(1, page), totalPagesSoft);
    pageRows = filtered.slice(
      (effectivePage - 1) * limit,
      effectivePage * limit
    );
    return {
      items: pageRows.map((row) =>
        toPublicTailorListDto(row as TailorRow)
      ),
      page: effectivePage,
      limit,
      total,
      totalPages: totalPagesSoft,
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const effectivePage =
    total === 0 ? 1 : Math.min(Math.max(1, page), totalPages);

  // If page was past the end, re-fetch the last page.
  if (effectivePage !== page && total > 0) {
    pageRows = await prisma.tailorProfile.findMany({
      where,
      select: listSelect,
      orderBy: { displayName: "asc" },
      skip: (effectivePage - 1) * limit,
      take: limit,
    });
  }

  return {
    items: pageRows.map((row) => toPublicTailorListDto(row as TailorRow)),
    page: effectivePage,
    limit,
    total,
    totalPages,
  };
}

/** List cards only need the cover image — keep payloads small. */
function toPublicTailorListDto(doc: TailorRow): PublicTailorDto {
  const full = toPublicTailorDto(doc);
  return {
    ...full,
    portfolioImages: full.portfolioImages.slice(0, 1),
    serviceTiers: [],
    pricingNotes: "",
  };
}

export async function getPublicTailorBySlug(
  slug: string
): Promise<PublicTailorDto | null> {
  await dbConnect();
  const cleaned = String(slug ?? "").trim().toLowerCase();
  if (!cleaned) return null;
  const { orgId } = await storefrontOrgFilter();
  const row = await prisma.tailorProfile.findFirst({
    where: { orgId, slug: cleaned, status: "approved" },
  });
  if (!row) return null;

  const { syncTailorProfileRatingsIfNeeded } = await import(
    "@/lib/tailorReviews"
  );
  const synced = await syncTailorProfileRatingsIfNeeded(row.id, {
    storedReviewCount: row.reviewCount,
  });
  const doc = {
    ...row,
    avgRating: synced.avgRating,
    reviewCount: synced.reviewCount,
  };

  return toPublicTailorDto(doc as TailorRow);
}

async function ensureUniqueSlug(
  base: string,
  excludeId?: string
): Promise<string> {
  const root = slugifyTailorName(base) || `tailor-${Date.now()}`;
  const candidates = [root];
  for (let i = 1; i <= 8; i++) {
    candidates.push(`${root.slice(0, 70)}-${i}`);
  }
  const taken = await prisma.tailorProfile.findMany({
    where: {
      slug: { in: candidates },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { slug: true },
  });
  const used = new Set(taken.map((row) => row.slug));
  for (const candidate of candidates) {
    if (!used.has(candidate)) return candidate;
  }
  return `${root.slice(0, 60)}-${Date.now()}`;
}

async function ensureTailorMembership(
  userId: string,
  orgId: string,
  opts: { promote?: boolean; forceActive?: boolean } = {}
): Promise<void> {
  const promote = opts.promote === true;
  const forceActive = opts.forceActive === true;
  const isLiveStatus = (status: string) =>
    status === "active" || status === "invited";

  const assertNoDualLiveSeat = async () => {
    const { findLiveOtherOrgMembership, ORG_DUAL_SEAT_LIVE_MESSAGE } =
      await import("@/lib/memberAdmin");
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    const otherLive = await findLiveOtherOrgMembership(userId, orgId);
    if (otherLive) {
      throw new ForbiddenError(ORG_DUAL_SEAT_LIVE_MESSAGE);
    }
  };

  const existing = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (existing) {
    const preset = existing.rolePreset;
    if (
      typeof preset === "string" &&
      isRolePresetId(preset) &&
      isStaffPreset(preset)
    ) {
      return;
    }
    if (existing.rolePreset === "tailor") {
      if (forceActive && existing.status !== "active") {
        if (existing.status === "invited") {
          const { assertMembershipInviteNotExpired } = await import(
            "@/lib/membershipInvites"
          );
          await assertMembershipInviteNotExpired(existing);
        }
        // Reactivating a non-live tailor seat consumes members + tailorSeats again.
        if (!isLiveStatus(existing.status)) {
          await assertNoDualLiveSeat();
          const { assertWithinPlanLimit, assertNewTailorSeat } = await import(
            "@/lib/planLimits"
          );
          await assertWithinPlanLimit(orgId, "members");
          await assertNewTailorSeat(orgId, userId);
        }
        await prisma.membership.update({
          where: { id: existing.id },
          data: {
            status: "active",
            roleTemplateId: null,
            inviteExpiresAt: null,
          },
        });
        void invalidateUserSessions(userId).catch((err) => {
          console.warn("[tailors] session invalidate failed:", err);
        });
      }
      return;
    }
    if (!promote) return;
    const nextStatus = forceActive ? "active" : existing.status;
    if (forceActive && existing.status === "invited") {
      const { assertMembershipInviteNotExpired } = await import(
        "@/lib/membershipInvites"
      );
      await assertMembershipInviteNotExpired(existing);
    }
    if (isLiveStatus(nextStatus)) {
      // Promoting into a live tailor seat — same dual-org rule as members invite.
      await assertNoDualLiveSeat();
      const { assertWithinPlanLimit, assertNewTailorSeat } = await import(
        "@/lib/planLimits"
      );
      if (!isLiveStatus(existing.status)) {
        await assertWithinPlanLimit(orgId, "members");
      }
      // No-op if this user already burns a seat via a live studio profile.
      await assertNewTailorSeat(orgId, userId);
    }
    await prisma.membership.update({
      where: { id: existing.id },
      data: {
        rolePreset: "tailor",
        status: nextStatus,
        roleTemplateId: null,
        ...(nextStatus === "active" ? { inviteExpiresAt: null } : {}),
      },
    });
    void invalidateUserSessions(userId).catch((err) => {
      console.warn("[tailors] session invalidate failed:", err);
    });
    return;
  }

  if (!promote && !forceActive) return;

  await assertNoDualLiveSeat();
  const { assertWithinPlanLimit, assertNewTailorSeat } = await import(
    "@/lib/planLimits"
  );
  await assertWithinPlanLimit(orgId, "members");
  await assertNewTailorSeat(orgId, userId);

  await prisma.membership.create({
    data: {
      userId,
      orgId,
      rolePreset: "tailor",
      status: "active",
      companyWideView: false,
    },
  });
  void invalidateUserSessions(userId).catch((err) => {
    console.warn("[tailors] session invalidate failed:", err);
  });
}

export async function suspendTailorProfilesForUser(
  userId: string,
  audit?: Record<string, unknown> | AuditUpdateStamp
): Promise<number> {
  await dbConnect();
  if (!isValidId(userId)) return 0;
  const auditFields =
    audit && "updatedBy" in audit
      ? auditUpdateToPrisma(audit as AuditUpdateStamp)
      : {};
  const result = await prisma.tailorProfile.updateMany({
    where: { userId, NOT: { status: "suspended" } },
    data: { status: "suspended", ...auditFields },
  });
  return result.count;
}

/** Capture studio statuses before suspend-first demote/revoke (compensate on write fail). */
export async function snapshotTailorProfileStatuses(
  userId: string
): Promise<Array<{ id: string; status: string }>> {
  await dbConnect();
  if (!isValidId(userId)) return [];
  return prisma.tailorProfile.findMany({
    where: { userId },
    select: { id: true, status: true },
  });
}

/** Restore prior TailorProfile.status values after a failed membership write. */
export async function restoreTailorProfileStatuses(
  snapshots: Array<{ id: string; status: string }>,
  audit?: Record<string, unknown> | AuditUpdateStamp
): Promise<void> {
  if (!snapshots.length) return;
  await dbConnect();
  const auditFields =
    audit && "updatedBy" in audit
      ? auditUpdateToPrisma(audit as AuditUpdateStamp)
      : {};
  for (const row of snapshots) {
    if (!isValidId(row.id) || !row.status) continue;
    await prisma.tailorProfile.update({
      where: { id: row.id },
      data: {
        status: row.status as
          | "draft"
          | "pending"
          | "approved"
          | "suspended",
        ...auditFields,
      },
    });
  }
}

export async function deleteTailorDomainForUser(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  if (db === prisma) {
    await dbConnect();
  }
  if (!isValidId(userId)) return;
  const profiles = await db.tailorProfile.findMany({
    where: { userId },
    select: { id: true },
  });
  const profileIds = profiles.map((p) => p.id);

  // Detach this user from any campaign they joined as a customer (FK → users).
  // Keep the participant row for the tailor's campaign history.
  await db.campaignParticipant.updateMany({
    where: { userId },
    data: { userId: null },
  });

  if (profileIds.length > 0) {
    await db.tailorReview.deleteMany({
      where: {
        OR: [{ tailorProfileId: { in: profileIds } }, { userId }],
      },
    });
    // Studio roster + campaigns (participants cascade from campaigns)
    await db.campaignParticipant.deleteMany({
      where: { campaign: { tailorProfileId: { in: profileIds } } },
    });
    await db.measurementCampaign.deleteMany({
      where: { tailorProfileId: { in: profileIds } },
    });
    await db.tailorClient.deleteMany({
      where: { tailorProfileId: { in: profileIds } },
    });
  } else {
    await db.tailorReview.deleteMany({ where: { userId } });
  }

  // Campaign submissions keep measurementSnapshot; drop profile FK before purge.
  const measurementProfileIds = (
    await db.measurementProfile.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((p) => p.id);
  if (measurementProfileIds.length > 0) {
    await db.campaignParticipant.updateMany({
      where: { measurementProfileId: { in: measurementProfileIds } },
      data: { measurementProfileId: null },
    });
  }

  // Account deletion purge: customer measurements + all tailoring jobs touching this user.
  await db.measurementProfile.deleteMany({ where: { userId } });
  if (profileIds.length > 0) {
    await db.tailoringJob.deleteMany({
      where: {
        OR: [
          { customerId: userId },
          { tailorProfileId: { in: profileIds } },
        ],
      },
    });
  } else {
    await db.tailoringJob.deleteMany({ where: { customerId: userId } });
  }
  await db.tailorProfile.deleteMany({ where: { userId } });
}

/**
 * Rollback a single TailorProfile created in this request — does not touch the
 * user's customer measurement profiles / jobs (unlike deleteTailorDomainForUser).
 */
export async function deleteTailorProfileById(profileId: string): Promise<void> {
  await dbConnect();
  if (!isValidId(profileId)) return;
  await prisma.$transaction(async (tx) => {
    await tx.campaignParticipant.deleteMany({
      where: { campaign: { tailorProfileId: profileId } },
    });
    await tx.measurementCampaign.deleteMany({
      where: { tailorProfileId: profileId },
    });
    await tx.tailorClient.deleteMany({
      where: { tailorProfileId: profileId },
    });
    await tx.tailorReview.deleteMany({
      where: { tailorProfileId: profileId },
    });
    await tx.tailoringJob.deleteMany({
      where: { tailorProfileId: profileId },
    });
    await tx.tailorProfile.deleteMany({ where: { id: profileId } });
  });
}

/** Approved profile + active tailor membership — for provider profile edit APIs. */
export async function resolveProviderTailorProfileId(
  userId: string
): Promise<string | null> {
  return resolveProviderTailorProfileIdWithStatuses(userId, ["approved"]);
}

/** Approved or suspended profile + active membership — in-flight job access. */
export async function resolveProviderTailorProfileIdForJobs(
  userId: string
): Promise<string | null> {
  return resolveProviderTailorProfileIdWithStatuses(userId, [
    "approved",
    "suspended",
  ]);
}

async function resolveProviderTailorProfileIdWithStatuses(
  userId: string,
  statuses: Array<"approved" | "suspended">
): Promise<string | null> {
  await dbConnect();
  if (!isValidId(userId)) return null;
  const profile = await prisma.tailorProfile.findFirst({
    where: { userId, status: { in: statuses } },
    select: { id: true, orgId: true },
  });
  if (!profile) return null;
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      orgId: profile.orgId,
      rolePreset: "tailor",
      status: "active",
    },
    select: { id: true },
  });
  return membership ? profile.id : null;
}

export async function assertActiveTailorProviderAccess(actor: {
  sub: string;
  role?: string | null;
  preset?: string | null;
  membershipRole?: string | null;
}): Promise<TailorProfileDto> {
  await dbConnect();
  const profile = await getTailorByUserId(actor.sub);
  if (!profile) {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Tailor profile not found");
  }

  if (profile.status === "suspended") {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Your tailor profile is suspended");
  }

  // Company SaaS: pending/suspended tenants cannot run studio tools even if a
  // TailorProfile row exists (AuthFresh alone allows pending sessions).
  const { assertOrganizationActive } = await import("@/lib/org");
  await assertOrganizationActive(profile.orgId);

  const preset =
    (typeof actor.preset === "string" && actor.preset) ||
    (typeof actor.membershipRole === "string" && actor.membershipRole) ||
    "";
  const staff =
    actor.role === "admin" ||
    (isRolePresetId(preset) && isStaffPreset(preset));
  if (staff) return profile;

  const membership = await prisma.membership.findFirst({
    where: {
      userId: actor.sub,
      orgId: profile.orgId,
      rolePreset: "tailor",
      status: "active",
    },
    select: { id: true },
  });
  if (!membership) {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Not an active tailor provider");
  }
  return profile;
}

const tailorUserInclude = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
    },
  },
} as const;

export async function listAdminTailors(
  orgId: string,
  opts?: { q?: string; status?: TailorStatus } & PaginationOpts
): Promise<{
  tailors: TailorProfileDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  await dbConnect();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;
  const q = opts?.q?.trim();

  const where = {
    orgId,
    ...(opts?.status ? { status: opts.status } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
            {
              user: {
                OR: [
                  { email: { contains: q, mode: "insensitive" as const } },
                  { firstName: { contains: q, mode: "insensitive" as const } },
                  { lastName: { contains: q, mode: "insensitive" as const } },
                  { username: { contains: q, mode: "insensitive" as const } },
                ],
              },
            },
            { specialties: { has: q } },
          ],
        }
      : {}),
  };

  const [total, pageRows] = await Promise.all([
    prisma.tailorProfile.count({ where }),
    prisma.tailorProfile.findMany({
      where,
      include: tailorUserInclude,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return {
    tailors: pageRows.map((row) => toTailorDto(row as TailorRow)),
    ...paginatedMeta(page, limit, total),
  };
}

export async function getAdminTailor(
  orgId: string,
  id: string
): Promise<TailorProfileDto | null> {
  await dbConnect();
  if (!isValidId(id)) return null;
  const row = await prisma.tailorProfile.findFirst({
    where: whereOrgAndCatalogId(orgId, id),
    include: tailorUserInclude,
  });
  return row ? toTailorDto(row as TailorRow) : null;
}

function auditFromRecord(audit?: Record<string, unknown>) {
  if (!audit) return {};
  if ("createdBy" in audit && typeof audit.createdBy === "string") {
    return auditCreateToPrisma(audit as AuditCreateStamp);
  }
  if ("updatedBy" in audit && typeof audit.updatedBy === "string") {
    return auditUpdateToPrisma(audit as AuditUpdateStamp);
  }
  return {};
}

/** Best-effort studio access email + in-app alert after admin creates a tailor. */
async function notifyTailorStudioAccessBestEffort(input: {
  userId: string;
  email: string;
  displayName: string;
  orgId: string;
  status: TailorStatus;
  invitedBySub?: string;
}): Promise<void> {
  try {
    const { createNotification } = await import(
      "@/services/notificationService"
    );
    await createNotification(
      input.userId,
      "Your tailor studio is ready",
      "Sign in and open Tailor Home to manage clients and measurement campaigns.",
      "tailoring",
      { href: "/tailor/home" }
    );
  } catch (err) {
    console.warn("[tailors] studio access notification failed:", err);
  }

  try {
    const { sendTailorStudioInviteEmail } = await import("@/lib/mailer");
    const [org, inviter] = await Promise.all([
      prisma.organization.findFirst({
        where: idWhere(input.orgId),
        select: { name: true },
      }),
      input.invitedBySub && isValidId(input.invitedBySub)
        ? prisma.user.findFirst({
            where: idWhere(input.invitedBySub),
            select: { email: true },
          })
        : Promise.resolve(null),
    ]);
    await sendTailorStudioInviteEmail({
      to: input.email,
      displayName: input.displayName,
      orgName: org?.name ? String(org.name) : undefined,
      status: input.status,
      invitedByEmail: inviter?.email ? String(inviter.email) : undefined,
      orgId: input.orgId,
    });
  } catch (err) {
    console.error("[tailors] studio invite email failed:", err);
  }
}

export async function createAdminTailor(
  orgId: string,
  raw: TailorAdminInput | Record<string, unknown>,
  audit?: Record<string, unknown>
): Promise<TailorProfileDto> {
  await dbConnect();
  const input = normalizeTailorAdminInput(raw as Record<string, unknown>);

  const resolvedUserId = input.userId?.trim() ?? "";
  const emailRaw = input.userEmail?.trim().toLowerCase() ?? "";

  let user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  } | null = null;

  if (isValidId(resolvedUserId)) {
    user = await prisma.user.findFirst({
      where: { ...idWhere(resolvedUserId), accountDeleted: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });
  } else if (emailRaw) {
    user = await prisma.user.findFirst({
      where: { email: emailRaw, accountDeleted: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });
    if (!user) throw new Error("User not found for that email");
  } else {
    throw new Error("Valid userId or userEmail is required");
  }

  if (!user) throw new Error("User not found");

  const existing = await prisma.tailorProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) {
    throw new Error("This user already has a tailor profile");
  }

  const displayName =
    input.displayName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    user.email.split("@")[0] ||
    "Tailor";

  const slug = await ensureUniqueSlug(input.slug || displayName);
  const status: TailorStatus = input.status ?? "pending";

  // Seat / membership before profile so plan-limit failure never leaves an orphan TailorProfile
  // (retry would then hit "already has a tailor profile" while still over cap).
  // Staff keep their preset (ensureTailorMembership early-return) but still burn
  // a tailorSeats slot via the live studio profile — assert before create.
  const { assertNewTailorSeat } = await import("@/lib/planLimits");
  await assertNewTailorSeat(orgId, user.id);

  const membershipBefore = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    select: {
      id: true,
      rolePreset: true,
      status: true,
      roleTemplateId: true,
    },
  });
  const membershipSnapshot = membershipBefore
    ? {
        existed: true as const,
        id: membershipBefore.id,
        rolePreset: membershipBefore.rolePreset,
        status: membershipBefore.status,
        roleTemplateId: membershipBefore.roleTemplateId,
      }
    : { existed: false as const };

  await ensureTailorMembership(user.id, orgId, {
    promote: true,
    forceActive: true,
  });

  let createdId: string | null = null;
  try {
    const created = await prisma.tailorProfile.create({
      data: {
        userId: user.id,
        orgId,
        slug,
        displayName,
        bio: input.bio ?? "",
        specialties: input.specialties ?? [],
        location: input.location ?? {},
        portfolioImages: input.portfolioImages ?? [],
        serviceTypes: input.serviceTypes ?? [],
        serviceTiers: input.serviceTiers ?? [],
        pricingNotes: input.pricingNotes ?? "",
        status,
        ...auditFromRecord(audit),
      },
      include: tailorUserInclude,
    });
    createdId = created.id;
    const dto = toTailorDto(created as TailorRow);
    const invitedBySub =
      audit && typeof audit.createdBy === "string"
        ? audit.createdBy
        : undefined;
    await notifyTailorStudioAccessBestEffort({
      userId: user.id,
      email: user.email,
      displayName: dto.displayName,
      orgId,
      status: dto.status,
      invitedBySub,
    });
    return dto;
  } catch (err) {
    if (createdId) {
      try {
        // Profile-scoped rollback only — never purge customer measurements/jobs.
        await deleteTailorProfileById(createdId);
      } catch (cleanupErr) {
        console.error(
          "[tailors] createAdminTailor profile cleanup failed; orphan may remain:",
          createdId,
          cleanupErr
        );
      }
    }
    // Concurrent create: another request may have won the unique userId race.
    // Never roll back membership here — the winner's live seat/profile must stay.
    const otherProfile = await prisma.tailorProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (otherProfile && otherProfile.id !== createdId) {
      throw new Error("This user already has a tailor profile");
    }
    // Roll back membership seat we may have just activated (no competing profile).
    try {
      if (membershipSnapshot.existed) {
        await prisma.membership.update({
          where: { id: membershipSnapshot.id },
          data: {
            rolePreset: membershipSnapshot.rolePreset,
            status: membershipSnapshot.status,
            roleTemplateId: membershipSnapshot.roleTemplateId,
          },
        });
      } else {
        await prisma.membership.deleteMany({
          where: { userId: user.id, orgId, rolePreset: "tailor" },
        });
      }
      void invalidateUserSessions(user.id).catch((sessionErr) => {
        console.warn("[tailors] session invalidate failed:", sessionErr);
      });
    } catch (compensateErr) {
      console.error(
        "[tailors] createAdminTailor membership compensate failed:",
        user.id,
        compensateErr
      );
      const base =
        err instanceof Error ? err.message : "Tailor create failed";
      throw new Error(
        `${base}. Membership seat compensate also failed — revoke this user's tailor seat if it was activated.`
      );
    }
    throw err;
  }
}

export async function updateAdminTailor(
  orgId: string,
  id: string,
  raw: TailorAdminInput | Record<string, unknown>,
  audit?: Record<string, unknown>
): Promise<TailorProfileDto | null> {
  await dbConnect();
  if (!isValidId(id)) return null;

  const existing = await prisma.tailorProfile.findFirst({
    where: whereOrgAndCatalogId(orgId, id),
  });
  if (!existing) return null;

  const input = normalizeTailorAdminInput(raw as Record<string, unknown>);
  const data: Parameters<typeof prisma.tailorProfile.update>[0]["data"] = {
    ...auditFromRecord(audit),
  };

  if (input.displayName !== undefined) {
    if (!input.displayName.trim()) throw new Error("displayName is required");
    data.displayName = input.displayName.trim();
  }
  if (input.bio !== undefined) data.bio = input.bio;
  if (input.specialties !== undefined) data.specialties = input.specialties;
  if (input.location !== undefined) {
    data.location = mergeLocationFields(existing.location, input.location);
  }
  if (input.portfolioImages !== undefined) {
    data.portfolioImages = input.portfolioImages;
  }
  if (input.serviceTypes !== undefined) data.serviceTypes = input.serviceTypes;
  if (input.serviceTiers !== undefined) data.serviceTiers = input.serviceTiers;
  if (input.pricingNotes !== undefined) data.pricingNotes = input.pricingNotes;
  if (input.status !== undefined) data.status = input.status;

  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await ensureUniqueSlug(input.slug, existing.id);
  }

  if (input.userId && input.userId !== existing.userId) {
    throw new Error("Cannot reassign tailor profile to another user");
  }

  // Leaving suspended re-includes retained campaigns/clients in plan meters and
  // requires a live tailor seat (approve OR pending/draft restore).
  let membershipSnapshot:
    | {
        existed: true;
        id: string;
        rolePreset: string;
        status: string;
        roleTemplateId: string | null;
      }
    | { existed: false }
    | null = null;

  const leavingSuspended =
    existing.status === "suspended" &&
    input.status !== undefined &&
    input.status !== "suspended";
  const becomingApproved =
    input.status === "approved" && existing.status !== "approved";

  if (leavingSuspended || becomingApproved) {
    if (leavingSuspended) {
      const { assertSuspendedStudioRosterFitsPlan } = await import(
        "@/lib/planLimits"
      );
      await assertSuspendedStudioRosterFitsPlan(orgId, existing.id);
    }
    // Seat before status write so ForbiddenError cannot leave restored meters
    // without a usable membership (pending/draft/approved).
    const before = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: existing.userId, orgId } },
      select: {
        id: true,
        rolePreset: true,
        status: true,
        roleTemplateId: true,
      },
    });
    membershipSnapshot = before
      ? {
          existed: true,
          id: before.id,
          rolePreset: before.rolePreset,
          status: before.status,
          roleTemplateId: before.roleTemplateId,
        }
      : { existed: false };
    await ensureTailorMembership(existing.userId, orgId, {
      promote: true,
      forceActive: true,
    });
  }

  try {
    await prisma.tailorProfile.update({
      where: { id: existing.id },
      data,
    });
  } catch (err: unknown) {
    if (membershipSnapshot) {
      try {
        if (membershipSnapshot.existed) {
          await prisma.membership.update({
            where: { id: membershipSnapshot.id },
            data: {
              rolePreset: membershipSnapshot.rolePreset,
              status: membershipSnapshot.status,
              roleTemplateId: membershipSnapshot.roleTemplateId,
            },
          });
        } else {
          await prisma.membership.deleteMany({
            where: {
              userId: existing.userId,
              orgId,
              rolePreset: "tailor",
            },
          });
        }
        void invalidateUserSessions(existing.userId).catch((sessionErr) => {
          console.warn("[tailors] session invalidate failed:", sessionErr);
        });
      } catch (compensateErr) {
        console.error(
          "[tailors] approve membership compensate failed after profile update error:",
          existing.id,
          compensateErr
        );
        const profileMsg =
          err instanceof Error ? err.message : "Profile update failed";
        throw new Error(
          `${profileMsg}. Membership seat compensate also failed — revoke or suspend this user's tailor seat if it was activated.`
        );
      }
    }
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === "P2002") throw new Error("Slug must be unique");
    throw err;
  }

  const populated = await prisma.tailorProfile.findUnique({
    where: { id: existing.id },
    include: tailorUserInclude,
  });
  return populated ? toTailorDto(populated as TailorRow) : null;
}

export async function patchAdminTailorStatus(
  orgId: string,
  id: string,
  status: TailorStatus,
  audit?: Record<string, unknown>
): Promise<TailorProfileDto | null> {
  return updateAdminTailor(orgId, id, { status }, audit);
}

export async function getTailorByUserId(
  userId: string
): Promise<TailorProfileDto | null> {
  await dbConnect();
  if (!isValidId(userId)) return null;
  const row = await prisma.tailorProfile.findFirst({
    where: { userId },
    include: tailorUserInclude,
  });
  return row ? toTailorDto(row as TailorRow) : null;
}

export async function updateOwnTailorProfile(
  userId: string,
  raw: TailorSelfInput | Record<string, unknown>,
  audit?: Record<string, unknown>
): Promise<TailorProfileDto> {
  await dbConnect();
  if (!isValidId(userId)) throw new Error("Invalid user");

  const existing = await prisma.tailorProfile.findFirst({ where: { userId } });
  if (!existing) throw new Error("Tailor profile not found");
  if (existing.status === "suspended") {
    throw new Error("Your tailor profile is suspended");
  }
  if (existing.status !== "approved") {
    throw new Error(
      "Your tailor profile must be approved before you can edit it"
    );
  }

  const input = normalizeTailorSelfInput(raw as Record<string, unknown>);
  const data: Parameters<typeof prisma.tailorProfile.update>[0]["data"] = {
    ...auditFromRecord(audit),
  };

  if (input.displayName !== undefined) {
    if (!input.displayName.trim()) throw new Error("displayName is required");
    data.displayName = input.displayName.trim();
  }
  if (input.bio !== undefined) data.bio = input.bio;
  if (input.specialties !== undefined) data.specialties = input.specialties;
  if (input.location !== undefined) {
    const merged = mergeLocationFields(existing.location, input.location);
    if (!merged.country?.trim()) {
      throw new Error("Country is required for your public listing");
    }
    data.location = merged;
  }
  if (input.portfolioImages !== undefined) {
    data.portfolioImages = input.portfolioImages.slice(
      0,
      TAILOR_PORTFOLIO_REEL_MAX
    );
  }
  if (input.serviceTypes !== undefined) data.serviceTypes = input.serviceTypes;
  if (input.serviceTiers !== undefined) data.serviceTiers = input.serviceTiers;
  if (input.pricingNotes !== undefined) data.pricingNotes = input.pricingNotes;

  try {
    await prisma.tailorProfile.update({
      where: { id: existing.id },
      data,
    });
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === "P2002") throw new Error("Slug must be unique");
    throw err;
  }

  const populated = await prisma.tailorProfile.findUnique({
    where: { id: existing.id },
    include: tailorUserInclude,
  });
  return toTailorDto((populated ?? existing) as TailorRow);
}

export async function suggestDisplayNameForUser(
  userId: string
): Promise<string | null> {
  await dbConnect();
  if (!isValidId(userId)) return null;
  const user = await prisma.user.findFirst({
    where: idWhere(userId),
    select: { email: true, firstName: true, lastName: true, username: true },
  });
  if (!user) return null;
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    user.email.split("@")[0] ||
    null
  );
}

async function reactivateSuspendedTailorProfile(
  row: TailorRow,
  orgId: string,
  audit?: Record<string, unknown>
): Promise<TailorProfileDto> {
  const previousOrgId = row.orgId;
  // Soft-revoke frees campaign/client quota; restoring must re-fit the
  // target org (including after org-move re-stamp).
  const { assertSuspendedStudioRosterFitsPlan } = await import(
    "@/lib/planLimits"
  );
  await assertSuspendedStudioRosterFitsPlan(orgId, row.id);

  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.tailorProfile.update({
      where: { id: row.id },
      data: {
        status: "pending",
        orgId,
        ...auditFromRecord(audit),
      },
      include: tailorUserInclude,
    });
    // Campaigns denormalize orgId for plan meters — keep in sync on org move
    // after soft-revoke (otherwise old org keeps burning campaign quota).
    if (previousOrgId && previousOrgId !== orgId) {
      await tx.measurementCampaign.updateMany({
        where: { tailorProfileId: row.id },
        data: { orgId },
      });
    }
    return profile;
  });
  return toTailorDto(updated as TailorRow);
}

/**
 * Ensure a pending tailor studio profile exists for a membership.grant.
 * Re-invites after revoke reactivate suspended profiles (do not leave studio 403).
 * Throws on missing user / create failure (callers must not treat as success).
 */
export async function ensurePendingTailorProfile(
  orgId: string,
  userId: string,
  audit?: Record<string, unknown>,
  options?: { reactivateSuspended?: boolean }
): Promise<TailorProfileDto> {
  await dbConnect();
  if (!isValidId(userId)) {
    throw new Error("Invalid user id for tailor profile");
  }
  const reactivateSuspended = options?.reactivateSuspended !== false;

  const existing = await prisma.tailorProfile.findFirst({
    where: { userId },
    include: tailorUserInclude,
  });
  if (existing) {
    if (existing.status === "suspended") {
      if (!reactivateSuspended) {
        return toTailorDto(existing as TailorRow);
      }
      return reactivateSuspendedTailorProfile(
        existing as TailorRow,
        orgId,
        audit
      );
    }
    return toTailorDto(existing as TailorRow);
  }

  const user = await prisma.user.findFirst({
    where: { ...idWhere(userId), accountDeleted: false },
  });
  if (!user) {
    throw new Error("User not found for tailor profile");
  }

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    user.email.split("@")[0] ||
    "Tailor";

  try {
    const { assertNewTailorSeat } = await import("@/lib/planLimits");
    await assertNewTailorSeat(orgId, user.id);
    const slug = await ensureUniqueSlug(displayName);
    const created = await prisma.tailorProfile.create({
      data: {
        userId: user.id,
        orgId,
        slug,
        displayName,
        bio: "",
        specialties: [],
        location: {},
        portfolioImages: [],
        serviceTypes: [],
        serviceTiers: [],
        pricingNotes: "",
        status: "pending",
        ...auditFromRecord(audit),
      },
    });
    const populated = await prisma.tailorProfile.findUnique({
      where: { id: created.id },
      include: tailorUserInclude,
    });
    return toTailorDto((populated ?? created) as TailorRow);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === "P2002") {
      const raced = await prisma.tailorProfile.findFirst({
        where: { userId },
        include: tailorUserInclude,
      });
      if (!raced) {
        throw err;
      }
      if (raced.status === "suspended") {
        if (!reactivateSuspended) {
          return toTailorDto(raced as TailorRow);
        }
        return reactivateSuspendedTailorProfile(
          raced as TailorRow,
          orgId,
          audit
        );
      }
      return toTailorDto(raced as TailorRow);
    }
    throw err;
  }
}
