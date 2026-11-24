/**
 * Public category slugs. Unique per organization, stable after create.
 * Reserved words are the first URL segments under src/app (route groups skipped)
 * plus segments a later /{orgSlug} route must not swallow.
 */

/** First path segments scanned from src/app, plus required guest-route guards. */
export const RESERVED_CATEGORY_SLUGS = [
  "403",
  "admin",
  "api",
  "book",
  "booking",
  "cancel",
  "cart",
  "check-email",
  "checkout",
  "clear-session",
  "company-checkout",
  "company-pending",
  "customize",
  "embed",
  "fabrics",
  "forgot-password",
  "google",
  "home",
  "join",
  "kiosk",
  "login",
  "memberships",
  "payment",
  "privacy",
  "profile",
  "register-company",
  "reset-password",
  "shop",
  "sign",
  "signin",
  "signup",
  "success",
  "tailor",
  "tailors",
  "terms",
  "trending-fashion",
  "users",
  "verify-email",
  "waivers",
] as const;

const RESERVED = new Set<string>(RESERVED_CATEGORY_SLUGS);

/** Top-level public/ folders (static files, never a company page). */
export const PUBLIC_ASSET_SEGMENTS = ["brand", "embed", "fast", "venueflow"] as const;

/**
 * Page-less paths the proxy still auth-gates (routePolicy CLIENT_ONLY_PREFIXES
 * /user/profile and PHANTOM_CLIENT_PREFIXES). Never company pages.
 */
export const AUTH_GATED_PHANTOM_SEGMENTS = ["dashboard", "settings", "user"] as const;

/**
 * First URL segments that are never /{orgSlug}: app routes, public/ folders,
 * auth-gated phantom paths, and Next internals. An Organization.slug may not
 * equal one of these.
 */
export const RESERVED_FIRST_SEGMENTS = [
  ...new Set<string>([
    "_next",
    ...RESERVED_CATEGORY_SLUGS,
    ...PUBLIC_ASSET_SEGMENTS,
    ...AUTH_GATED_PHANTOM_SEGMENTS,
  ]),
];

const RESERVED_FIRST = new Set<string>(RESERVED_FIRST_SEGMENTS);

export function isReservedFirstSegment(segment: string): boolean {
  return RESERVED_FIRST.has(segment.trim().toLowerCase());
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isReservedCategorySlug(slug: string): boolean {
  return RESERVED.has(slug.trim().toLowerCase());
}

/** One-time slug from a category name. Does not apply collision suffixes. */
export function slugifyCategoryName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "category";
}

/**
 * Staff-edited slug. Reserved first segments and empty/unsafe text are rejected.
 * Collision suffixes are not applied here — the caller checks org uniqueness.
 */
export function assertEditableCategorySlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_RE.test(normalized) || normalized.length > 80) {
    throw new Error(
      "Public link must use lowercase letters, numbers, and hyphens"
    );
  }
  if (isReservedCategorySlug(normalized)) {
    throw new Error("That public link is reserved");
  }
  return normalized;
}

/**
 * Pick a slug that is not reserved and not already used in this organization.
 * The plain name is tried first. Collisions (and reserved bases) use -2, then -3.
 */
export function allocateCategorySlug(
  name: string,
  taken: Iterable<string>
): string {
  const base = slugifyCategoryName(name);
  const used = new Set(
    [...taken].map((slug) => slug.trim().toLowerCase()).filter(Boolean)
  );
  const candidates: string[] = [];
  if (SLUG_RE.test(base) && !isReservedCategorySlug(base)) candidates.push(base);
  for (let n = 2; n < 500; n += 1) {
    const suffix = `-${n}`;
    const stem = (base.slice(0, 80 - suffix.length).replace(/-+$/g, "") || "category");
    const suffixed = `${stem}${suffix}`;
    if (!SLUG_RE.test(suffixed) || isReservedCategorySlug(suffixed)) continue;
    candidates.push(suffixed);
  }
  for (const candidate of candidates) {
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate a public link for this category");
}
