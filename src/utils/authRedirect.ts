import {
  classifyPageRoute,
  defaultPathForActor,
  isSafeReturnTo,
  pathMatchesPrefix,
} from "@/lib/auth/routePolicy";
import { isTailorProviderPreset } from "@/lib/auth/permissions";
import { sessionIsStaff, type SessionLike } from "@/lib/auth/session";
import { tenantSlugFromHost } from "@/lib/tenantDomain";

/** Identity screens — never use these as post-login destinations. */
const AUTH_IDENTITY_PREFIXES = [
  "/signin",
  "/signup",
  "/register-company",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/check-email",
  "/google/callback",
] as const;

function isAuthIdentityPath(pathname: string): boolean {
  return AUTH_IDENTITY_PREFIXES.some((prefix) =>
    pathMatchesPrefix(pathname, prefix)
  );
}

function sessionIsTailor(session: SessionLike): boolean {
  if (!session) return false;
  return isTailorProviderPreset(session.preset, session.membershipRole);
}

/**
 * Safe post-login redirect — blocks open redirects and role mismatches.
 *
 * Uses the same page gates as `src/proxy.ts` (no org/shop/tenant).
 * Clients may return to /cart and /checkout (Stripe). Staff may return to
 * /admin/**, AUTH_ANY (/cart, /checkout), /tailor/** (QA), and public storefront
 * pages such as /join/[slug]. Staff still cannot return to /profile (client-only).
 */
export function sanitizeAuthReturnTo(
  returnTo: string | null | undefined,
  session: SessionLike
): string | null {
  if (!returnTo || !isSafeReturnTo(returnTo)) {
    return null;
  }

  const pathname = returnTo.split("?")[0] ?? "";
  if (!pathname || !isSafeReturnTo(pathname)) {
    return null;
  }

  // Never send a successful login back to signup/signin (soft-nav no-op / loop).
  if (isAuthIdentityPath(pathname) || pathname === "/") {
    return null;
  }

  const gate = classifyPageRoute(pathname);
  const staff = sessionIsStaff(session);
  const tailor = sessionIsTailor(session);

  if (staff) {
    // Pending/suspended/soft-hold company admins must not land back on
    // /admin or /tailor via returnTo (soft-hold may still project orgStatus active).
    // User account suspend: never resume admin/tailor features.
    const waitingRoom =
      session?.accountSuspended === true ||
      session?.orgStatus === "pending" ||
      session?.orgStatus === "suspended" ||
      session?.billingSoftHold === true;
    if (waitingRoom) {
      if (
        pathname === "/admin" ||
        pathname.startsWith("/admin/") ||
        pathname === "/tailor" ||
        pathname.startsWith("/tailor/")
      ) {
        return null;
      }
    }
    // Park-locked staff: never resume company HQ bookmarks (billing / HQ / profile).
    // Franchise park managers may resume /admin/payouts for park Connect (Step 3).
    if (session?.parkLocked === true) {
      const franchisePayoutsOk =
        session.franchiseParkManager === true &&
        (pathname === "/admin/payouts" ||
          pathname.startsWith("/admin/payouts/"));
      if (
        !franchisePayoutsOk &&
        (pathname === "/admin/billing" ||
          pathname.startsWith("/admin/billing/") ||
          pathname === "/admin/hq" ||
          pathname.startsWith("/admin/hq/") ||
          pathname === "/admin/company-profile" ||
          pathname.startsWith("/admin/company-profile/") ||
          pathname === "/admin/payouts" ||
          pathname.startsWith("/admin/payouts/"))
      ) {
        return null;
      }
    }
    // Staff may QA storefront flows (e.g. /join/[slug]) — proxy allows public pages.
    return gate === "staff" ||
      gate === "auth" ||
      gate === "tailor" ||
      gate === "public"
      ? returnTo
      : null;
  }
  if (gate === "staff") {
    return null;
  }
  if (gate === "tailor" && !tailor) {
    return null;
  }
  return returnTo;
}

