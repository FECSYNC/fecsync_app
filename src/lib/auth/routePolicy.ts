/**
 * Edge page-route policy for `src/proxy.ts`.
 *
 * Source of truth for which *pages* the proxy gates. API RBAC stays in
 * `src/lib/middleware/requireAuth.ts` (not in the matcher).
 *
 * Isolation: user-scoped (JWT `sub`). Tenancy: Organization is the data root
 * (Step 5.1); Membership puts orgId on the JWT (Step 5.2). Edge still cannot
 * hit the database — it trusts JWT claims only.
 * JWT `permissions[]` may be omitted (token-size fallback) — do not require
 * them at the edge.
 *
 * Wrong-role pages (existing copy, not names):
 *   Client on /admin → /403 (Admin Access Required)
 *   Staff on /profile → /admin (matches `(user)` layout)
 *   /403/admin is the inverse (admin on a user surface); unused here because
 *   staff are sent to /admin instead of a 403.
 *
 * Public storefront (not in matcher): /home, /shop, /fabrics, /tailors, /customize,
 * /trending-fashion, /join/[slug], legal, payment result/callback pages, /403, identity pages.
 * /customize lives under `(public)` — not a client-only gate.
 *
 * Payments: Stripe checkout lives on /checkout (auth-any session). Paystack UI
 * and wallet UI stay off (PAYMENT_POLICY). Provider result pages must stay
 * public so Stripe/Paystack redirects are not sent to sign-in.
 * Isolation is not applied here — edge cannot hit the database; APIs use
 * document.user === JWT sub. No org/shop/tenant lookup.
 */

import {
  isPermission,
  isRolePresetId,
  isStaffPreset,
  isTailorProviderPreset,
  mapDbRoleToPreset,
} from "@/lib/auth/permissions";

export type RouteGate = "root" | "staff" | "client" | "tailor" | "auth" | "public";

/** Prefixes that require a staff JWT (`role === "admin"` or staff preset). */
export const STAFF_ROUTE_PREFIXES = ["/admin"] as const;

/**
 * Find-a-Tailor provider pages. Edge requires signed-in tailor preset
 * (or staff who may preview). Staff without tailor preset are allowed through
 * so ops can QA; page/API still enforce TailorProfile ownership for edits.
 */
export const TAILOR_ROUTE_PREFIXES = ["/tailor"] as const;

/**
 * Client-only pages. Staff are sent to /admin (same as `(user)` layout).
 * Live (user) pages: /profile, /profile/customizations/[id], tailoring jobs.
 * /user/profile is a phantom path (no page) kept so old links still gate.
 * Tailors (preset tailor) may use /profile like clients.
 */
export const CLIENT_ONLY_PREFIXES = [
  "/profile",
  "/user/profile",
] as const;

/** Inventory of (user) pages. Covered by CLIENT_ONLY_PREFIXES (`/profile/**`). */
export const USER_PAGES = [
  "/profile",
  "/profile/customizations/[id]",
  "/profile/tailoring-jobs",
  "/profile/tailoring-jobs/[id]",
] as const;

/**
 * Signed-in any role (today's proxy). Staff are not kicked to /admin.
 * Page session only — not payments:checkout_own, not a tenant shop. Cart/Order
 * isolation stays `user === JWT sub` in APIs. Checkout UI is Stripe-only.
 */
export const AUTH_ANY_PREFIXES = ["/cart", "/checkout"] as const;

/**
 * Provider/result pages. Never add these to `config.matcher`.
 * /payment/* = Stripe + leftover Paystack callback UI; /success and /cancel
 * are Stripe return URLs. Tax is per-org TaxSettings (admin), not these routes.
 */
export const PAYMENT_PUBLIC_PREFIXES = [
  "/payment",
  "/success",
  "/cancel",
] as const;

/**
 * No pages exist. Old proxy matcher listed these — still require a session
 * so they cannot be used as an unauthenticated hole.
 */
export const PHANTOM_CLIENT_PREFIXES = ["/settings", "/dashboard"] as const;

/**
 * Admin pages inventory (see src/lib/adminNav.ts for live sidebar groups).
 * All sit under /admin so STAFF_ROUTE_PREFIXES is enough; this list is the
 * inventory diff for Step 2.1.
 */
