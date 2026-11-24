/**
 * Shared tailor DTOs / validation — safe for client and server.
 * Do not import mongoose here.
 */

export const TAILOR_STATUSES = [
  "draft",
  "pending",
  "approved",
  "suspended",
] as const;
export type TailorStatus = (typeof TAILOR_STATUSES)[number];

/** Public storefront portfolio reel cap (studio profile + upload API). */
export const TAILOR_PORTFOLIO_REEL_MAX = 5;

export type TailorLocationDto = {
  city?: string;
  state?: string;
  country?: string;
};

export type TailorServiceTierDto = {
  name: string;
  description?: string;
  priceFrom?: number;
  currency?: string;
};

export type TailorProfileDto = {
  _id: string;
  user: string;
  userEmail?: string;
  userName?: string;
  orgId: string;
  slug: string;
  displayName: string;
  bio: string;
  specialties: string[];
  location: TailorLocationDto;
  portfolioImages: string[];
  serviceTypes: string[];
  serviceTiers: TailorServiceTierDto[];
  pricingNotes: string;
  status: TailorStatus;
  createdByName?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Storefront discovery DTO — no user email/phone, no orgId, no audit fields.
 * Public list/detail only return approved profiles.
 */
export type PublicTailorDto = {
  slug: string;
  displayName: string;
  bio: string;
  specialties: string[];
  location: TailorLocationDto;
  portfolioImages: string[];
  serviceTypes: string[];
  serviceTiers: TailorServiceTierDto[];
  pricingNotes: string;
  avgRating?: number;
  reviewCount?: number;
};

export type PublicTailorListResult = {
  items: PublicTailorDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** Admin create / update payload. */
export type TailorAdminInput = {
  userId?: string;
  /** Resolve user by email when userId is omitted (ops without users:read). */
  userEmail?: string;
  slug?: string;
  displayName?: string;
  bio?: string;
  specialties?: string[];
  location?: TailorLocationDto;
  portfolioImages?: string[];
  serviceTypes?: string[];
  serviceTiers?: TailorServiceTierDto[];
  pricingNotes?: string;
  status?: TailorStatus;
};

/** Fields a tailor may edit on their own profile (not status / user / slug ownership). */
export type TailorSelfInput = {
  displayName?: string;
  bio?: string;
  specialties?: string[];
  location?: TailorLocationDto;
  portfolioImages?: string[];
  serviceTypes?: string[];
  serviceTiers?: TailorServiceTierDto[];
  pricingNotes?: string;
  /** Slug only when still draft/pending — approved profiles keep stable URLs. */
  slug?: string;
};

export function isTailorStatus(value: string): value is TailorStatus {
  return (TAILOR_STATUSES as readonly string[]).includes(value);
}

export function slugifyTailorName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function asStringArray(value: unknown, maxItems = 40, maxLen = 80): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, maxLen);
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeLocation(raw: unknown): TailorLocationDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const loc = raw as Record<string, unknown>;
  const out: TailorLocationDto = {};
  if (typeof loc.city === "string") out.city = loc.city.trim().slice(0, 120);
  if (typeof loc.state === "string") out.state = loc.state.trim().slice(0, 120);
  if (typeof loc.country === "string")
    out.country = loc.country.trim().slice(0, 120);
  return out;
}

function normalizeServiceTiers(raw: unknown): TailorServiceTierDto[] {
  if (!Array.isArray(raw)) return [];
  const out: TailorServiceTierDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    const tier: TailorServiceTierDto = {
      name: row.name.trim().slice(0, 120),
    };
    if (typeof row.description === "string") {
      tier.description = row.description.trim().slice(0, 500);
    }
    if (typeof row.priceFrom === "number" && Number.isFinite(row.priceFrom)) {
      tier.priceFrom = Math.max(0, row.priceFrom);
    }
    if (typeof row.currency === "string" && row.currency.trim()) {
      tier.currency = row.currency.trim().slice(0, 8).toUpperCase();
    }
    out.push(tier);
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeTailorAdminInput(
  body: Record<string, unknown>
): TailorAdminInput {
  const input: TailorAdminInput = {};
  if (typeof body.userId === "string") input.userId = body.userId.trim();
  if (typeof body.userEmail === "string" && body.userEmail.trim()) {
    input.userEmail = body.userEmail.trim().toLowerCase();
  } else if (typeof body.email === "string" && body.email.trim()) {
    input.userEmail = body.email.trim().toLowerCase();
  }
  if (typeof body.slug === "string") {
    input.slug = slugifyTailorName(body.slug) || undefined;
  }
  if (typeof body.displayName === "string") {
    input.displayName = body.displayName.trim().slice(0, 120);
  }
  if (typeof body.bio === "string") {
    input.bio = body.bio.trim().slice(0, 2000);
  }
  if (body.specialties !== undefined) {
    input.specialties = asStringArray(body.specialties);
  }
  if (body.location !== undefined) {
    input.location = normalizeLocation(body.location);
  }
  if (body.portfolioImages !== undefined) {
    input.portfolioImages = asStringArray(body.portfolioImages, 30, 500);
  }
  if (body.serviceTypes !== undefined) {
    input.serviceTypes = asStringArray(body.serviceTypes);
  }
  if (body.serviceTiers !== undefined) {
    input.serviceTiers = normalizeServiceTiers(body.serviceTiers);
  }
  if (typeof body.pricingNotes === "string") {
    input.pricingNotes = body.pricingNotes.trim().slice(0, 1000);
  }
  if (typeof body.status === "string" && isTailorStatus(body.status)) {
    input.status = body.status;
  }
  return input;
}

export function normalizeTailorSelfInput(
  body: Record<string, unknown>
): TailorSelfInput {
  const admin = normalizeTailorAdminInput(body);
  return {
    displayName: admin.displayName,
    bio: admin.bio,
    specialties: admin.specialties,
    location: admin.location,
    portfolioImages: admin.portfolioImages,
    serviceTypes: admin.serviceTypes,
    serviceTiers: admin.serviceTiers,
    pricingNotes: admin.pricingNotes,
    slug: admin.slug,
  };
}