export function currentReturnTo(pathname?: string | null): string {
  const path =
    pathname ||
    (typeof window !== "undefined" ? window.location.pathname : "/");
  const search =
    typeof window !== "undefined" ? window.location.search : "";
  const value = `${path}${search}`;
  return isSafeReturnTo(value) ? value : "/";
}

const COMPANY_SIGNIN_HINT_KEY = "company-signin-slug";

/** Remember the company sign-in page used last (null after a platform sign-in). */
export function rememberCompanySignIn(slug: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    const value = slug?.trim().toLowerCase();
    if (value) localStorage.setItem(COMPANY_SIGNIN_HINT_KEY, value);
    else localStorage.removeItem(COMPANY_SIGNIN_HINT_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** After a slug rename: move the remembered sign-in page along (only when one is remembered). */
export function followRenamedCompanySignIn(previousSlug: string | null | undefined, nextSlug: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const prev = previousSlug?.trim().toLowerCase();
  const next = nextSlug?.trim().toLowerCase();
  if (!prev || !next || prev === next) return;
  try {
    if (localStorage.getItem(COMPANY_SIGNIN_HINT_KEY) === prev) {
      localStorage.setItem(COMPANY_SIGNIN_HINT_KEY, next);
    }
  } catch {
    /* storage unavailable */
  }
}

/** Company staff return to their company's page; a subdomain's /signin already is it. */
function signInBasePath(): string {
  if (typeof window === "undefined" || tenantSlugFromHost(window.location.host)) {
    return "/signin";
  }
  try {
    const slug = localStorage.getItem(COMPANY_SIGNIN_HINT_KEY);
    if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return `/signin/${slug}`;
  } catch {
    /* storage unavailable */
  }
  return "/signin";
}

export function signInHref(returnTo: string): string {
  const safe = isSafeReturnTo(returnTo) ? returnTo : "/";
  return `${signInBasePath()}?returnTo=${encodeURIComponent(safe)}`;
}

/**
 * Public “Sign up” always means company workspace registration.
 * Guest / shop self-registration is closed; `returnTo` is ignored so
 * cart/checkout destinations cannot recreate a shop-user flow.
 */
export function signupHref(_returnTo?: string | null): string {
  return "/register-company";
}

/** Persist a safe post-auth destination for sign-in / sign-up hand-offs. */
export function persistAuthReturnTo(returnTo: string | null | undefined): void {
  if (typeof window === "undefined") return;
  if (returnTo && isSafeReturnTo(returnTo)) {
    sessionStorage.setItem("authReturnTo", returnTo);
  }
}

/** Read returnTo from the current URL or sessionStorage (join links, checkout, etc.). */
export function readPendingAuthReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("returnTo");
  if (fromUrl && isSafeReturnTo(fromUrl)) return fromUrl;
  const stored = sessionStorage.getItem("authReturnTo");
  if (stored && isSafeReturnTo(stored)) return stored;
  return null;
}

export function defaultPathForSession(
  session: SessionLike
): "/admin" | "/home" | "/tailor/home" | "/company-pending" {
  // Soft user lock: land on shop home; SuspendedAccountGate shows the dialog.
  if (session?.accountSuspended === true) {
    if (
      session?.orgStatus === "pending" ||
      session?.orgStatus === "suspended" ||
      session?.billingSoftHold === true
    ) {
      return "/company-pending";
    }
    return "/home";
  }
  if (
    session?.orgStatus === "pending" ||
    session?.orgStatus === "suspended" ||
    session?.billingSoftHold === true
  ) {
    return "/company-pending";
  }
  if (sessionIsStaff(session)) return defaultPathForActor(true);
  if (sessionIsTailor(session)) return "/tailor/home";
  return defaultPathForActor(false);
}

export function buildAdminOrderPath(orderId: string): string {
  return `/admin/orders/${orderId}`;
}