export const ADMIN_PAGES = [
  "/admin",
  "/admin/products",
  "/admin/products/[id]",
  "/admin/orders",
  "/admin/orders/[orderId]",
  "/admin/categories",
  "/admin/categories/[id]",
  "/admin/fabrics",
  "/admin/fabrics/[id]",
  "/admin/customizations",
  "/admin/customizations/[id]",
  "/admin/users",
  "/admin/registered-companies",
  "/admin/permissions",
  "/admin/tax-settings",
  "/admin/company-profile",
  "/admin/venues",
  "/admin/hq",
  "/admin/billing",
  "/admin/payouts",
  "/admin/booking-packages",
  "/admin/shipping-settings",
  "/admin/settings/shipping",
  "/admin/ai-settings",
  "/admin/ai-chats",
  "/admin/reviews",
  "/admin/deliveries",
  "/admin/deliveries/[id]",
  "/admin/tailors",
  "/admin/tailoring-jobs",
  "/admin/tailoring-jobs/[id]",
  "/admin/ticketing",
  "/admin/ticketing/categories",
  "/admin/ticketing/products",
  "/admin/ticketing/products/new",
  "/admin/ticketing/products/[productId]",
  "/admin/ticketing/products/[productId]/edit",
  "/admin/ticketing/sessions",
  "/admin/ticketing/resources",
  "/admin/ticketing/add-ons",
  "/admin/ticketing/passes",
  "/admin/ticketing/settings",
  "/admin/booking-accounts",
  "/admin/booking-accounts/[accountId]",
  "/admin/bookings",
  "/admin/bookings/new",
  "/admin/bookings/[bookingId]",
  "/admin/bookings/[bookingId]/edit",
  "/admin/bookings/calendar",
  "/admin/parties",
  "/admin/parties/new",
  "/admin/parties/balances",
  "/admin/parties/run-sheets",
  "/admin/parties/packages",
  "/admin/parties/packages/new",
  "/admin/parties/packages/[productId]",
  "/admin/parties/rooms",
  "/admin/parties/menu",
  "/admin/parties/settings",
  "/admin/parties/[bookingId]",
  "/admin/booking-invoices",
  "/admin/booking-invoices/[invoiceId]",
  "/admin/booking-payments",
  "/admin/profile",
  "/admin/homepage-content",
  "/admin/ad-banners",
] as const;

/** Provider pages inventory (Find a Tailor). */
export const TAILOR_PAGES = [
  "/tailor/home",
  "/tailor/dashboard",
  "/tailor/campaigns",
  "/tailor/campaigns/credits",
  "/tailor/notifications",
  "/tailor/jobs",
  "/tailor/jobs/[id]",
] as const;

/**
 * Keep this list identical to the literal `config.matcher` in `src/proxy.ts`.
 * Next.js will not accept an imported matcher array.
 */
export const PROXY_MATCHER = [
  "/",
  "/admin",
  "/admin/:path*",
  "/tailor",
  "/tailor/:path*",
  "/profile",
  "/profile/:path*",
  "/user/profile",
  "/user/profile/:path*",
  "/cart",
  "/cart/:path*",
  "/checkout",
  "/checkout/:path*",
  "/settings",
  "/settings/:path*",
  "/dashboard",
  "/dashboard/:path*",
] as const;

export function pathMatchesPrefix(
  pathname: string,
  prefix: string
): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyPageRoute(pathname: string): RouteGate {
  if (pathname === "/") return "root";

  if (
    PAYMENT_PUBLIC_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))
  ) {
    return "public";
  }

  if (STAFF_ROUTE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
    return "staff";
  }

  if (TAILOR_ROUTE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
    return "tailor";
  }

  if (
    CLIENT_ONLY_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix)) ||
    PHANTOM_CLIENT_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))
  ) {
    return "client";
  }

  if (AUTH_ANY_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
    return "auth";
  }

  return "public";
}

/**
 * Staff at the edge: Membership/JWT `preset` is authoritative when present.
 * Else DB `admin`, a staff catalog preset from role, OR any non-`_own`
 * catalog permission (JWT permissions may be omitted — role is enough).
 * UI alias `"user"` and archived `"seller"` map to client — not staff.
 * Does not read shop or seller product fields — Edge has no DB. JWT may
 * carry Membership orgId/permissions (Step 5.2); page gates stay
 * role/preset/permissions based.
 */
export function isStaffActor(
  role: string | null | undefined,
  preset?: string | null,
  permissions?: Iterable<string> | null
): boolean {
  // Suspended membership resolves preset "client" while User.role may still
  // be admin — honor preset first so staff gates match Membership status.
  if (preset && isRolePresetId(preset)) {
    return isStaffPreset(preset);
  }
  if (role === "admin") return true;
  if (isStaffPreset(mapDbRoleToPreset(role || "client"))) {
    return true;
  }
  if (!permissions) return false;
  for (const permission of permissions) {
    if (
      typeof permission === "string" &&
      !permission.endsWith("_own") &&
      isPermission(permission)
    ) {
      return true;
    }
  }
  return false;
}

/** Edge: Membership/JWT preset `tailor`, or staff (ops may preview). */
export function isTailorActor(
  role: string | null | undefined,
  preset?: string | null,
  permissions?: Iterable<string> | null,
  membershipRole?: string | null
): boolean {
  if (isTailorProviderPreset(preset, membershipRole)) {
    return true;
  }
  if (isStaffActor(role, preset, permissions)) {
    return true;
  }
  return false;
}

export function isSafeReturnTo(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

/** Default landing after auth. Single-store; no org/shop. */
export function defaultPathForActor(staff: boolean): "/admin" | "/home" {
  return staff ? "/admin" : "/home";
}
