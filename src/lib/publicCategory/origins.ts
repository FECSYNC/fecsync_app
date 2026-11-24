/**
 * Embed allowlist: https origins only, no path, no wildcard.
 * Saved with company_profile:write and stamped from actor.orgId.
 */

function validationError(message: string): Error {
  const err = new Error(message);
  err.name = "CompanyProfileValidationError";
  return err;
}

export const PUBLIC_PROFILE_FLAG_KEYS = [
  "publicLogo",
  "publicPhone",
  "publicSupportEmail",
  "publicWebsite",
  "publicAddress",
] as const;

export type PublicProfileFlagKey = (typeof PUBLIC_PROFILE_FLAG_KEYS)[number];

const ALLOWED = new Set<string>(PUBLIC_PROFILE_FLAG_KEYS);

/** Reject flags that would publish bank, tax, or billing email. */
export function assertAllowedPublicProfileKeys(
  body: Record<string, unknown>
): void {
  for (const key of Object.keys(body)) {
    if (!key.startsWith("public")) continue;
    if (!ALLOWED.has(key)) {
      throw validationError(`${key} is not a public company field`);
    }
  }
}

export function parseEmbedOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw validationError("Embed origin is required");
  }
  if (trimmed.includes("*")) {
    throw validationError("Embed origin cannot include a wildcard");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw validationError("Embed origin must be an https origin");
  }
  if (url.protocol !== "https:") {
    throw validationError("Embed origin must use https");
  }
  if (url.username || url.password) {
    throw validationError(
      "Embed origin cannot include a username or password"
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw validationError("Embed origin cannot include a path");
  }
  if (url.search || url.hash) {
    throw validationError("Embed origin cannot include a query or hash");
  }
  if (url.hostname.includes("*")) {
    throw validationError("Embed origin cannot include a wildcard");
  }
  return url.origin;
}

export function parseEmbedOriginList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw validationError("embedOrigins must be a list of https origins");
  }
  if (value.length > 20) {
    throw validationError("At most 20 embed origins are allowed");
  }
  const origins: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw validationError("embedOrigins must be a list of https origins");
    }
    const origin = parseEmbedOrigin(item);
    if (origins.includes(origin)) {
      throw validationError("Embed origins must be unique");
    }
    origins.push(origin);
  }
  return origins;
}
