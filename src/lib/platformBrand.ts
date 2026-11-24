/**
 * Public product brand — never expose legacy client storefront names.
 * Env overrides win for deploys; fallbacks are FECSYNC-only.
 */
export const PLATFORM_BRAND_NAME = "FECSYNC";

export const PLATFORM_SITE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_URL ||
  "https://fecsync.com"
).replace(/\/$/, "");

export const PLATFORM_SUPPORT_EMAIL =
  process.env.PLATFORM_SUPPORT_EMAIL?.trim() ||
  process.env.ADMIN_EMAIL?.trim()?.replace(/^["']|["']$/g, "") ||
  "admin@fecsync.com";

/** Remote-safe asset host for emails when local URLs cannot load in inboxes. */
export function platformEmailAssetBaseUrl(): string {
  const configured =
    process.env.EMAIL_ASSET_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    PLATFORM_SITE_URL;
  const siteUrl = configured.includes("localhost")
    ? PLATFORM_SITE_URL.includes("localhost")
      ? "https://fecsync.com"
      : PLATFORM_SITE_URL
    : configured;
  return siteUrl.replace(/\/$/, "");
}
