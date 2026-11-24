/**
 * UI-only hide list for shop/CMS admin surfaces we are not exposing right now.
 * Routes, APIs, permission keys, and presets stay intact — chrome + matrix only.
 * Re-enable by removing an href/feature from these sets.
 */
export const ADMIN_UI_HIDDEN_HREFS = [
  "/admin/homepage-content",
  "/admin/ad-banners",
  "/admin/customizations",
  "/admin/fabrics",
  "/admin/tailors",
  "/admin/tailoring-jobs",
] as const;

/** Permission matrix feature headings to omit (not customer "My …" surfaces). */
export const ADMIN_UI_HIDDEN_PERMISSION_FEATURES: ReadonlySet<string> = new Set([
  "Fabrics",
  "Customizations",
  "Tailors",
  "Tailoring Jobs",
  "Homepage",
  "Ad banners",
  // Not admin sidebar surfaces — staff matrix omits these headings
  "Carts",
  "Wallets",
  "Uploads",
]);

export function isAdminUiHiddenHref(href: string): boolean {
  const raw = href.split("?")[0] ?? href;
  const p =
    raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return ADMIN_UI_HIDDEN_HREFS.some(
    (h) => p === h || p.startsWith(`${h}/`)
  );
}

export function isAdminUiHiddenPermissionFeature(feature: string): boolean {
  return ADMIN_UI_HIDDEN_PERMISSION_FEATURES.has(feature);
}
